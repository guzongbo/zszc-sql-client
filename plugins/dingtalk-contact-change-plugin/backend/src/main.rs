mod dingtalk;
mod error;
mod models;
mod service;
mod storage;

use crate::error::PluginError;
use crate::models::{
    ConfigDeleteParams, ConfigSaveParams, ConnectionTestParams, HistoryListParams,
    QueryDetailParams, QueryLatestParams, QueryRunParams, RpcError, RpcRequest, RpcResponse,
};
use crate::service::PluginService;
use crate::storage::Storage;
use serde::de::DeserializeOwned;
use serde_json::{Value as JsonValue, json};
use std::env;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

fn main() -> io::Result<()> {
    if !std::env::args().any(|arg| arg == "--stdio") {
        eprintln!("dingtalk-contact-change-plugin only supports --stdio mode");
        return Ok(());
    }

    let service = match build_service() {
        Ok(service) => service,
        Err(error) => {
            eprintln!("failed to initialize plugin service: {error}");
            return Ok(());
        }
    };

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut output = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(value) => value,
            Err(error) => {
                eprintln!("failed to read stdin: {error}");
                break;
            }
        };

        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(request) => execute_request(&service, request),
            Err(error) => RpcResponse {
                id: String::new(),
                result: None,
                error: Some(RpcError {
                    message: format!("请求格式错误: {error}"),
                }),
            },
        };

        let payload = serde_json::to_string(&response).unwrap_or_else(|error| {
            format!(r#"{{"id":"","error":{{"message":"响应序列化失败: {error}"}}}}"#)
        });
        writeln!(output, "{payload}")?;
        output.flush()?;
    }

    Ok(())
}

fn build_service() -> Result<PluginService, PluginError> {
    let data_dir = env::var("ZSZC_PLUGIN_DATA_DIR")
        .map(PathBuf::from)
        .map_err(|_| PluginError::Internal("缺少插件数据目录环境变量".to_string()))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|error| PluginError::Internal(format!("创建插件数据目录失败: {error}")))?;

    let storage = Storage::new(data_dir.join("dingtalk_contact_change.db"))?;
    Ok(PluginService::new(storage))
}

fn execute_request(service: &PluginService, request: RpcRequest) -> RpcResponse {
    match handle_method(service, &request.method, request.params) {
        Ok(result) => RpcResponse {
            id: request.id,
            result: Some(result),
            error: None,
        },
        Err(error) => RpcResponse {
            id: request.id,
            result: None,
            error: Some(RpcError {
                message: error.to_string(),
            }),
        },
    }
}

fn handle_method(
    service: &PluginService,
    method: &str,
    params: JsonValue,
) -> Result<JsonValue, PluginError> {
    match method {
        "app.bootstrap" => Ok(json!(service.bootstrap()?)),
        "config.save" => {
            let payload: ConfigSaveParams = parse_params("保存配置", params)?;
            Ok(json!(service.save_config(payload)?))
        }
        "config.delete" => {
            let payload: ConfigDeleteParams = parse_params("删除配置", params)?;
            service.delete_config(payload)?;
            Ok(json!(true))
        }
        "config.test_connection" => {
            let payload: ConnectionTestParams = parse_params("测试连接", params)?;
            Ok(json!(service.test_connection(payload)?))
        }
        "query.run" => {
            let payload: QueryRunParams = parse_params("立即查询", params)?;
            Ok(json!(service.run_query(payload)?))
        }
        "query.get_latest" => {
            let payload: QueryLatestParams = parse_params("查询最新结果", params)?;
            Ok(json!(service.latest_query(payload)?))
        }
        "query.get_detail" => {
            let payload: QueryDetailParams = parse_params("查询记录详情", params)?;
            Ok(json!(service.query_detail(payload)?))
        }
        "history.list" => {
            let payload: HistoryListParams = parse_params("历史记录列表", params)?;
            Ok(json!(service.history_list(payload)?))
        }
        _ => Err(PluginError::InvalidInput(format!("不支持的方法: {method}"))),
    }
}

fn parse_params<T>(label: &str, params: JsonValue) -> Result<T, PluginError>
where
    T: DeserializeOwned,
{
    serde_json::from_value(params)
        .map_err(|error| PluginError::InvalidInput(format!("{label}参数错误: {error}")))
}

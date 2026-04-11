mod error;
mod models;
mod service;

use crate::error::PluginError;
use crate::models::{
    GeneratePassphraseParams, GeneratePasswordParams, GenerateUsernameParams, RpcError,
    RpcRequest, RpcResponse,
};
use serde::de::DeserializeOwned;
use serde_json::{Value as JsonValue, json};
use std::io::{self, BufRead, Write};

fn main() -> io::Result<()> {
    if !std::env::args().any(|arg| arg == "--stdio") {
        eprintln!("mock-id-generator-plugin only supports --stdio mode");
        return Ok(());
    }

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
            Ok(request) => execute_request(request),
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

fn execute_request(request: RpcRequest) -> RpcResponse {
    match handle_method(&request.method, request.params) {
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

fn handle_method(method: &str, params: JsonValue) -> Result<JsonValue, PluginError> {
    match method {
        "mock.generate_profile" => Ok(json!(service::generate_random_profile())),
        "password.generate" => {
            let payload: GeneratePasswordParams = parse_params("密码生成", params)?;
            Ok(json!(service::generate_password(payload)?))
        }
        "password.generate_passphrase" => {
            let payload: GeneratePassphraseParams = parse_params("密码短语生成", params)?;
            Ok(json!(service::generate_passphrase(payload)?))
        }
        "password.generate_username" => {
            let payload: GenerateUsernameParams = parse_params("用户名生成", params)?;
            Ok(json!(service::generate_username(payload)?))
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

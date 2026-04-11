use base64::{Engine as _, engine::general_purpose};
use bcrypt::{DEFAULT_COST, hash};
use rsa::{
    RsaPrivateKey, pkcs1v15::Pkcs1v15Encrypt, pkcs8::DecodePrivateKey, traits::PublicKeyParts,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value as JsonValue, json};
use std::io::{self, BufRead, Write};
use thiserror::Error;

const PRIVATE_KEY_HEALTH: &str = "MIICdgIBADANBgkqhkiG9w0BAQEFAASCAmAwggJcAgEAAoGBAICaY4uwu+pb2m4uq90KFy9QVmG1YDGpDWc/\
7e6iQPEbBa6HeGcnieTa8P1CUND9144k/CjSQHbIvhcR7c4neuvXBR1w69gSrshc2cv3wvQsMQeCPhE31/vZcTuHu2E6AEKw+\
H0R5rdCQFrTRFiDpVk2r1uuKgs1YThB9bGr9Cl1AgMBAAECgYBNrnSA9cGc390CfzibLTQyBUIYhTnU5XvOKWSsp9+\
4hA0bjoMhNFXsIoA9SuiMRTkGiLq0YcREvB9uygquY1Sw6hXdXT5g5WtO7jOm1TaFQbwMlP6hpZ8RskuLW5jm3WIP2MrN0lPry+\
zknfBLHnGedrBOzzdWCFwg4257TEL4AQJBAPNrnGXvdWz0OdZB58XFsI4HqvBo890gM2nC7C6+pHBjMuOBkD9gmGvNkME/\
FP1cPMXXy0aOzVm343JSwzNq8gECQQCHP8ZVaeE5Bwl2U1zhBeg799mXZ8vWz4Hp7Vmq62dNLi/+wAPX3FQCKm+EbmTHQ/\
AzGvN45CIpsD4fPW/05Y91AkBaNidgH76FAn3syb/7q6gi+vR+5GZ8LNLg/zxIlp6aiCjz57BtzH6wdR6Qf7BntSdQqwjKvWGdPmkslT+\
CbsABAkEAhXsDmzir90Riqk0L1WmnEchDD5J5MsAJT33YiT9a7GkxJRMMt/XTU2/\
eL61j+OWsIkPvFtjQfqRaKyrPW7tUIQJAG06KnfaYli7nlI7n6cjpcEkA5iTIsV5bgIjzIsTa1ewad9ywunKox2mqDPpgqMH3CjPfygnHFoNPl0ukfYfcmw==";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct RpcRequest {
    id: String,
    method: String,
    #[serde(default)]
    params: JsonValue,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct RpcResponse {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<JsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct RpcError {
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct DecryptParams {
    encrypted_text: String,
    #[serde(default = "default_true")]
    replace_underscore: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct EncryptDbParams {
    plain_text: String,
}

#[derive(Debug, Error)]
enum PluginError {
    #[error("{0}")]
    InvalidInput(String),
    #[error("{0}")]
    Internal(String),
}

fn main() -> io::Result<()> {
    if !std::env::args().any(|arg| arg == "--stdio") {
        eprintln!("password-util-plugin only supports --stdio mode");
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
        "password.decrypt" => {
            let payload: DecryptParams = serde_json::from_value(params)
                .map_err(|error| PluginError::InvalidInput(format!("解密参数错误: {error}")))?;
            let plain_text = decrypt_password(&payload.encrypted_text, payload.replace_underscore)?;
            Ok(json!({ "plain_text": plain_text }))
        }
        "password.encrypt_db" => {
            let payload: EncryptDbParams = serde_json::from_value(params)
                .map_err(|error| PluginError::InvalidInput(format!("加密参数错误: {error}")))?;
            let encrypted_text = encrypt_password_for_db(&payload.plain_text)?;
            Ok(json!({ "encrypted_text": encrypted_text }))
        }
        _ => Err(PluginError::InvalidInput(format!("不支持的方法: {method}"))),
    }
}

fn decrypt_password(encrypted_text: &str, replace_underscore: bool) -> Result<String, PluginError> {
    let normalized_text = if replace_underscore {
        encrypted_text.replace('_', "+")
    } else {
        encrypted_text.to_string()
    };

    decrypt_with_private_key_pkcs1_v15(&normalized_text, PRIVATE_KEY_HEALTH)
        .map_err(|error| PluginError::InvalidInput(format!("密码解密失败: {error}")))
}

fn encrypt_password_for_db(plain_text: &str) -> Result<String, PluginError> {
    if plain_text.trim().is_empty() {
        return Err(PluginError::InvalidInput("明文不能为空".to_string()));
    }

    let hash_value = hash(plain_text, DEFAULT_COST)
        .map_err(|error| PluginError::Internal(format!("BCrypt 处理失败: {error}")))?;
    Ok(format!("{{bcrypt}}{hash_value}"))
}

fn decrypt_with_private_key_pkcs1_v15(
    encrypted_text: &str,
    private_key_base64: &str,
) -> Result<String, String> {
    let private_key_der = general_purpose::STANDARD
        .decode(private_key_base64)
        .map_err(|error| format!("私钥解析失败: {error}"))?;
    let private_key = RsaPrivateKey::from_pkcs8_der(&private_key_der)
        .map_err(|error| format!("私钥格式错误: {error}"))?;

    let encrypted_bytes = general_purpose::STANDARD
        .decode(encrypted_text)
        .map_err(|error| format!("密文 Base64 解析失败: {error}"))?;
    let block_size = private_key.size();

    if encrypted_bytes.is_empty() {
        return Err("密文不能为空".to_string());
    }
    if encrypted_bytes.len() % block_size != 0 {
        return Err("密文长度不符合 RSA 分段要求".to_string());
    }

    let mut decrypted = Vec::new();
    for chunk in encrypted_bytes.chunks(block_size) {
        // 对齐原工具的分段私钥解密逻辑，避免长密文解密失败。
        let part = private_key
            .decrypt(Pkcs1v15Encrypt, chunk)
            .map_err(|error| format!("RSA 解密失败: {error}"))?;
        decrypted.extend_from_slice(&part);
    }

    String::from_utf8(decrypted).map_err(|error| format!("解密结果编码错误: {error}"))
}

fn default_true() -> bool {
    true
}

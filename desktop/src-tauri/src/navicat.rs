use aes::Aes128;
use anyhow::{Result, anyhow};
use blowfish::Blowfish;
use cbc::cipher::{
    BlockDecrypt, BlockDecryptMut, BlockEncrypt, KeyInit, KeyIvInit, block_padding::Pkcs7,
};
use regex::Regex;
use sha1::{Digest, Sha1};

use crate::models::SkippedImportItem;

const NAVICAT_V2_KEY: &[u8; 16] = b"libcckeylibcckey";
const NAVICAT_V2_IV: &[u8; 16] = b"libcciv libcciv ";
const SUPPORTED_CONN_TYPES: &[&str] = &["MYSQL", "MARIADB"];

type Aes128CbcDec = cbc::Decryptor<Aes128>;

#[derive(Debug, Clone)]
pub struct NavicatConnectionCandidate {
    pub data_source_name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub group_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NavicatImportPayload {
    pub connections: Vec<NavicatConnectionCandidate>,
    pub skipped_items: Vec<SkippedImportItem>,
}

pub fn parse_navicat_connections(xml: &str) -> Result<NavicatImportPayload> {
    let connection_regex = Regex::new(r#"<Connection\b([\s\S]*?)(?:/?>\s*(?:</Connection>)?)"#)?;
    let attribute_regex = Regex::new(r#"([A-Za-z_][\w:.-]*)=\"([^\"]*)\""#)?;
    let matches = connection_regex.captures_iter(xml).collect::<Vec<_>>();

    if matches.is_empty() {
        return Err(anyhow!("未识别到 Navicat .ncx 连接定义"));
    }

    let mut connections = Vec::new();
    let mut skipped_items = Vec::new();

    for item in matches {
        let raw_attributes = item
            .get(1)
            .map(|matched| matched.as_str())
            .unwrap_or_default();
        let attributes = parse_xml_attributes(raw_attributes, &attribute_regex);
        let conn_type = attributes
            .get("ConnType")
            .map(|value| value.trim().to_uppercase())
            .unwrap_or_default();
        let name = attributes
            .get("ConnectionName")
            .map(|value| value.trim().to_string())
            .unwrap_or_default();

        if name.is_empty() {
            skipped_items.push(SkippedImportItem {
                name: "未命名连接".to_string(),
                reason: "缺少连接名称".to_string(),
            });
            continue;
        }

        if !SUPPORTED_CONN_TYPES.contains(&conn_type.as_str()) {
            skipped_items.push(SkippedImportItem {
                name,
                reason: format!(
                    "当前仅支持导入 MySQL/MariaDB，已跳过 {} 类型",
                    if conn_type.is_empty() {
                        "未知"
                    } else {
                        conn_type.as_str()
                    }
                ),
            });
            continue;
        }

        let host = attributes
            .get("Host")
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        let username = attributes
            .get("UserName")
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        let port = normalize_port(attributes.get("Port").map(String::as_str).unwrap_or("3306"));

        if host.is_empty() || username.is_empty() || port == 0 {
            skipped_items.push(SkippedImportItem {
                name,
                reason: "缺少 Host、Port 或 Username".to_string(),
            });
            continue;
        }

        let (password, _password_resolved) = decode_navicat_password(
            attributes
                .get("Password")
                .map(String::as_str)
                .unwrap_or_default(),
        );

        connections.push(NavicatConnectionCandidate {
            data_source_name: name,
            host,
            port,
            username,
            password,
            group_name: normalize_optional_text(attributes.get("Remarks").map(String::as_str)),
        });
    }

    Ok(NavicatImportPayload {
        connections,
        skipped_items,
    })
}

fn parse_xml_attributes(
    input: &str,
    pattern: &Regex,
) -> std::collections::BTreeMap<String, String> {
    pattern
        .captures_iter(input)
        .filter_map(|capture| {
            let key = capture.get(1)?.as_str().to_string();
            let value = decode_xml_entities(capture.get(2)?.as_str());
            Some((key, value))
        })
        .collect()
}

fn decode_xml_entities(input: &str) -> String {
    let entity_regex = Regex::new(r"&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);")
        .expect("xml entity regex must be valid");

    entity_regex
        .replace_all(input, |captures: &regex::Captures<'_>| {
            let entity = captures
                .get(1)
                .map(|item| item.as_str())
                .unwrap_or_default();
            match entity {
                "amp" => "&".to_string(),
                "lt" => "<".to_string(),
                "gt" => ">".to_string(),
                "quot" => "\"".to_string(),
                "apos" => "'".to_string(),
                _ if entity.starts_with("#x") => u32::from_str_radix(&entity[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
                    .map(|item| item.to_string())
                    .unwrap_or_else(|| captures.get(0).unwrap().as_str().to_string()),
                _ if entity.starts_with('#') => entity[1..]
                    .parse::<u32>()
                    .ok()
                    .and_then(char::from_u32)
                    .map(|item| item.to_string())
                    .unwrap_or_else(|| captures.get(0).unwrap().as_str().to_string()),
                _ => captures.get(0).unwrap().as_str().to_string(),
            }
        })
        .into_owned()
}

fn decode_navicat_password(cipher_text: &str) -> (String, bool) {
    if cipher_text.trim().is_empty() {
        return (String::new(), false);
    }

    for decryptor in [
        decrypt_navicat_password_v2 as fn(&str) -> Result<String>,
        decrypt_navicat_password_v1,
    ] {
        if let Ok(password) = decryptor(cipher_text) {
            return (password, true);
        }
    }

    (String::new(), false)
}

fn decrypt_navicat_password_v2(cipher_text: &str) -> Result<String> {
    let mut buffer = hex::decode(cipher_text)?;
    let decrypted = Aes128CbcDec::new_from_slices(NAVICAT_V2_KEY, NAVICAT_V2_IV)?
        .decrypt_padded_mut::<Pkcs7>(&mut buffer)
        .map_err(|error| anyhow!(error.to_string()))?;

    decode_navicat_plain_text(decrypted)
}

fn decrypt_navicat_password_v1(cipher_text: &str) -> Result<String> {
    let cipher_bytes = hex::decode(cipher_text)?;
    let mut hasher = Sha1::new();
    hasher.update(b"3DC5CA39");
    let key = hasher.finalize();
    let cipher = Blowfish::new_from_slice(&key).map_err(|error| anyhow!(error.to_string()))?;

    let block_size = 8;
    let blocks_length = (cipher_bytes.len() / block_size) * block_size;
    let mut output = Vec::new();
    let mut current_vector = encrypt_navicat_v1_block(&cipher, [0xff; 8])?;

    let mut offset = 0;
    while offset < blocks_length {
        let mut block = [0_u8; 8];
        block.copy_from_slice(&cipher_bytes[offset..offset + block_size]);
        let decrypted = decrypt_navicat_v1_block(&cipher, block)?;
        output.extend(xor_buffers(&decrypted, &current_vector));
        current_vector = xor_buffers(&current_vector, &block);
        offset += block_size;
    }

    let leftover = cipher_bytes.len() - blocks_length;
    if leftover > 0 {
        current_vector = encrypt_navicat_v1_block(&cipher, current_vector)?;
        output.extend(
            cipher_bytes[blocks_length..]
                .iter()
                .zip(current_vector.iter())
                .take(leftover)
                .map(|(left, right)| left ^ right),
        );
    }

    decode_navicat_plain_text(&output)
}

fn encrypt_navicat_v1_block(cipher: &Blowfish, mut block: [u8; 8]) -> Result<[u8; 8]> {
    cipher.encrypt_block((&mut block).into());
    Ok(block)
}

fn decrypt_navicat_v1_block(cipher: &Blowfish, mut block: [u8; 8]) -> Result<[u8; 8]> {
    cipher.decrypt_block((&mut block).into());
    Ok(block)
}

fn decode_navicat_plain_text(buffer: &[u8]) -> Result<String> {
    let text = String::from_utf8(buffer.to_vec()).map_err(|error| anyhow!(error.to_string()))?;
    if !looks_like_readable_secret(&text) {
        return Err(anyhow!("Navicat 密文解密后不可读"));
    }
    Ok(text)
}

fn looks_like_readable_secret(text: &str) -> bool {
    !text.is_empty()
        && text.chars().all(|item| {
            let code = item as u32;
            code >= 0x20 && code != 0x7f
        })
}

fn xor_buffers(left: &[u8], right: &[u8]) -> [u8; 8] {
    let mut output = [0_u8; 8];
    for (index, value) in output.iter_mut().enumerate() {
        *value = left[index] ^ right[index];
    }
    output
}

fn normalize_port(value: &str) -> u16 {
    value
        .parse::<u16>()
        .ok()
        .filter(|item| *item > 0)
        .unwrap_or(0)
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

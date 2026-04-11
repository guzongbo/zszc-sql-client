use crate::models::{
    MutationResult, RedisConnectionProfile, RedisConnectionTestResult, RedisDeleteHashFieldPayload,
    RedisHashEntry, RedisHashFieldPayload, RedisKeyDetail, RedisKeyDetailRequest, RedisKeyIdentity,
    RedisKeySummary, RedisListItem, RedisRenameKeyPayload, RedisScanKeysRequest,
    RedisScanKeysResponse, RedisSetKeyTtlPayload, RedisStreamEntry, RedisStringValuePayload,
    RedisZSetEntry,
};
use anyhow::{Context, Result, ensure};
use redis::{Client, Connection, Value};
use std::time::Duration;

const DEFAULT_SCAN_PATTERN: &str = "*";
const REDIS_MIN_LIMIT: u32 = 10;
const REDIS_MAX_LIMIT: u32 = 500;

#[derive(Debug, Default)]
pub struct RedisService;

impl RedisService {
    pub fn test_connection(
        &self,
        profile: &RedisConnectionProfile,
    ) -> Result<RedisConnectionTestResult> {
        self.with_connection(profile, profile.database_index, |connection| {
            let _: String = redis::cmd("PING")
                .query(connection)
                .context("Redis PING 失败")?;
            let info = redis::cmd("INFO")
                .arg("server")
                .query::<String>(connection)
                .context("读取 Redis 服务信息失败")?;
            let server_version =
                parse_redis_info_value(&info, "redis_version").unwrap_or_else(|| "unknown".into());
            let key_count = redis::cmd("DBSIZE")
                .query::<u64>(connection)
                .context("读取 Redis DB key 数量失败")?;

            Ok(RedisConnectionTestResult {
                server_version,
                database_index: profile.database_index,
                key_count,
            })
        })
    }

    pub fn scan_keys(
        &self,
        profile: &RedisConnectionProfile,
        request: &RedisScanKeysRequest,
    ) -> Result<RedisScanKeysResponse> {
        let limit = normalize_limit(request.limit);
        let pattern = normalize_pattern(&request.pattern);
        let type_filter = normalize_type_filter(request.type_filter.as_deref())?;
        let cursor = request.cursor.trim().parse::<u64>().unwrap_or(0);

        self.with_connection(profile, request.database_index, |connection| {
            let (next_cursor, key_names) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(pattern)
                .arg("COUNT")
                .arg(limit)
                .query::<(u64, Vec<String>)>(connection)
                .context("扫描 Redis key 失败")?;

            let type_names = load_type_names(connection, &key_names)?;
            let filtered_keys = key_names
                .into_iter()
                .zip(type_names)
                .filter(|(_, type_name)| {
                    type_filter
                        .as_deref()
                        .is_none_or(|expected| expected == type_name)
                })
                .collect::<Vec<_>>();
            let filtered_key_names = filtered_keys
                .iter()
                .map(|(key_name, _)| key_name.as_str())
                .collect::<Vec<_>>();
            let ttl_seconds_list = load_ttl_seconds_batch(connection, &filtered_key_names)?;
            let keys = filtered_keys
                .into_iter()
                .zip(ttl_seconds_list)
                .map(|((key_name, type_name), ttl_seconds)| RedisKeySummary {
                    key_name,
                    type_name,
                    ttl_seconds,
                })
                .collect();

            Ok(RedisScanKeysResponse {
                cursor: next_cursor.to_string(),
                has_more: next_cursor != 0,
                keys,
            })
        })
    }

    pub fn load_key_detail(
        &self,
        profile: &RedisConnectionProfile,
        request: &RedisKeyDetailRequest,
    ) -> Result<RedisKeyDetail> {
        let limit = normalize_limit(request.limit);
        let offset = request.offset as i64;

        self.with_connection(profile, request.database_index, |connection| {
            let type_name = load_type_name(connection, &request.key_name)?;
            ensure!(type_name != "none", "Redis key 不存在");

            let ttl_seconds = load_ttl_seconds(connection, &request.key_name)?;
            let mut detail = RedisKeyDetail {
                profile_id: request.profile_id.clone(),
                database_index: request.database_index,
                key_name: request.key_name.clone(),
                type_name: type_name.clone(),
                ttl_seconds,
                length: 0,
                string_value: None,
                hash_entries: Vec::new(),
                list_items: Vec::new(),
                set_members: Vec::new(),
                zset_entries: Vec::new(),
                stream_entries: Vec::new(),
                truncated: false,
            };

            match type_name.as_str() {
                "string" => {
                    let value = redis::cmd("GET")
                        .arg(&request.key_name)
                        .query::<Value>(connection)
                        .context("读取 Redis string 失败")?;
                    let text = redis_value_to_display_string(&value);
                    detail.length = redis::cmd("STRLEN")
                        .arg(&request.key_name)
                        .query::<u64>(connection)
                        .unwrap_or(text.len() as u64);
                    detail.string_value = Some(text);
                }
                "hash" => {
                    detail.length = redis::cmd("HLEN")
                        .arg(&request.key_name)
                        .query::<u64>(connection)
                        .context("读取 Redis hash 长度失败")?;
                    let (cursor, entries) = redis::cmd("HSCAN")
                        .arg(&request.key_name)
                        .arg(0_u64)
                        .arg("COUNT")
                        .arg(limit)
                        .query::<(u64, Vec<(String, String)>)>(connection)
                        .context("读取 Redis hash 失败")?;
                    detail.hash_entries = entries
                        .into_iter()
                        .map(|(field, value)| RedisHashEntry { field, value })
                        .collect();
                    detail.truncated =
                        cursor != 0 || detail.length > detail.hash_entries.len() as u64;
                }
                "list" => {
                    detail.length = redis::cmd("LLEN")
                        .arg(&request.key_name)
                        .query::<u64>(connection)
                        .context("读取 Redis list 长度失败")?;
                    let end = offset + limit as i64 - 1;
                    let values = redis::cmd("LRANGE")
                        .arg(&request.key_name)
                        .arg(offset)
                        .arg(end)
                        .query::<Vec<String>>(connection)
                        .context("读取 Redis list 失败")?;
                    detail.list_items = values
                        .into_iter()
                        .enumerate()
                        .map(|(index, value)| RedisListItem {
                            index: offset + index as i64,
                            value,
                        })
                        .collect();
                    detail.truncated =
                        (offset as u64 + detail.list_items.len() as u64) < detail.length;
                }
                "set" => {
                    detail.length = redis::cmd("SCARD")
                        .arg(&request.key_name)
                        .query::<u64>(connection)
                        .context("读取 Redis set 长度失败")?;
                    let (cursor, values) = redis::cmd("SSCAN")
                        .arg(&request.key_name)
                        .arg(0_u64)
                        .arg("COUNT")
                        .arg(limit)
                        .query::<(u64, Vec<String>)>(connection)
                        .context("读取 Redis set 失败")?;
                    detail.set_members = values;
                    detail.truncated =
                        cursor != 0 || detail.length > detail.set_members.len() as u64;
                }
                "zset" => {
                    detail.length = redis::cmd("ZCARD")
                        .arg(&request.key_name)
                        .query::<u64>(connection)
                        .context("读取 Redis zset 长度失败")?;
                    let end = offset + limit as i64 - 1;
                    let values = redis::cmd("ZRANGE")
                        .arg(&request.key_name)
                        .arg(offset)
                        .arg(end)
                        .arg("WITHSCORES")
                        .query::<Vec<(String, f64)>>(connection)
                        .context("读取 Redis zset 失败")?;
                    detail.zset_entries = values
                        .into_iter()
                        .map(|(member, score)| RedisZSetEntry { member, score })
                        .collect();
                    detail.truncated =
                        (offset as u64 + detail.zset_entries.len() as u64) < detail.length;
                }
                "stream" => {
                    detail.length = redis::cmd("XLEN")
                        .arg(&request.key_name)
                        .query::<u64>(connection)
                        .context("读取 Redis stream 长度失败")?;
                    let value = redis::cmd("XRANGE")
                        .arg(&request.key_name)
                        .arg("-")
                        .arg("+")
                        .arg("COUNT")
                        .arg(limit)
                        .query::<Value>(connection)
                        .context("读取 Redis stream 失败")?;
                    detail.stream_entries = parse_stream_entries(value);
                    detail.truncated = detail.length > detail.stream_entries.len() as u64;
                }
                other => {
                    detail.string_value = Some(format!("暂不支持预览 Redis 类型: {other}"));
                }
            }

            Ok(detail)
        })
    }

    pub fn set_string_value(
        &self,
        profile: &RedisConnectionProfile,
        payload: &RedisStringValuePayload,
    ) -> Result<MutationResult> {
        validate_key_name(&payload.key_name)?;
        self.with_connection(profile, payload.database_index, |connection| {
            let _: String = redis::cmd("SET")
                .arg(&payload.key_name)
                .arg(&payload.value)
                .query(connection)
                .context("写入 Redis string 失败")?;

            Ok(MutationResult {
                affected_rows: 1,
                statements: vec![format!("SET {}", payload.key_name)],
            })
        })
    }

    pub fn set_hash_field(
        &self,
        profile: &RedisConnectionProfile,
        payload: &RedisHashFieldPayload,
    ) -> Result<MutationResult> {
        validate_key_name(&payload.key_name)?;
        ensure!(!payload.field.trim().is_empty(), "hash 字段不能为空");

        self.with_connection(profile, payload.database_index, |connection| {
            let affected_rows = redis::cmd("HSET")
                .arg(&payload.key_name)
                .arg(payload.field.trim())
                .arg(&payload.value)
                .query::<u64>(connection)
                .context("写入 Redis hash 字段失败")?;

            Ok(MutationResult {
                affected_rows,
                statements: vec![format!(
                    "HSET {} {}",
                    payload.key_name,
                    payload.field.trim()
                )],
            })
        })
    }

    pub fn delete_hash_field(
        &self,
        profile: &RedisConnectionProfile,
        payload: &RedisDeleteHashFieldPayload,
    ) -> Result<MutationResult> {
        validate_key_name(&payload.key_name)?;
        ensure!(!payload.field.trim().is_empty(), "hash 字段不能为空");

        self.with_connection(profile, payload.database_index, |connection| {
            let affected_rows = redis::cmd("HDEL")
                .arg(&payload.key_name)
                .arg(payload.field.trim())
                .query::<u64>(connection)
                .context("删除 Redis hash 字段失败")?;

            Ok(MutationResult {
                affected_rows,
                statements: vec![format!(
                    "HDEL {} {}",
                    payload.key_name,
                    payload.field.trim()
                )],
            })
        })
    }

    pub fn delete_key(
        &self,
        profile: &RedisConnectionProfile,
        payload: &RedisKeyIdentity,
    ) -> Result<MutationResult> {
        validate_key_name(&payload.key_name)?;
        self.with_connection(profile, payload.database_index, |connection| {
            let affected_rows = redis::cmd("DEL")
                .arg(&payload.key_name)
                .query::<u64>(connection)
                .context("删除 Redis key 失败")?;

            Ok(MutationResult {
                affected_rows,
                statements: vec![format!("DEL {}", payload.key_name)],
            })
        })
    }

    pub fn rename_key(
        &self,
        profile: &RedisConnectionProfile,
        payload: &RedisRenameKeyPayload,
    ) -> Result<MutationResult> {
        validate_key_name(&payload.key_name)?;
        validate_key_name(&payload.new_key_name)?;
        ensure!(
            payload.key_name != payload.new_key_name,
            "新 key 名称不能与原 key 相同"
        );

        self.with_connection(profile, payload.database_index, |connection| {
            let _: String = redis::cmd("RENAME")
                .arg(&payload.key_name)
                .arg(&payload.new_key_name)
                .query(connection)
                .context("重命名 Redis key 失败")?;

            Ok(MutationResult {
                affected_rows: 1,
                statements: vec![format!(
                    "RENAME {} {}",
                    payload.key_name, payload.new_key_name
                )],
            })
        })
    }

    pub fn set_key_ttl(
        &self,
        profile: &RedisConnectionProfile,
        payload: &RedisSetKeyTtlPayload,
    ) -> Result<MutationResult> {
        validate_key_name(&payload.key_name)?;
        if let Some(ttl_seconds) = payload.ttl_seconds {
            ensure!(ttl_seconds > 0, "TTL 必须大于 0 秒");
        }

        self.with_connection(profile, payload.database_index, |connection| {
            let (affected_rows, statement) = if let Some(ttl_seconds) = payload.ttl_seconds {
                let affected_rows = redis::cmd("EXPIRE")
                    .arg(&payload.key_name)
                    .arg(ttl_seconds)
                    .query::<u64>(connection)
                    .context("设置 Redis key TTL 失败")?;
                (
                    affected_rows,
                    format!("EXPIRE {} {}", payload.key_name, ttl_seconds),
                )
            } else {
                let affected_rows = redis::cmd("PERSIST")
                    .arg(&payload.key_name)
                    .query::<u64>(connection)
                    .context("清除 Redis key TTL 失败")?;
                (affected_rows, format!("PERSIST {}", payload.key_name))
            };

            Ok(MutationResult {
                affected_rows,
                statements: vec![statement],
            })
        })
    }

    fn with_connection<T>(
        &self,
        profile: &RedisConnectionProfile,
        database_index: u16,
        handler: impl FnOnce(&mut Connection) -> Result<T>,
    ) -> Result<T> {
        let client = Client::open(build_redis_url(profile, database_index)?)
            .context("初始化 Redis 客户端失败")?;
        let mut connection = client
            .get_connection_with_timeout(Duration::from_millis(profile.connect_timeout_ms))
            .context("连接 Redis 失败")?;
        handler(&mut connection)
    }
}

fn load_type_name(connection: &mut Connection, key_name: &str) -> Result<String> {
    redis::cmd("TYPE")
        .arg(key_name)
        .query::<String>(connection)
        .context("读取 Redis key 类型失败")
}

fn load_type_names(connection: &mut Connection, key_names: &[String]) -> Result<Vec<String>> {
    if key_names.is_empty() {
        return Ok(Vec::new());
    }

    let mut pipeline = redis::pipe();
    for key_name in key_names {
        pipeline.cmd("TYPE").arg(key_name);
    }

    pipeline
        .query::<Vec<String>>(connection)
        .context("批量读取 Redis key 类型失败")
}

fn load_ttl_seconds(connection: &mut Connection, key_name: &str) -> Result<Option<i64>> {
    let ttl = redis::cmd("TTL")
        .arg(key_name)
        .query::<i64>(connection)
        .context("读取 Redis key TTL 失败")?;
    Ok((ttl >= 0).then_some(ttl))
}

fn load_ttl_seconds_batch(
    connection: &mut Connection,
    key_names: &[&str],
) -> Result<Vec<Option<i64>>> {
    if key_names.is_empty() {
        return Ok(Vec::new());
    }

    let mut pipeline = redis::pipe();
    for key_name in key_names {
        pipeline.cmd("TTL").arg(key_name);
    }

    let ttl_values = pipeline
        .query::<Vec<i64>>(connection)
        .context("批量读取 Redis key TTL 失败")?;
    Ok(ttl_values
        .into_iter()
        .map(|ttl_seconds| (ttl_seconds >= 0).then_some(ttl_seconds))
        .collect())
}

fn build_redis_url(profile: &RedisConnectionProfile, database_index: u16) -> Result<String> {
    ensure!(!profile.host.trim().is_empty(), "Redis 主机不能为空");
    ensure!(profile.port > 0, "Redis 端口必须大于 0");
    ensure!(database_index <= 255, "Redis DB 编号必须在 0 到 255 之间");

    let host = profile.host.trim();
    let username = profile.username.trim();
    let password = profile.password.as_str();
    let auth = if username.is_empty() && password.is_empty() {
        String::new()
    } else if username.is_empty() {
        format!(":{}@", percent_encode_redis_url_part(password))
    } else {
        format!(
            "{}:{}@",
            percent_encode_redis_url_part(username),
            percent_encode_redis_url_part(password)
        )
    };

    Ok(format!(
        "redis://{auth}{}:{}/{}",
        host, profile.port, database_index
    ))
}

fn normalize_pattern(pattern: &str) -> &str {
    let trimmed = pattern.trim();
    if trimmed.is_empty() {
        DEFAULT_SCAN_PATTERN
    } else {
        trimmed
    }
}

fn normalize_limit(limit: u32) -> u32 {
    limit.clamp(REDIS_MIN_LIMIT, REDIS_MAX_LIMIT)
}

fn normalize_type_filter(value: Option<&str>) -> Result<Option<String>> {
    let Some(value) = value
        .map(str::trim)
        .filter(|item| !item.is_empty() && *item != "all")
    else {
        return Ok(None);
    };
    ensure!(
        matches!(
            value,
            "string" | "hash" | "list" | "set" | "zset" | "stream"
        ),
        "不支持的 Redis 类型过滤: {value}"
    );
    Ok(Some(value.to_string()))
}

fn validate_key_name(key_name: &str) -> Result<()> {
    ensure!(!key_name.trim().is_empty(), "Redis key 不能为空");
    Ok(())
}

fn parse_redis_info_value(info: &str, key: &str) -> Option<String> {
    info.lines().find_map(|line| {
        line.split_once(':')
            .filter(|(name, _)| *name == key)
            .map(|(_, value)| value.trim().to_string())
    })
}

fn percent_encode_redis_url_part(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn redis_value_to_display_string(value: &Value) -> String {
    match value {
        Value::Nil => String::new(),
        Value::Int(value) => value.to_string(),
        Value::BulkString(value) => String::from_utf8_lossy(value).to_string(),
        Value::Array(values) => values
            .iter()
            .map(redis_value_to_display_string)
            .collect::<Vec<_>>()
            .join(", "),
        Value::SimpleString(value) => value.clone(),
        Value::Okay => "OK".to_string(),
        Value::Map(values) => values
            .iter()
            .map(|(key, value)| {
                format!(
                    "{}: {}",
                    redis_value_to_display_string(key),
                    redis_value_to_display_string(value)
                )
            })
            .collect::<Vec<_>>()
            .join(", "),
        Value::Attribute { data, .. } => redis_value_to_display_string(data),
        Value::Set(values) => values
            .iter()
            .map(redis_value_to_display_string)
            .collect::<Vec<_>>()
            .join(", "),
        Value::Double(value) => value.to_string(),
        Value::Boolean(value) => value.to_string(),
        Value::VerbatimString { text, .. } => text.clone(),
        Value::BigNumber(value) => value.to_string(),
        Value::Push { data, .. } => data
            .iter()
            .map(redis_value_to_display_string)
            .collect::<Vec<_>>()
            .join(", "),
        Value::ServerError(error) => error.to_string(),
        _ => "不支持的 Redis 响应".to_string(),
    }
}

fn parse_stream_entries(value: Value) -> Vec<RedisStreamEntry> {
    let Value::Array(entries) = value else {
        return Vec::new();
    };

    entries
        .into_iter()
        .filter_map(|entry| {
            let Value::Array(mut parts) = entry else {
                return None;
            };
            if parts.len() != 2 {
                return None;
            }

            let fields_value = parts.pop()?;
            let id_value = parts.pop()?;
            let entry_id = redis_value_to_display_string(&id_value);
            let fields = parse_stream_fields(fields_value);

            Some(RedisStreamEntry { entry_id, fields })
        })
        .collect()
}

fn parse_stream_fields(value: Value) -> Vec<RedisHashEntry> {
    let Value::Array(values) = value else {
        return Vec::new();
    };

    values
        .chunks(2)
        .filter_map(|chunk| {
            let [field, value] = chunk else {
                return None;
            };
            Some(RedisHashEntry {
                field: redis_value_to_display_string(field),
                value: redis_value_to_display_string(value),
            })
        })
        .collect()
}

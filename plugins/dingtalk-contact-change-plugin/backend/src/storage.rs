use crate::error::PluginError;
use crate::models::{
    AppBootstrapResponse, ChangeType, ConfigSaveParams, ConnectionTestResult, DingtalkConfig,
    HistoryListResponse, QueryDetailResponse, QueryRecordSummary, QueryStatus, QueryUserItem,
    QueryUserTab, default_history_page_size, default_page, default_page_size,
};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::BTreeMap;
use std::path::PathBuf;
use uuid::Uuid;

pub struct Storage {
    db_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct StoredSnapshotUser {
    pub user_id: String,
    pub user_name: String,
}

#[derive(Debug, Clone)]
pub struct QueryRecordInsert {
    pub id: String,
    pub config_id: String,
    pub config_name: String,
    pub queried_at: String,
    pub status: QueryStatus,
    pub total_count: i64,
    pub added_count: i64,
    pub removed_count: i64,
    pub previous_record_id: Option<String>,
    pub previous_queried_at: Option<String>,
    pub previous_total_count: Option<i64>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct QueryUserInsert {
    pub user_id: String,
    pub user_name: String,
    pub change_type: ChangeType,
    pub is_current: bool,
}

impl Storage {
    pub fn new(db_path: PathBuf) -> Result<Self, PluginError> {
        let storage = Self { db_path };
        storage.init()?;
        Ok(storage)
    }

    pub fn bootstrap(
        &self,
        page: Option<u32>,
        page_size: Option<u32>,
    ) -> Result<AppBootstrapResponse, PluginError> {
        Ok(AppBootstrapResponse {
            configs: self.list_configs()?,
            history: self.list_history(
                None,
                None,
                None,
                page.unwrap_or_else(default_page),
                page_size.unwrap_or_else(default_history_page_size),
            )?,
        })
    }

    pub fn list_configs(&self) -> Result<Vec<DingtalkConfig>, PluginError> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT id, name, base_url, app_id, app_secret, last_test_result, created_at, updated_at
                 FROM configs
                 ORDER BY created_at ASC, name ASC",
            )
            .map_err(map_storage_error)?;
        let rows = statement
            .query_map([], |row| map_config_row(row))
            .map_err(map_storage_error)?;

        let mut configs = Vec::new();
        for row in rows {
            configs.push(row.map_err(map_storage_error)?);
        }
        Ok(configs)
    }

    pub fn save_config(
        &self,
        params: ConfigSaveParams,
        timestamp: &str,
    ) -> Result<DingtalkConfig, PluginError> {
        let base_url = normalize_text(&params.base_url, "接口域名")?;
        let app_id = normalize_text(&params.app_id, "应用ID")?;
        let app_secret = normalize_text(&params.app_secret, "应用密钥")?;

        let connection = self.open()?;
        let mut config = if let Some(config_id) = params.id {
            self.find_config_by_id(&connection, &config_id)?
                .ok_or_else(|| PluginError::NotFound(format!("未找到配置: {config_id}")))?
        } else {
            DingtalkConfig {
                id: Uuid::new_v4().to_string(),
                name: String::new(),
                base_url: String::new(),
                app_id: String::new(),
                app_secret: String::new(),
                last_test_result: None,
                created_at: timestamp.to_string(),
                updated_at: timestamp.to_string(),
            }
        };

        config.base_url = base_url;
        config.app_id = app_id;
        config.app_secret = app_secret;
        config.updated_at = timestamp.to_string();

        if !params.name.trim().is_empty() {
            config.name = params.name.trim().to_string();
        } else if config.name.trim().is_empty() {
            config.name = self.next_config_name(&connection)?;
        }

        connection
            .execute(
                "INSERT INTO configs (
                    id, name, base_url, app_id, app_secret, last_test_result, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    base_url = excluded.base_url,
                    app_id = excluded.app_id,
                    app_secret = excluded.app_secret,
                    last_test_result = excluded.last_test_result,
                    updated_at = excluded.updated_at",
                params![
                    config.id,
                    config.name,
                    config.base_url,
                    config.app_id,
                    config.app_secret,
                    serialize_optional_json(&config.last_test_result)?,
                    config.created_at,
                    config.updated_at,
                ],
            )
            .map_err(map_storage_error)?;

        self.find_config_by_id(&connection, &config.id)?
            .ok_or_else(|| PluginError::Internal("保存配置后未能重新读取配置".to_string()))
    }

    pub fn save_test_result(
        &self,
        config_id: &str,
        result: &ConnectionTestResult,
        timestamp: &str,
    ) -> Result<(), PluginError> {
        let connection = self.open()?;
        let affected = connection
            .execute(
                "UPDATE configs
                 SET last_test_result = ?2, updated_at = ?3
                 WHERE id = ?1",
                params![
                    config_id,
                    serialize_optional_json(&Some(result.clone()))?,
                    timestamp
                ],
            )
            .map_err(map_storage_error)?;

        if affected == 0 {
            return Err(PluginError::NotFound(format!("未找到配置: {config_id}")));
        }

        Ok(())
    }

    pub fn get_config(&self, config_id: &str) -> Result<DingtalkConfig, PluginError> {
        let connection = self.open()?;
        self.find_config_by_id(&connection, config_id)?
            .ok_or_else(|| PluginError::NotFound(format!("未找到配置: {config_id}")))
    }

    pub fn delete_config(&self, config_id: &str) -> Result<(), PluginError> {
        let connection = self.open()?;
        let affected = connection
            .execute("DELETE FROM configs WHERE id = ?1", params![config_id])
            .map_err(map_storage_error)?;

        if affected == 0 {
            return Err(PluginError::NotFound(format!("未找到配置: {config_id}")));
        }

        Ok(())
    }

    pub fn list_history(
        &self,
        config_id: Option<&str>,
        start_date: Option<&str>,
        end_date: Option<&str>,
        page: u32,
        page_size: u32,
    ) -> Result<HistoryListResponse, PluginError> {
        let connection = self.open()?;
        let safe_page = sanitize_page(page);
        let safe_page_size = sanitize_page_size(page_size, default_history_page_size(), 50);
        let config = config_id.unwrap_or("");
        let start = start_date.unwrap_or("");
        let end = end_date.unwrap_or("");

        let total_items: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM query_records
                 WHERE (?1 = '' OR config_id = ?1)
                   AND (?2 = '' OR substr(queried_at, 1, 10) >= ?2)
                   AND (?3 = '' OR substr(queried_at, 1, 10) <= ?3)",
                params![config, start, end],
                |row| row.get(0),
            )
            .map_err(map_storage_error)?;

        let total_pages = calculate_total_pages(total_items, safe_page_size);
        let offset = ((safe_page - 1) * safe_page_size) as i64;

        let mut statement = connection
            .prepare(
                "SELECT id, config_id, config_name, queried_at, status, total_count, added_count, removed_count,
                        previous_record_id, previous_queried_at, previous_total_count, error_message
                 FROM query_records
                 WHERE (?1 = '' OR config_id = ?1)
                   AND (?2 = '' OR substr(queried_at, 1, 10) >= ?2)
                   AND (?3 = '' OR substr(queried_at, 1, 10) <= ?3)
                 ORDER BY queried_at DESC
                 LIMIT ?4 OFFSET ?5",
            )
            .map_err(map_storage_error)?;

        let rows = statement
            .query_map(params![config, start, end, safe_page_size, offset], |row| {
                map_query_record_row(row)
            })
            .map_err(map_storage_error)?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(map_storage_error)?);
        }

        Ok(HistoryListResponse {
            items,
            page: safe_page,
            page_size: safe_page_size,
            total_items,
            total_pages,
            config_id: optional_string(config),
            start_date: optional_string(start),
            end_date: optional_string(end),
        })
    }

    pub fn latest_success_record(
        &self,
        config_id: &str,
    ) -> Result<Option<QueryRecordSummary>, PluginError> {
        let connection = self.open()?;
        connection
            .query_row(
                "SELECT id, config_id, config_name, queried_at, status, total_count, added_count, removed_count,
                        previous_record_id, previous_queried_at, previous_total_count, error_message
                 FROM query_records
                 WHERE config_id = ?1 AND status = 'success'
                 ORDER BY queried_at DESC
                 LIMIT 1",
                params![config_id],
                |row| map_query_record_row(row),
            )
            .optional()
            .map_err(map_storage_error)
    }

    pub fn find_record(&self, query_id: &str) -> Result<QueryRecordSummary, PluginError> {
        let connection = self.open()?;
        connection
            .query_row(
                "SELECT id, config_id, config_name, queried_at, status, total_count, added_count, removed_count,
                        previous_record_id, previous_queried_at, previous_total_count, error_message
                 FROM query_records
                 WHERE id = ?1",
                params![query_id],
                |row| map_query_record_row(row),
            )
            .optional()
            .map_err(map_storage_error)?
            .ok_or_else(|| PluginError::NotFound(format!("未找到查询记录: {query_id}")))
    }

    pub fn list_query_detail(
        &self,
        query_id: &str,
        tab: QueryUserTab,
        keyword: &str,
        page: u32,
        page_size: u32,
    ) -> Result<QueryDetailResponse, PluginError> {
        let connection = self.open()?;
        let record = self.find_record(query_id)?;
        let safe_page = sanitize_page(page);
        let safe_page_size = sanitize_page_size(page_size, default_page_size(), 600);
        let normalized_keyword = keyword.trim();
        let like_keyword = if normalized_keyword.is_empty() {
            String::new()
        } else {
            format!("%{normalized_keyword}%")
        };
        let change_type_filter = match tab {
            QueryUserTab::All => String::new(),
            QueryUserTab::Added => "added".to_string(),
            QueryUserTab::Removed => "removed".to_string(),
        };

        let total_items: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM query_users
                 WHERE query_id = ?1
                   AND ((?2 = '' AND is_current = 1) OR (?2 != '' AND change_type = ?2))
                   AND (?3 = '' OR user_name LIKE ?4)",
                params![
                    query_id,
                    change_type_filter,
                    normalized_keyword,
                    like_keyword
                ],
                |row| row.get(0),
            )
            .map_err(map_storage_error)?;
        let total_pages = calculate_total_pages(total_items, safe_page_size);
        let offset = ((safe_page - 1) * safe_page_size) as i64;

        let mut statement = connection
            .prepare(
                "SELECT user_id, user_name, change_type
                 FROM query_users
                 WHERE query_id = ?1
                   AND ((?2 = '' AND is_current = 1) OR (?2 != '' AND change_type = ?2))
                   AND (?3 = '' OR user_name LIKE ?4)
                 ORDER BY user_name COLLATE NOCASE ASC
                 LIMIT ?5 OFFSET ?6",
            )
            .map_err(map_storage_error)?;
        let rows = statement
            .query_map(
                params![
                    query_id,
                    change_type_filter,
                    normalized_keyword,
                    like_keyword,
                    safe_page_size,
                    offset
                ],
                |row| {
                    Ok(QueryUserItem {
                        user_id: row.get(0)?,
                        user_name: row.get(1)?,
                        change_type: parse_change_type(&row.get::<_, String>(2)?)?,
                    })
                },
            )
            .map_err(map_storage_error)?;

        let mut users = Vec::new();
        for row in rows {
            users.push(row.map_err(map_storage_error)?);
        }

        Ok(QueryDetailResponse {
            record,
            selected_tab: tab,
            keyword: normalized_keyword.to_string(),
            page: safe_page,
            page_size: safe_page_size,
            total_items,
            total_pages,
            users,
        })
    }

    pub fn load_current_users(
        &self,
        query_id: &str,
    ) -> Result<BTreeMap<String, StoredSnapshotUser>, PluginError> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT user_id, user_name
                 FROM query_users
                 WHERE query_id = ?1 AND is_current = 1",
            )
            .map_err(map_storage_error)?;
        let rows = statement
            .query_map(params![query_id], |row| {
                Ok(StoredSnapshotUser {
                    user_id: row.get(0)?,
                    user_name: row.get(1)?,
                })
            })
            .map_err(map_storage_error)?;

        let mut users = BTreeMap::new();
        for row in rows {
            let user = row.map_err(map_storage_error)?;
            users.insert(user.user_id.clone(), user);
        }
        Ok(users)
    }

    pub fn save_query_record(
        &self,
        record: &QueryRecordInsert,
        users: &[QueryUserInsert],
    ) -> Result<(), PluginError> {
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(map_storage_error)?;

        transaction
            .execute(
                "INSERT INTO query_records (
                    id, config_id, config_name, queried_at, status, total_count, added_count, removed_count,
                    previous_record_id, previous_queried_at, previous_total_count, error_message
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    record.id,
                    record.config_id,
                    record.config_name,
                    record.queried_at,
                    stringify_status(record.status),
                    record.total_count,
                    record.added_count,
                    record.removed_count,
                    record.previous_record_id,
                    record.previous_queried_at,
                    record.previous_total_count,
                    record.error_message,
                ],
            )
            .map_err(map_storage_error)?;

        let mut statement = transaction
            .prepare(
                "INSERT INTO query_users (
                    query_id, user_id, user_name, change_type, is_current
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .map_err(map_storage_error)?;

        for user in users {
            statement
                .execute(params![
                    record.id,
                    user.user_id,
                    user.user_name,
                    stringify_change_type(user.change_type),
                    if user.is_current { 1 } else { 0 },
                ])
                .map_err(map_storage_error)?;
        }

        drop(statement);
        transaction.commit().map_err(map_storage_error)?;
        Ok(())
    }

    fn init(&self) -> Result<(), PluginError> {
        let connection = self.open()?;
        connection
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS configs (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    app_id TEXT NOT NULL,
                    app_secret TEXT NOT NULL,
                    last_test_result TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS query_records (
                    id TEXT PRIMARY KEY,
                    config_id TEXT NOT NULL,
                    config_name TEXT NOT NULL,
                    queried_at TEXT NOT NULL,
                    status TEXT NOT NULL,
                    total_count INTEGER NOT NULL,
                    added_count INTEGER NOT NULL,
                    removed_count INTEGER NOT NULL,
                    previous_record_id TEXT,
                    previous_queried_at TEXT,
                    previous_total_count INTEGER,
                    error_message TEXT
                );

                CREATE TABLE IF NOT EXISTS query_users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    query_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    user_name TEXT NOT NULL,
                    change_type TEXT NOT NULL,
                    is_current INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_query_records_config_time
                ON query_records(config_id, queried_at DESC);

                CREATE INDEX IF NOT EXISTS idx_query_users_query_id
                ON query_users(query_id);
                ",
            )
            .map_err(map_storage_error)?;
        Ok(())
    }

    fn open(&self) -> Result<Connection, PluginError> {
        Connection::open(&self.db_path).map_err(map_storage_error)
    }

    fn next_config_name(&self, connection: &Connection) -> Result<String, PluginError> {
        let mut statement = connection
            .prepare("SELECT name FROM configs ORDER BY created_at ASC")
            .map_err(map_storage_error)?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(map_storage_error)?;

        let mut max_index = 0_u32;
        for row in rows {
            let name = row.map_err(map_storage_error)?;
            if let Some(index) = name
                .strip_prefix("配置")
                .and_then(|value| value.parse::<u32>().ok())
            {
                max_index = max_index.max(index);
            }
        }

        Ok(format!("配置{}", max_index + 1))
    }

    fn find_config_by_id(
        &self,
        connection: &Connection,
        config_id: &str,
    ) -> Result<Option<DingtalkConfig>, PluginError> {
        connection
            .query_row(
                "SELECT id, name, base_url, app_id, app_secret, last_test_result, created_at, updated_at
                 FROM configs
                 WHERE id = ?1",
                params![config_id],
                |row| map_config_row(row),
            )
            .optional()
            .map_err(map_storage_error)
    }
}

fn map_config_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DingtalkConfig> {
    let last_test_result = row.get::<_, Option<String>>(5)?;
    Ok(DingtalkConfig {
        id: row.get(0)?,
        name: row.get(1)?,
        base_url: row.get(2)?,
        app_id: row.get(3)?,
        app_secret: row.get(4)?,
        last_test_result: deserialize_optional_json(last_test_result)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn map_query_record_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<QueryRecordSummary> {
    let previous_total_count: Option<i64> = row.get(10)?;
    let total_count: i64 = row.get(5)?;
    let compare_rate = previous_total_count.and_then(|previous| {
        if previous <= 0 {
            None
        } else {
            Some((total_count - previous) as f64 / previous as f64 * 100_f64)
        }
    });

    Ok(QueryRecordSummary {
        id: row.get(0)?,
        config_id: row.get(1)?,
        config_name: row.get(2)?,
        queried_at: row.get(3)?,
        status: parse_status(&row.get::<_, String>(4)?)?,
        total_count,
        added_count: row.get(6)?,
        removed_count: row.get(7)?,
        previous_record_id: row.get(8)?,
        previous_queried_at: row.get(9)?,
        previous_total_count,
        error_message: row.get(11)?,
        compare_rate,
        compare_rate_label: build_compare_rate_label(compare_rate, previous_total_count),
    })
}

fn build_compare_rate_label(
    compare_rate: Option<f64>,
    previous_total_count: Option<i64>,
) -> String {
    match (compare_rate, previous_total_count) {
        (_, None) => "首次查询".to_string(),
        (Some(rate), Some(_)) => {
            let sign = if rate >= 0.0 { "+" } else { "" };
            format!("较上次 {sign}{rate:.1}%")
        }
        (None, Some(_)) => "较上次 0.0%".to_string(),
    }
}

fn serialize_optional_json<T>(value: &Option<T>) -> Result<Option<String>, PluginError>
where
    T: serde::Serialize,
{
    value
        .as_ref()
        .map(|item| {
            serde_json::to_string(item)
                .map_err(|error| PluginError::Storage(format!("序列化 JSON 失败: {error}")))
        })
        .transpose()
}

fn deserialize_optional_json<T>(value: Option<String>) -> rusqlite::Result<Option<T>>
where
    T: for<'de> serde::Deserialize<'de>,
{
    match value {
        Some(payload) => serde_json::from_str::<T>(&payload)
            .map(Some)
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    payload.len(),
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            }),
        None => Ok(None),
    }
}

fn map_storage_error(error: rusqlite::Error) -> PluginError {
    PluginError::Storage(format!("插件数据读写失败: {error}"))
}

fn normalize_text(value: &str, label: &str) -> Result<String, PluginError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(PluginError::InvalidInput(format!("{label}不能为空")));
    }
    Ok(trimmed.to_string())
}

fn optional_string(value: &str) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn sanitize_page(page: u32) -> u32 {
    page.max(1)
}

fn sanitize_page_size(page_size: u32, default_value: u32, max_value: u32) -> u32 {
    page_size
        .clamp(1, max_value)
        .max(default_value.min(max_value))
}

fn calculate_total_pages(total_items: i64, page_size: u32) -> u32 {
    if total_items <= 0 {
        return 0;
    }

    ((total_items as f64) / (page_size as f64)).ceil() as u32
}

fn stringify_status(status: QueryStatus) -> &'static str {
    match status {
        QueryStatus::Success => "success",
        QueryStatus::Failed => "failed",
    }
}

fn parse_status(value: &str) -> rusqlite::Result<QueryStatus> {
    match value {
        "success" => Ok(QueryStatus::Success),
        "failed" => Ok(QueryStatus::Failed),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            other.len(),
            rusqlite::types::Type::Text,
            format!("unknown status: {other}").into(),
        )),
    }
}

fn stringify_change_type(change_type: ChangeType) -> &'static str {
    match change_type {
        ChangeType::None => "none",
        ChangeType::Added => "added",
        ChangeType::Removed => "removed",
    }
}

fn parse_change_type(value: &str) -> rusqlite::Result<ChangeType> {
    match value {
        "none" => Ok(ChangeType::None),
        "added" => Ok(ChangeType::Added),
        "removed" => Ok(ChangeType::Removed),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            other.len(),
            rusqlite::types::Type::Text,
            format!("unknown change type: {other}").into(),
        )),
    }
}

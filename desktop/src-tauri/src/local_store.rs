use crate::models::{
    CompareHistoryInput, CompareHistoryItem, CompareHistoryType, ConnectionProfile,
    DataSourceGroup, DeleteDataSourceGroupResult, ImportConnectionProfilesResult,
    ImportedConnectionProfileItem, RenameDataSourceGroupResult, SaveConnectionProfilePayload,
    SkippedImportItem,
};
use crate::navicat::NavicatConnectionCandidate;
use anyhow::{Context, Result, ensure};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct LocalStore {
    database_path: PathBuf,
}

impl LocalStore {
    pub fn new(database_path: impl AsRef<Path>) -> Result<Self> {
        let store = Self {
            database_path: database_path.as_ref().to_path_buf(),
        };
        store.initialize()?;
        Ok(store)
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub fn list_connection_profiles(&self) -> Result<Vec<ConnectionProfile>> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "
            SELECT
                id,
                group_name,
                data_source_name,
                host,
                port,
                username,
                password,
                created_at,
                updated_at
            FROM connection_profiles
            ORDER BY COALESCE(group_name, ''), data_source_name, created_at
            ",
        )?;

        let rows = statement.query_map([], |row| {
            Ok(ConnectionProfile {
                id: row.get(0)?,
                group_name: row.get(1)?,
                data_source_name: row.get(2)?,
                host: row.get(3)?,
                port: row.get(4)?,
                username: row.get(5)?,
                password: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;

        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("读取连接配置失败")
    }

    pub fn list_data_source_groups(&self) -> Result<Vec<DataSourceGroup>> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "
            SELECT
                id,
                group_name,
                created_at,
                updated_at
            FROM data_source_groups
            ORDER BY group_name
            ",
        )?;

        let rows = statement.query_map([], |row| {
            Ok(DataSourceGroup {
                id: row.get(0)?,
                group_name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?;

        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("读取数据源分组失败")
    }

    pub fn load_connection_profile(&self, profile_id: &str) -> Result<ConnectionProfile> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "
            SELECT
                id,
                group_name,
                data_source_name,
                host,
                port,
                username,
                password,
                created_at,
                updated_at
            FROM connection_profiles
            WHERE id = ?
            ",
        )?;

        statement
            .query_row([profile_id], |row| {
                Ok(ConnectionProfile {
                    id: row.get(0)?,
                    group_name: row.get(1)?,
                    data_source_name: row.get(2)?,
                    host: row.get(3)?,
                    port: row.get(4)?,
                    username: row.get(5)?,
                    password: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .context("连接配置不存在")
    }

    pub fn save_connection_profile(
        &self,
        payload: SaveConnectionProfilePayload,
    ) -> Result<ConnectionProfile> {
        validate_payload(&payload)?;

        let profile_id = payload.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now().to_rfc3339();
        let group_name = normalize_optional(payload.group_name);
        let created_at = self
            .load_connection_profile(&profile_id)
            .map(|profile| profile.created_at)
            .unwrap_or_else(|_| now.clone());

        let connection = self.open_connection()?;
        ensure_data_source_group(&connection, group_name.as_deref())?;
        connection.execute(
            "
            INSERT INTO connection_profiles (
                id,
                group_name,
                data_source_name,
                host,
                port,
                username,
                password,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                group_name = excluded.group_name,
                data_source_name = excluded.data_source_name,
                host = excluded.host,
                port = excluded.port,
                username = excluded.username,
                password = excluded.password,
                updated_at = excluded.updated_at
            ",
            params![
                profile_id,
                group_name,
                payload.data_source_name.trim(),
                payload.host.trim(),
                payload.port,
                payload.username.trim(),
                payload.password,
                created_at,
                now,
            ],
        )?;

        self.load_connection_profile(&profile_id)
    }

    pub fn import_connection_profiles(
        &self,
        items: Vec<NavicatConnectionCandidate>,
        skipped_items: Vec<SkippedImportItem>,
        file_path: Option<String>,
    ) -> Result<ImportConnectionProfilesResult> {
        let connection = self.open_connection()?;
        let mut imported_items = Vec::new();
        let mut created_count = 0_usize;
        let mut updated_count = 0_usize;
        let mut unresolved_password_count = 0_usize;

        for item in dedupe_import_candidates(items) {
            validate_import_candidate(&item)?;

            let existing = connection
                .query_row(
                    "
                    SELECT id, group_name, password
                    FROM connection_profiles
                    WHERE data_source_name = ?
                    LIMIT 1
                    ",
                    [item.data_source_name.as_str()],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()?;

            let now = Utc::now().to_rfc3339();
            let password = if item.password.trim().is_empty() {
                unresolved_password_count += 1;
                existing
                    .as_ref()
                    .map(|(_, _, password)| password.clone())
                    .unwrap_or_default()
            } else {
                item.password.trim().to_string()
            };
            let group_name = item
                .group_name
                .clone()
                .or_else(|| {
                    existing
                        .as_ref()
                        .and_then(|(_, group_name, _)| group_name.clone())
                })
                .and_then(|value| {
                    let normalized = value.trim().to_string();
                    (!normalized.is_empty()).then_some(normalized)
                });
            ensure_data_source_group(&connection, group_name.as_deref())?;

            if let Some((profile_id, _, _)) = existing {
                connection.execute(
                    "
                    UPDATE connection_profiles
                    SET group_name = ?, data_source_name = ?, host = ?, port = ?, username = ?,
                        password = ?, updated_at = ?
                    WHERE id = ?
                    ",
                    params![
                        group_name,
                        item.data_source_name.trim(),
                        item.host.trim(),
                        item.port,
                        item.username.trim(),
                        password,
                        now,
                        profile_id,
                    ],
                )?;

                imported_items.push(ImportedConnectionProfileItem {
                    id: profile_id.clone(),
                    data_source_name: item.data_source_name,
                    password_resolved: !password.is_empty(),
                });
                updated_count += 1;
            } else {
                let profile_id = Uuid::new_v4().to_string();
                connection.execute(
                    "
                    INSERT INTO connection_profiles (
                        id,
                        group_name,
                        data_source_name,
                        host,
                        port,
                        username,
                        password,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ",
                    params![
                        profile_id,
                        group_name,
                        item.data_source_name.trim(),
                        item.host.trim(),
                        item.port,
                        item.username.trim(),
                        password,
                        now,
                        now,
                    ],
                )?;

                imported_items.push(ImportedConnectionProfileItem {
                    id: profile_id,
                    data_source_name: item.data_source_name,
                    password_resolved: !password.is_empty(),
                });
                created_count += 1;
            }
        }

        Ok(ImportConnectionProfilesResult {
            canceled: false,
            file_path,
            total_count: imported_items.len(),
            created_count,
            updated_count,
            unresolved_password_count,
            skipped_count: skipped_items.len(),
            imported_items,
            skipped_items,
        })
    }

    pub fn create_data_source_group(&self, group_name: String) -> Result<DataSourceGroup> {
        let connection = self.open_connection()?;
        let normalized_name = validate_group_name(&group_name)?;
        ensure_group_name_unique(&connection, None, &normalized_name)?;

        let group_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        connection.execute(
            "
            INSERT INTO data_source_groups (id, group_name, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ",
            params![group_id, normalized_name, now, now],
        )?;

        load_data_source_group(&connection, &group_id)
    }

    pub fn rename_data_source_group(
        &self,
        group_id: &str,
        group_name: String,
    ) -> Result<RenameDataSourceGroupResult> {
        let mut connection = self.open_connection()?;
        let normalized_name = validate_group_name(&group_name)?;
        let transaction = connection.transaction()?;
        let existing_group = load_data_source_group(&transaction, group_id)?;
        ensure_group_name_unique(&transaction, Some(group_id), &normalized_name)?;
        let previous_group_name = existing_group.group_name.clone();
        let now = Utc::now().to_rfc3339();

        let affected_profile_count = if previous_group_name == normalized_name {
            0
        } else {
            // 分组重命名时同步刷新所有关联数据源，保持树结构与下拉选项一致。
            transaction.execute(
                "
                UPDATE connection_profiles
                SET group_name = ?, updated_at = ?
                WHERE group_name = ?
                ",
                params![
                    normalized_name.as_str(),
                    now.as_str(),
                    previous_group_name.as_str()
                ],
            )? as u64
        };

        transaction.execute(
            "
            UPDATE data_source_groups
            SET group_name = ?, updated_at = ?
            WHERE id = ?
            ",
            params![normalized_name.as_str(), now.as_str(), group_id],
        )?;

        transaction.commit()?;

        Ok(RenameDataSourceGroupResult {
            group_id: group_id.to_string(),
            previous_group_name,
            group_name: normalized_name,
            affected_profile_count,
        })
    }

    pub fn delete_data_source_group(&self, group_id: &str) -> Result<DeleteDataSourceGroupResult> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let existing_group = load_data_source_group(&transaction, group_id)?;
        let group_name = existing_group.group_name.clone();
        let now = Utc::now().to_rfc3339();

        // 删除分组后，原有数据源自动回落到未分组，避免引用悬空分组名。
        let affected_profile_count = transaction.execute(
            "
            UPDATE connection_profiles
            SET group_name = NULL, updated_at = ?
            WHERE group_name = ?
            ",
            params![now.as_str(), group_name.as_str()],
        )? as u64;

        transaction.execute(
            "
            DELETE FROM data_source_groups
            WHERE id = ?
            ",
            [group_id],
        )?;
        transaction.commit()?;

        Ok(DeleteDataSourceGroupResult {
            group_id: group_id.to_string(),
            group_name,
            affected_profile_count,
        })
    }

    pub fn delete_connection_profile(&self, profile_id: &str) -> Result<()> {
        let connection = self.open_connection()?;
        connection.execute("DELETE FROM connection_profiles WHERE id = ?", [profile_id])?;
        Ok(())
    }

    pub fn list_compare_history(&self, limit: usize) -> Result<Vec<CompareHistoryItem>> {
        let connection = self.open_connection()?;
        let safe_limit = limit.clamp(1, 500) as i64;
        let mut statement = connection.prepare(
            "
            SELECT
                id,
                history_type,
                source_profile_id,
                source_data_source_name,
                source_database,
                target_profile_id,
                target_data_source_name,
                target_database,
                table_mode,
                selected_tables_json,
                table_detail_json,
                performance_json,
                source_table_count,
                target_table_count,
                total_tables,
                compared_tables,
                insert_count,
                update_count,
                delete_count,
                structure_added_count,
                structure_modified_count,
                structure_deleted_count,
                created_at
            FROM compare_history
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            ",
        )?;
        let rows = statement.query_map([safe_limit], map_compare_history_row)?;

        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("读取对比记录失败")
    }

    pub fn append_compare_history(&self, input: CompareHistoryInput) -> Result<CompareHistoryItem> {
        let connection = self.open_connection()?;
        let created_at = Utc::now().to_rfc3339();
        let selected_tables_json = serde_json::to_string(&input.selected_tables)?;
        let table_detail_json = serde_json::to_string(&input.table_detail)?;
        let performance_json = serde_json::to_string(&input.performance)?;

        connection.execute(
            "
            INSERT INTO compare_history (
                history_type,
                source_profile_id,
                source_data_source_name,
                source_database,
                target_profile_id,
                target_data_source_name,
                target_database,
                table_mode,
                selected_tables_json,
                table_detail_json,
                performance_json,
                source_table_count,
                target_table_count,
                total_tables,
                compared_tables,
                insert_count,
                update_count,
                delete_count,
                structure_added_count,
                structure_modified_count,
                structure_deleted_count,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ",
            params![
                input.history_type.as_str(),
                input.source_profile_id,
                input.source_data_source_name.trim(),
                input.source_database.trim(),
                input.target_profile_id,
                input.target_data_source_name.trim(),
                input.target_database.trim(),
                normalize_history_table_mode(&input.table_mode),
                selected_tables_json,
                table_detail_json,
                performance_json,
                input.source_table_count as i64,
                input.target_table_count as i64,
                input.total_tables as i64,
                input.compared_tables as i64,
                input.insert_count as i64,
                input.update_count as i64,
                input.delete_count as i64,
                input.structure_added_count as i64,
                input.structure_modified_count as i64,
                input.structure_deleted_count as i64,
                created_at,
            ],
        )?;

        connection
            .query_row(
                "
                SELECT
                    id,
                    history_type,
                    source_profile_id,
                    source_data_source_name,
                    source_database,
                    target_profile_id,
                    target_data_source_name,
                    target_database,
                    table_mode,
                    selected_tables_json,
                    table_detail_json,
                    performance_json,
                    source_table_count,
                    target_table_count,
                    total_tables,
                    compared_tables,
                    insert_count,
                    update_count,
                    delete_count,
                    structure_added_count,
                    structure_modified_count,
                    structure_deleted_count,
                    created_at
                FROM compare_history
                WHERE id = ?
                ",
                [connection.last_insert_rowid()],
                map_compare_history_row,
            )
            .context("读取新增对比记录失败")
    }

    fn initialize(&self) -> Result<()> {
        let connection = self.open_connection()?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS app_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            INSERT OR IGNORE INTO app_meta (key, value)
            VALUES ('bootstrap', 'ready');
            ",
        )?;

        let runtime_profile = if cfg!(debug_assertions) {
            "dev"
        } else {
            "release"
        };
        connection.execute(
            "
            INSERT INTO app_meta (key, value)
            VALUES ('runtime_profile', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            [runtime_profile],
        )?;

        self.migrate_connection_profiles(&connection)?;
        self.migrate_data_source_groups(&connection)?;
        self.migrate_compare_history(&connection)?;
        Ok(())
    }

    fn migrate_connection_profiles(&self, connection: &Connection) -> Result<()> {
        if !table_exists(connection, "connection_profiles")? {
            connection.execute_batch(
                "
                CREATE TABLE connection_profiles (
                    id TEXT PRIMARY KEY,
                    group_name TEXT,
                    data_source_name TEXT NOT NULL,
                    host TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    username TEXT NOT NULL,
                    password TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX idx_connection_profiles_group_name
                    ON connection_profiles(group_name, data_source_name);
                ",
            )?;
            return Ok(());
        }

        let columns = load_table_columns(connection, "connection_profiles")?;
        let has_legacy_columns = columns.contains("environment")
            || columns.contains("instance_name")
            || columns.contains("default_database")
            || !columns.contains("group_name");

        if !has_legacy_columns {
            connection.execute_batch(
                "
                CREATE INDEX IF NOT EXISTS idx_connection_profiles_group_name
                    ON connection_profiles(group_name, data_source_name);
                ",
            )?;
            return Ok(());
        }

        connection.execute_batch(
            "
            DROP TABLE IF EXISTS connection_profiles_next;

            CREATE TABLE connection_profiles_next (
                id TEXT PRIMARY KEY,
                group_name TEXT,
                data_source_name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            ",
        )?;

        let group_name_expr = if columns.contains("group_name") {
            "NULLIF(TRIM(group_name), '')"
        } else if columns.contains("environment") {
            "NULLIF(TRIM(environment), '')"
        } else {
            "NULL"
        };
        let data_source_name_expr = if columns.contains("data_source_name") {
            "data_source_name"
        } else if columns.contains("instance_name") {
            "instance_name"
        } else {
            "id"
        };
        let created_at_expr = if columns.contains("created_at") {
            "created_at"
        } else {
            "CURRENT_TIMESTAMP"
        };
        let updated_at_expr = if columns.contains("updated_at") {
            "updated_at"
        } else {
            "CURRENT_TIMESTAMP"
        };

        let copy_sql = format!(
            "
            INSERT INTO connection_profiles_next (
                id,
                group_name,
                data_source_name,
                host,
                port,
                username,
                password,
                created_at,
                updated_at
            )
            SELECT
                id,
                {group_name_expr},
                {data_source_name_expr},
                host,
                port,
                username,
                password,
                {created_at_expr},
                {updated_at_expr}
            FROM connection_profiles
            "
        );

        connection.execute_batch(&copy_sql)?;
        connection.execute_batch(
            "
            DROP TABLE connection_profiles;
            ALTER TABLE connection_profiles_next RENAME TO connection_profiles;
            CREATE INDEX idx_connection_profiles_group_name
                ON connection_profiles(group_name, data_source_name);
            ",
        )?;

        Ok(())
    }

    fn migrate_data_source_groups(&self, connection: &Connection) -> Result<()> {
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS data_source_groups (
                id TEXT PRIMARY KEY,
                group_name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_data_source_groups_group_name
                ON data_source_groups(group_name);
            ",
        )?;

        let mut statement = connection.prepare(
            "
            SELECT DISTINCT TRIM(group_name)
            FROM connection_profiles
            WHERE NULLIF(TRIM(group_name), '') IS NOT NULL
            ORDER BY TRIM(group_name)
            ",
        )?;
        let group_names = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        for group_name in group_names {
            ensure_data_source_group(connection, Some(group_name.as_str()))?;
        }

        Ok(())
    }

    fn migrate_compare_history(&self, connection: &Connection) -> Result<()> {
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS compare_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                history_type TEXT NOT NULL,
                source_profile_id TEXT,
                source_data_source_name TEXT NOT NULL,
                source_database TEXT NOT NULL,
                target_profile_id TEXT,
                target_data_source_name TEXT NOT NULL,
                target_database TEXT NOT NULL,
                table_mode TEXT NOT NULL,
                selected_tables_json TEXT NOT NULL,
                table_detail_json TEXT NOT NULL,
                performance_json TEXT NOT NULL,
                source_table_count INTEGER NOT NULL,
                target_table_count INTEGER NOT NULL,
                total_tables INTEGER NOT NULL,
                compared_tables INTEGER NOT NULL,
                insert_count INTEGER NOT NULL,
                update_count INTEGER NOT NULL,
                delete_count INTEGER NOT NULL,
                structure_added_count INTEGER NOT NULL,
                structure_modified_count INTEGER NOT NULL,
                structure_deleted_count INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_compare_history_created_at
                ON compare_history(created_at DESC);
            ",
        )?;

        Ok(())
    }

    fn open_connection(&self) -> Result<Connection> {
        let connection =
            Connection::open(&self.database_path).context("无法打开本地 sqlite 数据库")?;

        // 本地配置存储采用 WAL，可降低后续扩展草稿/历史时的写锁竞争。
        connection
            .busy_timeout(Duration::from_secs(5))
            .context("无法配置 sqlite busy_timeout")?;
        connection
            .pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))
            .context("无法启用 sqlite WAL 模式")?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .context("无法启用 sqlite foreign_keys")?;
        connection
            .pragma_update(None, "synchronous", "NORMAL")
            .context("无法配置 sqlite synchronous 模式")?;

        Ok(connection)
    }
}

fn table_exists(connection: &Connection, table_name: &str) -> Result<bool> {
    let exists = connection.query_row(
        "
        SELECT EXISTS(
            SELECT 1
            FROM sqlite_master
            WHERE type = 'table'
              AND name = ?
        )
        ",
        [table_name],
        |row| row.get::<_, i64>(0),
    )?;

    Ok(exists == 1)
}

fn load_table_columns(connection: &Connection, table_name: &str) -> Result<HashSet<String>> {
    let pragma_sql = format!("PRAGMA table_info({table_name})");
    let mut statement = connection.prepare(&pragma_sql)?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
    let columns = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(columns.into_iter().collect())
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let normalized = raw.trim().to_string();
        (!normalized.is_empty()).then_some(normalized)
    })
}

fn validate_group_name(group_name: &str) -> Result<String> {
    let normalized = group_name.trim().to_string();
    ensure!(!normalized.is_empty(), "分组名称不能为空");
    Ok(normalized)
}

fn ensure_group_name_unique(
    connection: &Connection,
    exclude_group_id: Option<&str>,
    group_name: &str,
) -> Result<()> {
    let exists = if let Some(group_id) = exclude_group_id {
        connection.query_row(
            "
            SELECT EXISTS(
                SELECT 1
                FROM data_source_groups
                WHERE group_name = ?
                  AND id <> ?
            )
            ",
            params![group_name, group_id],
            |row| row.get::<_, i64>(0),
        )?
    } else {
        connection.query_row(
            "
            SELECT EXISTS(
                SELECT 1
                FROM data_source_groups
                WHERE group_name = ?
            )
            ",
            [group_name],
            |row| row.get::<_, i64>(0),
        )?
    };

    ensure!(exists == 0, "分组名称已存在");
    Ok(())
}

fn load_data_source_group(connection: &Connection, group_id: &str) -> Result<DataSourceGroup> {
    connection
        .query_row(
            "
            SELECT id, group_name, created_at, updated_at
            FROM data_source_groups
            WHERE id = ?
            ",
            [group_id],
            |row| {
                Ok(DataSourceGroup {
                    id: row.get(0)?,
                    group_name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .context("数据源分组不存在")
}

fn ensure_data_source_group(connection: &Connection, group_name: Option<&str>) -> Result<()> {
    let Some(group_name) = group_name else {
        return Ok(());
    };

    let normalized_name = validate_group_name(group_name)?;
    let exists = connection.query_row(
        "
        SELECT EXISTS(
            SELECT 1
            FROM data_source_groups
            WHERE group_name = ?
        )
        ",
        [normalized_name.as_str()],
        |row| row.get::<_, i64>(0),
    )?;

    if exists == 1 {
        return Ok(());
    }

    let now = Utc::now().to_rfc3339();
    connection.execute(
        "
        INSERT OR IGNORE INTO data_source_groups (id, group_name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ",
        params![Uuid::new_v4().to_string(), normalized_name, now, now],
    )?;

    Ok(())
}

fn validate_payload(payload: &SaveConnectionProfilePayload) -> Result<()> {
    ensure!(
        !payload.data_source_name.trim().is_empty(),
        "数据源名称不能为空"
    );
    ensure!(!payload.host.trim().is_empty(), "主机不能为空");
    ensure!(!payload.username.trim().is_empty(), "用户名不能为空");
    ensure!(!payload.password.is_empty(), "密码不能为空");
    ensure!(payload.port > 0, "端口必须大于 0");
    Ok(())
}

fn validate_import_candidate(candidate: &NavicatConnectionCandidate) -> Result<()> {
    ensure!(
        !candidate.data_source_name.trim().is_empty(),
        "导入数据源名称不能为空"
    );
    ensure!(!candidate.host.trim().is_empty(), "导入数据源主机不能为空");
    ensure!(
        !candidate.username.trim().is_empty(),
        "导入数据源用户名不能为空"
    );
    ensure!(candidate.port > 0, "导入数据源端口必须大于 0");
    Ok(())
}

fn dedupe_import_candidates(
    items: Vec<NavicatConnectionCandidate>,
) -> Vec<NavicatConnectionCandidate> {
    let mut deduped = std::collections::BTreeMap::new();
    for item in items {
        deduped.insert(item.data_source_name.clone(), item);
    }
    deduped.into_values().collect()
}

fn normalize_history_table_mode(value: &str) -> &'static str {
    if value == "selected" {
        "selected"
    } else {
        "all"
    }
}

fn map_compare_history_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CompareHistoryItem> {
    Ok(CompareHistoryItem {
        id: row.get(0)?,
        history_type: normalize_history_type(&row.get::<_, String>(1)?),
        source_profile_id: row.get(2)?,
        source_data_source_name: row.get(3)?,
        source_database: row.get(4)?,
        target_profile_id: row.get(5)?,
        target_data_source_name: row.get(6)?,
        target_database: row.get(7)?,
        table_mode: row.get(8)?,
        selected_tables: parse_json_value(&row.get::<_, String>(9)?),
        table_detail: parse_json_value(&row.get::<_, String>(10)?),
        performance: parse_json_value(&row.get::<_, String>(11)?),
        source_table_count: row.get::<_, i64>(12)? as usize,
        target_table_count: row.get::<_, i64>(13)? as usize,
        total_tables: row.get::<_, i64>(14)? as usize,
        compared_tables: row.get::<_, i64>(15)? as usize,
        insert_count: row.get::<_, i64>(16)? as usize,
        update_count: row.get::<_, i64>(17)? as usize,
        delete_count: row.get::<_, i64>(18)? as usize,
        structure_added_count: row.get::<_, i64>(19)? as usize,
        structure_modified_count: row.get::<_, i64>(20)? as usize,
        structure_deleted_count: row.get::<_, i64>(21)? as usize,
        created_at: row.get(22)?,
    })
}

fn normalize_history_type(value: &str) -> CompareHistoryType {
    if value == CompareHistoryType::Structure.as_str() {
        CompareHistoryType::Structure
    } else {
        CompareHistoryType::Data
    }
}

fn parse_json_value<T>(raw: &str) -> T
where
    T: serde::de::DeserializeOwned + Default,
{
    serde_json::from_str(raw).unwrap_or_default()
}

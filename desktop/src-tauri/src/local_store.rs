use crate::models::{
    AssignProfilesToDataSourceGroupResult, CompareHistoryInput, CompareHistoryItem,
    CompareHistoryPerformance, CompareHistorySummary, CompareHistoryType, ConnectionProfile,
    DataSourceGroup, DeleteDataSourceGroupResult, ImportConnectionProfilesResult,
    ImportedConnectionProfileItem, RedisConnectionProfile, RenameDataSourceGroupResult,
    SaveConnectionProfilePayload, SaveRedisConnectionPayload, SkippedImportItem,
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

    pub fn list_redis_connection_profiles(&self) -> Result<Vec<RedisConnectionProfile>> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "
            SELECT
                id,
                group_name,
                connection_name,
                host,
                port,
                username,
                password,
                database_index,
                connect_timeout_ms,
                created_at,
                updated_at
            FROM redis_connection_profiles
            ORDER BY COALESCE(group_name, ''), connection_name, created_at
            ",
        )?;

        let rows = statement.query_map([], map_redis_connection_profile_row)?;

        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("读取 Redis 连接配置失败")
    }

    pub fn load_redis_connection_profile(
        &self,
        profile_id: &str,
    ) -> Result<RedisConnectionProfile> {
        let connection = self.open_connection()?;
        connection
            .query_row(
                "
                SELECT
                    id,
                    group_name,
                    connection_name,
                    host,
                    port,
                    username,
                    password,
                    database_index,
                    connect_timeout_ms,
                    created_at,
                    updated_at
                FROM redis_connection_profiles
                WHERE id = ?
                ",
                [profile_id],
                map_redis_connection_profile_row,
            )
            .context("Redis 连接配置不存在")
    }

    pub fn save_redis_connection_profile(
        &self,
        payload: SaveRedisConnectionPayload,
    ) -> Result<RedisConnectionProfile> {
        validate_redis_payload(&payload)?;

        let profile_id = payload.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now().to_rfc3339();
        let existing = self.load_redis_connection_profile(&profile_id).ok();
        let created_at = existing
            .as_ref()
            .map(|profile| profile.created_at.clone())
            .unwrap_or_else(|| now.clone());
        let password = if payload.password.is_empty() {
            existing
                .as_ref()
                .map(|profile| profile.password.clone())
                .unwrap_or_default()
        } else {
            payload.password
        };
        let group_name = normalize_optional(payload.group_name);

        let connection = self.open_connection()?;
        ensure_data_source_group(&connection, group_name.as_deref())?;
        connection.execute(
            "
            INSERT INTO redis_connection_profiles (
                id,
                group_name,
                connection_name,
                host,
                port,
                username,
                password,
                database_index,
                connect_timeout_ms,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                group_name = excluded.group_name,
                connection_name = excluded.connection_name,
                host = excluded.host,
                port = excluded.port,
                username = excluded.username,
                password = excluded.password,
                database_index = excluded.database_index,
                connect_timeout_ms = excluded.connect_timeout_ms,
                updated_at = excluded.updated_at
            ",
            params![
                profile_id,
                group_name,
                payload.connection_name.trim(),
                payload.host.trim(),
                payload.port,
                payload.username.trim(),
                password,
                payload.database_index,
                payload.connect_timeout_ms as i64,
                created_at,
                now,
            ],
        )?;

        self.load_redis_connection_profile(&profile_id)
    }

    pub fn delete_redis_connection_profile(&self, profile_id: &str) -> Result<()> {
        let connection = self.open_connection()?;
        connection.execute(
            "DELETE FROM redis_connection_profiles WHERE id = ?",
            [profile_id],
        )?;
        Ok(())
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
        let existing = payload
            .id
            .as_deref()
            .and_then(|profile_id| self.load_connection_profile(profile_id).ok());
        let password = if payload.password.is_empty() {
            existing
                .as_ref()
                .map(|profile| profile.password.clone())
                .unwrap_or_default()
        } else {
            payload.password.clone()
        };
        validate_payload(&payload, &password)?;
        let profile_id = payload.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now().to_rfc3339();
        let group_name = normalize_optional(payload.group_name);
        let created_at = existing
            .as_ref()
            .map(|profile| profile.created_at.clone())
            .unwrap_or_else(|| now.clone());

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
                password,
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
            let mysql_affected_count = transaction.execute(
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
            )? as u64;

            let redis_affected_count = transaction.execute(
                "
                UPDATE redis_connection_profiles
                SET group_name = ?, updated_at = ?
                WHERE group_name = ?
                ",
                params![
                    normalized_name.as_str(),
                    now.as_str(),
                    previous_group_name.as_str()
                ],
            )? as u64;

            mysql_affected_count + redis_affected_count
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
        let mysql_affected_count = transaction.execute(
            "
            UPDATE connection_profiles
            SET group_name = NULL, updated_at = ?
            WHERE group_name = ?
            ",
            params![now.as_str(), group_name.as_str()],
        )? as u64;

        let redis_affected_count = transaction.execute(
            "
            UPDATE redis_connection_profiles
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
            affected_profile_count: mysql_affected_count + redis_affected_count,
        })
    }

    pub fn assign_profiles_to_data_source_group(
        &self,
        group_id: &str,
        profile_ids: Vec<String>,
    ) -> Result<AssignProfilesToDataSourceGroupResult> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let target_group = load_data_source_group(&transaction, group_id)?;
        let now = Utc::now().to_rfc3339();
        let profile_ids = profile_ids
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect::<HashSet<_>>();

        // 批量调整数据源归组时放在同一事务中，避免部分成功导致树结构和列表不一致。
        let mut affected_profile_count = 0_u64;
        for profile_id in profile_ids {
            affected_profile_count += transaction.execute(
                "
                UPDATE connection_profiles
                SET group_name = ?, updated_at = ?
                WHERE id = ?
                ",
                params![target_group.group_name.as_str(), now.as_str(), profile_id],
            )? as u64;
        }

        transaction.commit()?;

        Ok(AssignProfilesToDataSourceGroupResult {
            group_id: target_group.id,
            group_name: target_group.group_name,
            affected_profile_count,
        })
    }

    pub fn delete_connection_profile(&self, profile_id: &str) -> Result<()> {
        let connection = self.open_connection()?;
        connection.execute("DELETE FROM connection_profiles WHERE id = ?", [profile_id])?;
        Ok(())
    }

    pub fn list_compare_history_summaries(
        &self,
        limit: usize,
    ) -> Result<Vec<CompareHistorySummary>> {
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
                total_elapsed_ms,
                created_at
            FROM compare_history
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            ",
        )?;
        let rows = statement.query_map([safe_limit], map_compare_history_summary_row)?;

        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("读取对比记录失败")
    }

    pub fn load_compare_history_detail(
        &self,
        history_id: i64,
    ) -> Result<Option<CompareHistoryItem>> {
        let connection = self.open_connection()?;
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
                [history_id],
                map_compare_history_row,
            )
            .optional()
            .context("读取对比记录详情失败")
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
                total_elapsed_ms,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                input.performance.total_elapsed_ms as i64,
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
        self.migrate_redis_connection_profiles(&connection)?;
        // 分组表依赖连接表里的 group_name，必须在各连接表迁移完成后再做回填。
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

        if table_exists(connection, "redis_connection_profiles")?
            && load_table_columns(connection, "redis_connection_profiles")?.contains("group_name")
        {
            let mut redis_statement = connection.prepare(
                "
                SELECT DISTINCT TRIM(group_name)
                FROM redis_connection_profiles
                WHERE NULLIF(TRIM(group_name), '') IS NOT NULL
                ORDER BY TRIM(group_name)
                ",
            )?;
            let redis_group_names = redis_statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            for group_name in redis_group_names {
                ensure_data_source_group(connection, Some(group_name.as_str()))?;
            }
        }

        Ok(())
    }

    fn migrate_redis_connection_profiles(&self, connection: &Connection) -> Result<()> {
        if !table_exists(connection, "redis_connection_profiles")? {
            connection.execute_batch(
                "
                CREATE TABLE redis_connection_profiles (
                    id TEXT PRIMARY KEY,
                    group_name TEXT,
                    connection_name TEXT NOT NULL,
                    host TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    username TEXT NOT NULL,
                    password TEXT NOT NULL,
                    database_index INTEGER NOT NULL,
                    connect_timeout_ms INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX idx_redis_connection_profiles_group_name
                    ON redis_connection_profiles(group_name, connection_name);
                ",
            )?;
            return Ok(());
        }

        let columns = load_table_columns(connection, "redis_connection_profiles")?;
        if columns.contains("group_name") {
            connection.execute_batch(
                "
                CREATE INDEX IF NOT EXISTS idx_redis_connection_profiles_group_name
                    ON redis_connection_profiles(group_name, connection_name);
                ",
            )?;
            return Ok(());
        }

        connection.execute_batch(
            "
            DROP TABLE IF EXISTS redis_connection_profiles_next;

            CREATE TABLE redis_connection_profiles_next (
                id TEXT PRIMARY KEY,
                group_name TEXT,
                connection_name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                database_index INTEGER NOT NULL,
                connect_timeout_ms INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            ",
        )?;

        connection.execute_batch(
            "
            INSERT INTO redis_connection_profiles_next (
                id,
                group_name,
                connection_name,
                host,
                port,
                username,
                password,
                database_index,
                connect_timeout_ms,
                created_at,
                updated_at
            )
            SELECT
                id,
                NULL,
                connection_name,
                host,
                port,
                username,
                password,
                database_index,
                connect_timeout_ms,
                created_at,
                updated_at
            FROM redis_connection_profiles;

            DROP TABLE redis_connection_profiles;
            ALTER TABLE redis_connection_profiles_next RENAME TO redis_connection_profiles;
            CREATE INDEX idx_redis_connection_profiles_group_name
                ON redis_connection_profiles(group_name, connection_name);
            ",
        )?;

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
                        total_elapsed_ms INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_compare_history_created_at
                        ON compare_history(created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_compare_history_type_created_at
                        ON compare_history(history_type, created_at DESC);
                ",
        )?;

        let columns = load_table_columns(connection, "compare_history")?;
        if !columns.contains("total_elapsed_ms") {
            connection.execute(
                "ALTER TABLE compare_history ADD COLUMN total_elapsed_ms INTEGER NOT NULL DEFAULT 0",
                [],
            )?;

            let mut statement = connection.prepare(
                "
                SELECT id, performance_json
                FROM compare_history
                ",
            )?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?;

            for row in rows {
                let (history_id, performance_json) = row?;
                let performance: CompareHistoryPerformance = parse_json_value(&performance_json);
                connection.execute(
                    "UPDATE compare_history SET total_elapsed_ms = ? WHERE id = ?",
                    params![performance.total_elapsed_ms as i64, history_id],
                )?;
            }
        }

        connection.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_compare_history_created_at
                ON compare_history(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_compare_history_type_created_at
                ON compare_history(history_type, created_at DESC);
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

fn map_redis_connection_profile_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<RedisConnectionProfile> {
    Ok(RedisConnectionProfile {
        id: row.get(0)?,
        group_name: row.get(1)?,
        connection_name: row.get(2)?,
        host: row.get(3)?,
        port: row.get::<_, i64>(4)? as u16,
        username: row.get(5)?,
        password: row.get(6)?,
        database_index: row.get::<_, i64>(7)? as u16,
        connect_timeout_ms: row.get::<_, i64>(8)? as u64,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn validate_redis_payload(payload: &SaveRedisConnectionPayload) -> Result<()> {
    ensure!(
        !payload.connection_name.trim().is_empty(),
        "Redis 连接名称不能为空"
    );
    ensure!(!payload.host.trim().is_empty(), "Redis 主机不能为空");
    ensure!(payload.port > 0, "Redis 端口必须大于 0");
    ensure!(
        payload.database_index <= 255,
        "Redis DB 编号必须在 0 到 255 之间"
    );
    ensure!(
        (100..=120_000).contains(&payload.connect_timeout_ms),
        "Redis 连接超时必须在 100 到 120000 毫秒之间"
    );
    Ok(())
}

fn validate_payload(payload: &SaveConnectionProfilePayload, password: &str) -> Result<()> {
    ensure!(
        !payload.data_source_name.trim().is_empty(),
        "数据源名称不能为空"
    );
    ensure!(!payload.host.trim().is_empty(), "主机不能为空");
    ensure!(!payload.username.trim().is_empty(), "用户名不能为空");
    ensure!(!password.is_empty(), "密码不能为空");
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

fn map_compare_history_summary_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<CompareHistorySummary> {
    Ok(CompareHistorySummary {
        id: row.get(0)?,
        history_type: normalize_history_type(&row.get::<_, String>(1)?),
        source_profile_id: row.get(2)?,
        source_data_source_name: row.get(3)?,
        source_database: row.get(4)?,
        target_profile_id: row.get(5)?,
        target_data_source_name: row.get(6)?,
        target_database: row.get(7)?,
        table_mode: row.get(8)?,
        source_table_count: row.get::<_, i64>(9)? as usize,
        target_table_count: row.get::<_, i64>(10)? as usize,
        total_tables: row.get::<_, i64>(11)? as usize,
        compared_tables: row.get::<_, i64>(12)? as usize,
        insert_count: row.get::<_, i64>(13)? as usize,
        update_count: row.get::<_, i64>(14)? as usize,
        delete_count: row.get::<_, i64>(15)? as usize,
        structure_added_count: row.get::<_, i64>(16)? as usize,
        structure_modified_count: row.get::<_, i64>(17)? as usize,
        structure_deleted_count: row.get::<_, i64>(18)? as usize,
        total_elapsed_ms: row.get::<_, i64>(19)?.max(0) as u64,
        created_at: row.get(20)?,
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

#[cfg(test)]
mod tests {
    use super::{LocalStore, load_table_columns};
    use anyhow::Result;
    use rusqlite::Connection;
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Result<Self> {
            let path = std::env::temp_dir().join(format!(
                "zszc-sql-client-local-store-test-{}",
                Uuid::new_v4()
            ));
            fs::create_dir_all(&path)?;
            Ok(Self { path })
        }

        fn database_path(&self) -> PathBuf {
            self.path.join("local_store.db")
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn initialize_migrates_legacy_redis_profiles_before_syncing_groups() -> Result<()> {
        let test_dir = TestDir::new()?;
        let database_path = test_dir.database_path();
        let connection = Connection::open(&database_path)?;

        connection.execute_batch(
            "
            CREATE TABLE redis_connection_profiles (
                id TEXT PRIMARY KEY,
                connection_name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                database_index INTEGER NOT NULL,
                connect_timeout_ms INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX idx_redis_connection_profiles_name
                ON redis_connection_profiles(connection_name);

            INSERT INTO redis_connection_profiles (
                id,
                connection_name,
                host,
                port,
                username,
                password,
                database_index,
                connect_timeout_ms,
                created_at,
                updated_at
            )
            VALUES (
                'redis-profile-1',
                '开发 Redis',
                '127.0.0.1',
                6379,
                'default',
                'secret',
                0,
                5000,
                '2026-04-11T10:00:00Z',
                '2026-04-11T10:00:00Z'
            );
            ",
        )?;

        drop(connection);

        let store = LocalStore::new(&database_path)?;
        let connection = Connection::open(&database_path)?;
        let columns = load_table_columns(&connection, "redis_connection_profiles")?;

        assert!(columns.contains("group_name"));

        let redis_profiles = store.list_redis_connection_profiles()?;
        assert_eq!(redis_profiles.len(), 1);
        assert_eq!(redis_profiles[0].connection_name, "开发 Redis");
        assert_eq!(redis_profiles[0].group_name, None);

        let groups = store.list_data_source_groups()?;
        assert!(groups.is_empty());

        Ok(())
    }
}

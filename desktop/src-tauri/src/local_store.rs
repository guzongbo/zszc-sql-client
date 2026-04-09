use crate::models::{ConnectionProfile, SaveConnectionProfilePayload};
use anyhow::{Context, Result, ensure};
use chrono::Utc;
use rusqlite::{Connection, params};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
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
        let created_at = self
            .load_connection_profile(&profile_id)
            .map(|profile| profile.created_at)
            .unwrap_or_else(|_| now.clone());

        let connection = self.open_connection()?;
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
                normalize_optional(payload.group_name),
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

    pub fn delete_connection_profile(&self, profile_id: &str) -> Result<()> {
        let connection = self.open_connection()?;
        connection.execute("DELETE FROM connection_profiles WHERE id = ?", [profile_id])?;
        Ok(())
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

        self.migrate_connection_profiles(&connection)?;
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

    fn open_connection(&self) -> Result<Connection> {
        Connection::open(&self.database_path).context("无法打开本地 sqlite 数据库")
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

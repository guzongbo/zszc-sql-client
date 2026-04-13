use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    time::{Duration, SystemTime},
};

use mysql_async::Value;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{
    compare_core::errors::AppError,
    compare_core::models::api::{
        CompareDetailPageResponse, CompareDetailType, RowSample, RowTableItem, TableCompareResult,
        UpdateSample,
    },
    compare_core::utils::value::{
        RowMap, key_to_json, row_to_json, row_to_json_values, values_equal,
    },
};

const CACHE_FILE_NAME: &str = "diff_results.sqlite3";
const TABLE_CACHE_DIR: &str = "tables";
const CACHE_RETENTION_HOURS: u64 = 24;
const CACHE_MODE_ENV: &str = "ZSZC_COMPARE_CACHE_MODE";
const CACHE_RETENTION_HOURS_ENV: &str = "ZSZC_COMPARE_CACHE_RETENTION_HOURS";
const SOURCE_STAGE_TABLE: &str = "source_stage";
const TARGET_STAGE_TABLE: &str = "target_stage";
const SOURCE_KEY_STAGE_TABLE: &str = "source_key_stage";
const TARGET_KEY_STAGE_TABLE: &str = "target_key_stage";

#[derive(Clone, Copy, PartialEq, Eq)]
enum DiffCacheStorageMode {
    Full,
    SummaryOnly,
}

#[derive(Serialize, Deserialize)]
enum CachedValue {
    Null,
    Bytes(String),
    Int(i64),
    UInt(u64),
    Float(u32),
    Double(u64),
    Date {
        year: u16,
        month: u8,
        day: u8,
        hour: u8,
        minute: u8,
        second: u8,
        micros: u32,
    },
    Time {
        is_negative: bool,
        days: u32,
        hours: u8,
        minutes: u8,
        seconds: u8,
        micros: u32,
    },
}

pub struct CompareCacheWriter {
    compare_id: String,
    cache_dir: PathBuf,
    conn: Connection,
}

pub struct DiffCacheWriter {
    conn: Connection,
    detail_cache_file: Option<String>,
}

pub struct DiffCacheReader {
    cache_dir: PathBuf,
    conn: Connection,
}

pub struct FullRowStageResult {
    pub insert_count: usize,
    pub delete_count: usize,
    pub sample_inserts: Vec<RowSample>,
    pub sample_deletes: Vec<RowSample>,
}

pub struct KeyedStageResult {
    pub insert_count: usize,
    pub update_count: usize,
    pub delete_count: usize,
    pub sample_inserts: Vec<RowSample>,
    pub sample_updates: Vec<UpdateSample>,
    pub sample_deletes: Vec<RowSample>,
}

#[derive(Clone)]
pub struct CachedDiffRow {
    pub detail_type: CompareDetailType,
    pub signature: String,
    pub key_row: Option<RowMap>,
    pub source_row: Option<RowMap>,
    pub target_row: Option<RowMap>,
}

#[derive(Clone)]
pub struct CachedDiffPage {
    pub total: usize,
    pub rows: Vec<CachedDiffRow>,
}

struct CachedTableSummaryRecord {
    summary: TableCompareResult,
    detail_cache_file: Option<String>,
}

struct DiffRecordRows<'a> {
    key_row: Option<&'a RowMap>,
    source_row: Option<&'a RowMap>,
    target_row: Option<&'a RowMap>,
}

impl CompareCacheWriter {
    pub fn create() -> Result<Self, AppError> {
        Self::create_with_compare_id(uuid::Uuid::new_v4().to_string())
    }

    pub fn create_with_compare_id(compare_id: String) -> Result<Self, AppError> {
        cleanup_stale_cache_dirs()?;

        let cache_dir = cache_root_path().join(&compare_id);
        fs::create_dir_all(&cache_dir).map_err(AppError::from)?;
        fs::create_dir_all(cache_dir.join(TABLE_CACHE_DIR)).map_err(AppError::from)?;

        let db_path = cache_dir.join(CACHE_FILE_NAME);
        let conn = Connection::open(&db_path).map_err(AppError::from)?;
        initialize_manifest_schema(&conn)?;

        Ok(Self {
            compare_id,
            cache_dir,
            conn,
        })
    }

    pub fn compare_id(&self) -> &str {
        &self.compare_id
    }

    pub fn cleanup(self) -> Result<(), AppError> {
        fs::remove_dir_all(self.cache_dir).map_err(AppError::from)
    }

    pub fn write_table_summary(
        &mut self,
        table_result: &TableCompareResult,
        detail_cache_file: Option<&str>,
    ) -> Result<(), AppError> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO table_summaries (
                    source_table,
                    target_table,
                    compared_columns_json,
                    key_columns_json,
                    compare_mode,
                    warnings_json,
                    insert_count,
                    update_count,
                    delete_count,
                    detail_cache_file
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    table_result.source_table,
                    table_result.target_table,
                    serde_json::to_string(&table_result.compared_columns)
                        .map_err(|error| AppError::Parse(error.to_string()))?,
                    serde_json::to_string(&table_result.key_columns)
                        .map_err(|error| AppError::Parse(error.to_string()))?,
                    table_result.compare_mode,
                    serde_json::to_string(&table_result.warnings)
                        .map_err(|error| AppError::Parse(error.to_string()))?,
                    table_result.insert_count as i64,
                    table_result.update_count as i64,
                    table_result.delete_count as i64,
                    detail_cache_file,
                ],
            )
            .map_err(AppError::from)?;

        Ok(())
    }
}

pub fn remove_compare_cache(compare_id: &str) -> Result<(), AppError> {
    validate_compare_id(compare_id)?;
    let cache_dir = cache_root_path().join(compare_id);
    if !cache_dir.exists() {
        return Ok(());
    }

    fs::remove_dir_all(cache_dir).map_err(AppError::from)
}

impl DiffCacheWriter {
    pub fn create_for_table(compare_id: &str, detail_cache_file: &str) -> Result<Self, AppError> {
        let (conn, persisted_detail_cache_file) = match diff_cache_storage_mode() {
            DiffCacheStorageMode::Full => {
                let cache_dir = cache_root_path().join(compare_id).join(TABLE_CACHE_DIR);
                fs::create_dir_all(&cache_dir).map_err(AppError::from)?;

                let db_path = cache_dir.join(detail_cache_file);
                let conn = Connection::open(&db_path).map_err(AppError::from)?;
                (conn, Some(detail_cache_file.to_string()))
            }
            DiffCacheStorageMode::SummaryOnly => {
                (Connection::open_in_memory().map_err(AppError::from)?, None)
            }
        };
        initialize_detail_schema(&conn)?;

        Ok(Self {
            conn,
            detail_cache_file: persisted_detail_cache_file,
        })
    }

    pub fn detail_cache_file(&self) -> Option<&str> {
        self.detail_cache_file.as_deref()
    }

    pub fn write_insert_diff(
        &mut self,
        source_table: &str,
        target_table: &str,
        signature: &str,
        source_row: &RowMap,
    ) -> Result<(), AppError> {
        self.write_diff_record(
            source_table,
            target_table,
            CompareDetailType::Insert,
            signature,
            DiffRecordRows {
                key_row: None,
                source_row: Some(source_row),
                target_row: None,
            },
        )
    }

    pub fn write_insert_key_diff(
        &mut self,
        source_table: &str,
        target_table: &str,
        signature: &str,
        key_row: &RowMap,
    ) -> Result<(), AppError> {
        self.write_diff_record(
            source_table,
            target_table,
            CompareDetailType::Insert,
            signature,
            DiffRecordRows {
                key_row: Some(key_row),
                source_row: None,
                target_row: None,
            },
        )
    }

    pub fn write_update_diff(
        &mut self,
        source_table: &str,
        target_table: &str,
        signature: &str,
        source_row: &RowMap,
        target_row: &RowMap,
    ) -> Result<(), AppError> {
        self.write_diff_record(
            source_table,
            target_table,
            CompareDetailType::Update,
            signature,
            DiffRecordRows {
                key_row: None,
                source_row: Some(source_row),
                target_row: Some(target_row),
            },
        )
    }

    pub fn write_delete_diff(
        &mut self,
        source_table: &str,
        target_table: &str,
        signature: &str,
        target_row: &RowMap,
    ) -> Result<(), AppError> {
        self.write_diff_record(
            source_table,
            target_table,
            CompareDetailType::Delete,
            signature,
            DiffRecordRows {
                key_row: None,
                source_row: None,
                target_row: Some(target_row),
            },
        )
    }

    pub fn write_delete_key_diff(
        &mut self,
        source_table: &str,
        target_table: &str,
        signature: &str,
        key_row: &RowMap,
    ) -> Result<(), AppError> {
        self.write_diff_record(
            source_table,
            target_table,
            CompareDetailType::Delete,
            signature,
            DiffRecordRows {
                key_row: Some(key_row),
                source_row: None,
                target_row: None,
            },
        )
    }

    pub fn begin_diff_write(&mut self) -> Result<(), AppError> {
        self.conn
            .execute_batch("BEGIN IMMEDIATE TRANSACTION")
            .map_err(AppError::from)
    }

    pub fn commit_diff_write(&mut self) -> Result<(), AppError> {
        self.conn.execute_batch("COMMIT").map_err(AppError::from)
    }

    pub fn rollback_diff_write(&mut self) -> Result<(), AppError> {
        self.conn.execute_batch("ROLLBACK").map_err(AppError::from)
    }

    pub fn reset_full_row_staging(&mut self) -> Result<(), AppError> {
        self.conn
            .execute_batch(&format!(
                "
                DROP TABLE IF EXISTS {SOURCE_STAGE_TABLE};
                DROP TABLE IF EXISTS {TARGET_STAGE_TABLE};
                CREATE TEMP TABLE {SOURCE_STAGE_TABLE} (
                    stage_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    signature TEXT NOT NULL,
                    row_payload TEXT NOT NULL
                );
                CREATE TEMP TABLE {TARGET_STAGE_TABLE} (
                    stage_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    signature TEXT NOT NULL,
                    row_payload TEXT NOT NULL
                );
                CREATE INDEX idx_{SOURCE_STAGE_TABLE}_signature ON {SOURCE_STAGE_TABLE}(signature);
                CREATE INDEX idx_{TARGET_STAGE_TABLE}_signature ON {TARGET_STAGE_TABLE}(signature);
                "
            ))
            .map_err(AppError::from)
    }

    pub fn reset_keyed_row_staging(&mut self) -> Result<(), AppError> {
        self.conn
            .execute_batch(&format!(
                "
                DROP TABLE IF EXISTS {SOURCE_KEY_STAGE_TABLE};
                DROP TABLE IF EXISTS {TARGET_KEY_STAGE_TABLE};
                CREATE TEMP TABLE {SOURCE_KEY_STAGE_TABLE} (
                    stage_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key_signature TEXT NOT NULL,
                    row_signature TEXT NOT NULL,
                    row_payload TEXT NOT NULL
                );
                CREATE TEMP TABLE {TARGET_KEY_STAGE_TABLE} (
                    stage_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key_signature TEXT NOT NULL,
                    row_signature TEXT NOT NULL,
                    row_payload TEXT NOT NULL
                );
                CREATE INDEX idx_{SOURCE_KEY_STAGE_TABLE}_key_signature
                    ON {SOURCE_KEY_STAGE_TABLE}(key_signature);
                CREATE INDEX idx_{TARGET_KEY_STAGE_TABLE}_key_signature
                    ON {TARGET_KEY_STAGE_TABLE}(key_signature);
                CREATE INDEX idx_{SOURCE_KEY_STAGE_TABLE}_row_signature
                    ON {SOURCE_KEY_STAGE_TABLE}(row_signature);
                CREATE INDEX idx_{TARGET_KEY_STAGE_TABLE}_row_signature
                    ON {TARGET_KEY_STAGE_TABLE}(row_signature);
                "
            ))
            .map_err(AppError::from)
    }

    pub fn begin_stage_load(&mut self) -> Result<(), AppError> {
        self.conn
            .execute_batch("BEGIN IMMEDIATE TRANSACTION")
            .map_err(AppError::from)
    }

    pub fn commit_stage_load(&mut self) -> Result<(), AppError> {
        self.conn.execute_batch("COMMIT").map_err(AppError::from)
    }

    pub fn rollback_stage_load(&mut self) -> Result<(), AppError> {
        self.conn.execute_batch("ROLLBACK").map_err(AppError::from)
    }

    pub fn insert_source_stage_row(
        &mut self,
        signature: &str,
        row: &RowMap,
    ) -> Result<(), AppError> {
        self.insert_stage_row(SOURCE_STAGE_TABLE, signature, row)
    }

    pub fn insert_target_stage_row(
        &mut self,
        signature: &str,
        row: &RowMap,
    ) -> Result<(), AppError> {
        self.insert_stage_row(TARGET_STAGE_TABLE, signature, row)
    }

    pub fn insert_source_key_stage_row(
        &mut self,
        key_signature: &str,
        row_signature: &str,
        row: &RowMap,
    ) -> Result<(), AppError> {
        self.insert_key_stage_row(SOURCE_KEY_STAGE_TABLE, key_signature, row_signature, row)
    }

    pub fn insert_target_key_stage_row(
        &mut self,
        key_signature: &str,
        row_signature: &str,
        row: &RowMap,
    ) -> Result<(), AppError> {
        self.insert_key_stage_row(TARGET_KEY_STAGE_TABLE, key_signature, row_signature, row)
    }

    pub fn has_duplicate_key_stage_rows(&self) -> Result<bool, AppError> {
        let sql = format!(
            "
            SELECT 1
            FROM (
                SELECT key_signature
                FROM {SOURCE_KEY_STAGE_TABLE}
                GROUP BY key_signature
                HAVING COUNT(*) > 1
                UNION ALL
                SELECT key_signature
                FROM {TARGET_KEY_STAGE_TABLE}
                GROUP BY key_signature
                HAVING COUNT(*) > 1
            )
            LIMIT 1
            "
        );

        let duplicated = self
            .conn
            .query_row(&sql, [], |_| Ok(true))
            .optional()
            .map_err(AppError::from)?
            .unwrap_or(false);

        Ok(duplicated)
    }

    pub fn finalize_full_row_stage(
        &mut self,
        source_table: &str,
        target_table: &str,
        preview_limit: usize,
    ) -> Result<FullRowStageResult, AppError> {
        let insert_sql = format!(
            "
            WITH source_ranked AS (
                SELECT
                    stage_id,
                    signature,
                    row_payload,
                    ROW_NUMBER() OVER (PARTITION BY signature ORDER BY stage_id) AS rn
                FROM {SOURCE_STAGE_TABLE}
            ),
            target_ranked AS (
                SELECT
                    stage_id,
                    signature,
                    row_payload,
                    ROW_NUMBER() OVER (PARTITION BY signature ORDER BY stage_id) AS rn
                FROM {TARGET_STAGE_TABLE}
            )
            INSERT INTO diff_details (
                source_table,
                target_table,
                diff_type,
                signature,
                source_row_payload,
                target_row_payload
            )
            SELECT ?1, ?2, 'insert', s.signature, s.row_payload, NULL
            FROM source_ranked s
            LEFT JOIN target_ranked t
              ON t.signature = s.signature AND t.rn = s.rn
            WHERE t.stage_id IS NULL
            ORDER BY s.stage_id
            "
        );
        self.conn
            .execute(&insert_sql, params![source_table, target_table])
            .map_err(AppError::from)?;
        let insert_count = self.conn.changes() as usize;

        let delete_sql = format!(
            "
            WITH source_ranked AS (
                SELECT
                    stage_id,
                    signature,
                    row_payload,
                    ROW_NUMBER() OVER (PARTITION BY signature ORDER BY stage_id) AS rn
                FROM {SOURCE_STAGE_TABLE}
            ),
            target_ranked AS (
                SELECT
                    stage_id,
                    signature,
                    row_payload,
                    ROW_NUMBER() OVER (PARTITION BY signature ORDER BY stage_id) AS rn
                FROM {TARGET_STAGE_TABLE}
            )
            INSERT INTO diff_details (
                source_table,
                target_table,
                diff_type,
                signature,
                source_row_payload,
                target_row_payload
            )
            SELECT ?1, ?2, 'delete', t.signature, NULL, t.row_payload
            FROM target_ranked t
            LEFT JOIN source_ranked s
              ON s.signature = t.signature AND s.rn = t.rn
            WHERE s.stage_id IS NULL
            ORDER BY t.stage_id
            "
        );
        self.conn
            .execute(&delete_sql, params![source_table, target_table])
            .map_err(AppError::from)?;
        let delete_count = self.conn.changes() as usize;

        let sample_inserts = self.load_row_samples(
            source_table,
            target_table,
            CompareDetailType::Insert,
            preview_limit,
        )?;
        let sample_deletes = self.load_row_samples(
            source_table,
            target_table,
            CompareDetailType::Delete,
            preview_limit,
        )?;

        self.conn
            .execute_batch(&format!(
                "DROP TABLE IF EXISTS {SOURCE_STAGE_TABLE}; DROP TABLE IF EXISTS {TARGET_STAGE_TABLE};"
            ))
            .map_err(AppError::from)?;

        Ok(FullRowStageResult {
            insert_count,
            delete_count,
            sample_inserts,
            sample_deletes,
        })
    }

    pub fn finalize_keyed_stage(
        &mut self,
        source_table: &str,
        target_table: &str,
        key_columns: &[String],
        compared_columns: &[String],
        preview_limit: usize,
    ) -> Result<KeyedStageResult, AppError> {
        let insert_sql = format!(
            "
            INSERT INTO diff_details (
                source_table,
                target_table,
                diff_type,
                signature,
                source_row_payload,
                target_row_payload
            )
            SELECT ?1, ?2, 'insert', s.key_signature, s.row_payload, NULL
            FROM {SOURCE_KEY_STAGE_TABLE} s
            LEFT JOIN {TARGET_KEY_STAGE_TABLE} t
              ON t.key_signature = s.key_signature
            WHERE t.stage_id IS NULL
            ORDER BY s.stage_id
            "
        );
        self.conn
            .execute(&insert_sql, params![source_table, target_table])
            .map_err(AppError::from)?;
        let insert_count = self.conn.changes() as usize;

        let update_sql = format!(
            "
            INSERT INTO diff_details (
                source_table,
                target_table,
                diff_type,
                signature,
                source_row_payload,
                target_row_payload
            )
            SELECT ?1, ?2, 'update', s.key_signature, s.row_payload, t.row_payload
            FROM {SOURCE_KEY_STAGE_TABLE} s
            INNER JOIN {TARGET_KEY_STAGE_TABLE} t
              ON t.key_signature = s.key_signature
            WHERE s.row_signature <> t.row_signature
            ORDER BY s.stage_id
            "
        );
        self.conn
            .execute(&update_sql, params![source_table, target_table])
            .map_err(AppError::from)?;
        let update_count = self.conn.changes() as usize;

        let delete_sql = format!(
            "
            INSERT INTO diff_details (
                source_table,
                target_table,
                diff_type,
                signature,
                source_row_payload,
                target_row_payload
            )
            SELECT ?1, ?2, 'delete', t.key_signature, NULL, t.row_payload
            FROM {TARGET_KEY_STAGE_TABLE} t
            LEFT JOIN {SOURCE_KEY_STAGE_TABLE} s
              ON s.key_signature = t.key_signature
            WHERE s.stage_id IS NULL
            ORDER BY t.stage_id
            "
        );
        self.conn
            .execute(&delete_sql, params![source_table, target_table])
            .map_err(AppError::from)?;
        let delete_count = self.conn.changes() as usize;

        let sample_inserts = self.load_row_samples(
            source_table,
            target_table,
            CompareDetailType::Insert,
            preview_limit,
        )?;
        let sample_updates = self.load_update_samples(
            source_table,
            target_table,
            key_columns,
            compared_columns,
            preview_limit,
        )?;
        let sample_deletes = self.load_row_samples(
            source_table,
            target_table,
            CompareDetailType::Delete,
            preview_limit,
        )?;

        self.drop_key_stage_tables()?;

        Ok(KeyedStageResult {
            insert_count,
            update_count,
            delete_count,
            sample_inserts,
            sample_updates,
            sample_deletes,
        })
    }

    pub fn finalize_keyed_stage_as_full_row(
        &mut self,
        source_table: &str,
        target_table: &str,
        preview_limit: usize,
    ) -> Result<FullRowStageResult, AppError> {
        let insert_sql = format!(
            "
            WITH source_ranked AS (
                SELECT
                    stage_id,
                    row_signature,
                    row_payload,
                    ROW_NUMBER() OVER (PARTITION BY row_signature ORDER BY stage_id) AS rn
                FROM {SOURCE_KEY_STAGE_TABLE}
            ),
            target_ranked AS (
                SELECT
                    stage_id,
                    row_signature,
                    row_payload,
                    ROW_NUMBER() OVER (PARTITION BY row_signature ORDER BY stage_id) AS rn
                FROM {TARGET_KEY_STAGE_TABLE}
            )
            INSERT INTO diff_details (
                source_table,
                target_table,
                diff_type,
                signature,
                source_row_payload,
                target_row_payload
            )
            SELECT ?1, ?2, 'insert', s.row_signature, s.row_payload, NULL
            FROM source_ranked s
            LEFT JOIN target_ranked t
              ON t.row_signature = s.row_signature AND t.rn = s.rn
            WHERE t.stage_id IS NULL
            ORDER BY s.stage_id
            "
        );
        self.conn
            .execute(&insert_sql, params![source_table, target_table])
            .map_err(AppError::from)?;
        let insert_count = self.conn.changes() as usize;

        let delete_sql = format!(
            "
            WITH source_ranked AS (
                SELECT
                    stage_id,
                    row_signature,
                    row_payload,
                    ROW_NUMBER() OVER (PARTITION BY row_signature ORDER BY stage_id) AS rn
                FROM {SOURCE_KEY_STAGE_TABLE}
            ),
            target_ranked AS (
                SELECT
                    stage_id,
                    row_signature,
                    row_payload,
                    ROW_NUMBER() OVER (PARTITION BY row_signature ORDER BY stage_id) AS rn
                FROM {TARGET_KEY_STAGE_TABLE}
            )
            INSERT INTO diff_details (
                source_table,
                target_table,
                diff_type,
                signature,
                source_row_payload,
                target_row_payload
            )
            SELECT ?1, ?2, 'delete', t.row_signature, NULL, t.row_payload
            FROM target_ranked t
            LEFT JOIN source_ranked s
              ON s.row_signature = t.row_signature AND s.rn = t.rn
            WHERE s.stage_id IS NULL
            ORDER BY t.stage_id
            "
        );
        self.conn
            .execute(&delete_sql, params![source_table, target_table])
            .map_err(AppError::from)?;
        let delete_count = self.conn.changes() as usize;

        let sample_inserts = self.load_row_samples(
            source_table,
            target_table,
            CompareDetailType::Insert,
            preview_limit,
        )?;
        let sample_deletes = self.load_row_samples(
            source_table,
            target_table,
            CompareDetailType::Delete,
            preview_limit,
        )?;

        self.drop_key_stage_tables()?;

        Ok(FullRowStageResult {
            insert_count,
            delete_count,
            sample_inserts,
            sample_deletes,
        })
    }

    fn insert_stage_row(
        &mut self,
        table_name: &str,
        signature: &str,
        row: &RowMap,
    ) -> Result<(), AppError> {
        let payload = serialize_row_payload(row)?;
        self.conn
            .execute(
                &format!("INSERT INTO {table_name} (signature, row_payload) VALUES (?1, ?2)"),
                params![signature, payload],
            )
            .map_err(AppError::from)?;
        Ok(())
    }

    fn insert_key_stage_row(
        &mut self,
        table_name: &str,
        key_signature: &str,
        row_signature: &str,
        row: &RowMap,
    ) -> Result<(), AppError> {
        let payload = serialize_row_payload(row)?;
        self.conn
            .execute(
                &format!(
                    "INSERT INTO {table_name} (key_signature, row_signature, row_payload)
                     VALUES (?1, ?2, ?3)"
                ),
                params![key_signature, row_signature, payload],
            )
            .map_err(AppError::from)?;
        Ok(())
    }

    fn write_diff_record(
        &mut self,
        source_table: &str,
        target_table: &str,
        detail_type: CompareDetailType,
        signature: &str,
        rows: DiffRecordRows<'_>,
    ) -> Result<(), AppError> {
        let key_payload = rows.key_row.map(serialize_row_payload).transpose()?;
        let source_payload = rows.source_row.map(serialize_row_payload).transpose()?;
        let target_payload = rows.target_row.map(serialize_row_payload).transpose()?;

        self.conn
            .execute(
                "INSERT INTO diff_details (
                    source_table,
                    target_table,
                    diff_type,
                    signature,
                    key_row_payload,
                    source_row_payload,
                    target_row_payload
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    source_table,
                    target_table,
                    compare_detail_type_as_str(detail_type),
                    signature,
                    key_payload,
                    source_payload,
                    target_payload
                ],
            )
            .map_err(AppError::from)?;

        Ok(())
    }

    fn load_row_samples(
        &self,
        source_table: &str,
        target_table: &str,
        detail_type: CompareDetailType,
        limit: usize,
    ) -> Result<Vec<RowSample>, AppError> {
        let payload_column = if detail_type == CompareDetailType::Delete {
            "target_row_payload"
        } else {
            "source_row_payload"
        };
        let mut stmt = self
            .conn
            .prepare(&format!(
                "SELECT signature, {payload_column}
                 FROM diff_details
                 WHERE source_table = ?1 AND target_table = ?2 AND diff_type = ?3
                 ORDER BY id
                 LIMIT ?4"
            ))
            .map_err(AppError::from)?;

        let rows = stmt
            .query_map(
                params![
                    source_table,
                    target_table,
                    compare_detail_type_as_str(detail_type),
                    limit as i64
                ],
                |row| {
                    let signature: String = row.get(0)?;
                    let payload: String = row.get(1)?;
                    Ok((signature, payload))
                },
            )
            .map_err(AppError::from)?;

        let mut samples = Vec::new();
        for row in rows {
            let (signature, payload) = row.map_err(AppError::from)?;
            let row_map = deserialize_row_payload(&payload)?;
            samples.push(RowSample {
                signature,
                row: row_to_json(&row_map),
            });
        }

        Ok(samples)
    }

    fn load_update_samples(
        &self,
        source_table: &str,
        target_table: &str,
        key_columns: &[String],
        compared_columns: &[String],
        limit: usize,
    ) -> Result<Vec<UpdateSample>, AppError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT signature, source_row_payload, target_row_payload
                 FROM diff_details
                 WHERE source_table = ?1 AND target_table = ?2 AND diff_type = 'update'
                 ORDER BY id
                 LIMIT ?3",
            )
            .map_err(AppError::from)?;

        let rows = stmt
            .query_map(params![source_table, target_table, limit as i64], |row| {
                let signature: String = row.get(0)?;
                let source_payload: String = row.get(1)?;
                let target_payload: String = row.get(2)?;
                Ok((signature, source_payload, target_payload))
            })
            .map_err(AppError::from)?;

        let mut samples = Vec::new();
        for row in rows {
            let (signature, source_payload, target_payload) = row.map_err(AppError::from)?;
            let source_row = deserialize_row_payload(&source_payload)?;
            let target_row = deserialize_row_payload(&target_payload)?;
            let diff_columns = compared_columns
                .iter()
                .filter(|column| {
                    !values_equal(
                        source_row.get(column.as_str()),
                        target_row.get(column.as_str()),
                    )
                })
                .cloned()
                .collect::<Vec<_>>();

            samples.push(UpdateSample {
                signature,
                key: key_to_json(&source_row, key_columns),
                source_row: row_to_json(&source_row),
                target_row: row_to_json(&target_row),
                diff_columns,
            });
        }

        Ok(samples)
    }

    fn drop_key_stage_tables(&mut self) -> Result<(), AppError> {
        self.conn
            .execute_batch(&format!(
                "DROP TABLE IF EXISTS {SOURCE_KEY_STAGE_TABLE}; DROP TABLE IF EXISTS {TARGET_KEY_STAGE_TABLE};"
            ))
            .map_err(AppError::from)
    }
}

impl DiffCacheReader {
    pub fn open(compare_id: &str) -> Result<Self, AppError> {
        let cache_dir = cache_root_path().join(compare_id);
        let db_path = cache_dir.join(CACHE_FILE_NAME);
        if !db_path.exists() {
            return Err(AppError::Io(format!(
                "差异缓存不存在: {}",
                db_path.display()
            )));
        }

        let conn = Connection::open(db_path).map_err(AppError::from)?;
        initialize_manifest_schema(&conn)?;
        Ok(Self { cache_dir, conn })
    }

    pub fn load_diff_page(
        &self,
        source_table: &str,
        target_table: &str,
        detail_type: CompareDetailType,
        offset: usize,
        limit: usize,
    ) -> Result<CachedDiffPage, AppError> {
        let record = self
            .load_summary_record(source_table, target_table)?
            .ok_or_else(|| {
                AppError::Io(format!(
                    "未找到缓存中的表摘要: {} -> {}",
                    source_table, target_table
                ))
            })?;
        let total = match detail_type {
            CompareDetailType::Insert => record.summary.insert_count,
            CompareDetailType::Update => record.summary.update_count,
            CompareDetailType::Delete => record.summary.delete_count,
        };
        if record.detail_cache_file.is_none() && total > 0 {
            return Err(AppError::Io(
                "当前对比仅保留摘要，差异详情未持久化".to_string(),
            ));
        }

        let rows = self.with_table_conn(record.detail_cache_file.as_deref(), |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT diff_type, signature, key_row_payload, source_row_payload, target_row_payload
                     FROM diff_details
                     WHERE source_table = ?1 AND target_table = ?2 AND diff_type = ?3
                     ORDER BY id
                     LIMIT ?4 OFFSET ?5",
                )
                .map_err(AppError::from)?;

            let rows = stmt
                .query_map(
                    params![
                        source_table,
                        target_table,
                        compare_detail_type_as_str(detail_type),
                        limit as i64,
                        offset as i64
                    ],
                    |row| {
                        let diff_type: String = row.get(0)?;
                        let signature: String = row.get(1)?;
                        let key_payload: Option<String> = row.get(2)?;
                        let source_payload: Option<String> = row.get(3)?;
                        let target_payload: Option<String> = row.get(4)?;
                        Ok((diff_type, signature, key_payload, source_payload, target_payload))
                    },
                )
                .map_err(AppError::from)?;

            let mut items = Vec::new();
            for row in rows {
                let (diff_type, signature, key_payload, source_payload, target_payload) =
                    row.map_err(AppError::from)?;
                items.push(CachedDiffRow {
                    detail_type: parse_compare_detail_type(&diff_type)?,
                    signature,
                    key_row: key_payload
                        .as_deref()
                        .map(deserialize_row_payload)
                        .transpose()?,
                    source_row: source_payload
                        .as_deref()
                        .map(deserialize_row_payload)
                        .transpose()?,
                    target_row: target_payload
                        .as_deref()
                        .map(deserialize_row_payload)
                        .transpose()?,
                });
            }

            Ok(items)
        })?;

        Ok(CachedDiffPage { total, rows })
    }

    pub fn load_detail_page(
        &self,
        source_table: &str,
        target_table: &str,
        detail_type: CompareDetailType,
        offset: usize,
        limit: usize,
    ) -> Result<CompareDetailPageResponse, AppError> {
        let record = self
            .load_summary_record(source_table, target_table)?
            .ok_or_else(|| {
                AppError::Io(format!(
                    "未找到缓存中的表摘要: {} -> {}",
                    source_table, target_table
                ))
            })?;
        let compared_columns = record.summary.compared_columns.clone();
        let key_columns = record.summary.key_columns.clone();
        let total = match detail_type {
            CompareDetailType::Insert => record.summary.insert_count,
            CompareDetailType::Update => record.summary.update_count,
            CompareDetailType::Delete => record.summary.delete_count,
        };
        if record.detail_cache_file.is_none() && total > 0 {
            return Err(AppError::Io(
                "当前对比仅保留摘要，差异详情未持久化".to_string(),
            ));
        }

        let (row_items, update_items) =
            self.with_table_conn(record.detail_cache_file.as_deref(), |conn| {
                let mut stmt = conn
                    .prepare(
                        "SELECT signature, key_row_payload, source_row_payload, target_row_payload
                         FROM diff_details
                         WHERE source_table = ?1 AND target_table = ?2 AND diff_type = ?3
                         ORDER BY id
                         LIMIT ?4 OFFSET ?5",
                    )
                    .map_err(AppError::from)?;

                let rows = stmt
                    .query_map(
                        params![
                            source_table,
                            target_table,
                            compare_detail_type_as_str(detail_type),
                            limit as i64,
                            offset as i64
                        ],
                        |row| {
                            let signature: String = row.get(0)?;
                            let key_payload: Option<String> = row.get(1)?;
                            let source_payload: Option<String> = row.get(2)?;
                            let target_payload: Option<String> = row.get(3)?;
                            Ok((signature, key_payload, source_payload, target_payload))
                        },
                    )
                    .map_err(AppError::from)?;

                let mut row_items = Vec::new();
                let mut update_items = Vec::new();

                for row in rows {
                    let (signature, _key_payload, source_payload, target_payload) =
                        row.map_err(AppError::from)?;
                    match detail_type {
                        CompareDetailType::Insert => {
                            let payload = source_payload.ok_or_else(|| {
                                AppError::Parse("缓存中的 insert 记录缺少源端行数据".to_string())
                            })?;
                            let row_map = deserialize_row_payload(&payload)?;
                            row_items.push(RowTableItem {
                                signature,
                                values: row_to_json_values(&row_map, &compared_columns),
                            });
                        }
                        CompareDetailType::Delete => {
                            let payload = target_payload.ok_or_else(|| {
                                AppError::Parse("缓存中的 delete 记录缺少目标端行数据".to_string())
                            })?;
                            let row_map = deserialize_row_payload(&payload)?;
                            row_items.push(RowTableItem {
                                signature,
                                values: row_to_json_values(&row_map, &compared_columns),
                            });
                        }
                        CompareDetailType::Update => {
                            let source_payload = source_payload.ok_or_else(|| {
                                AppError::Parse("缓存中的 update 记录缺少源端行数据".to_string())
                            })?;
                            let target_payload = target_payload.ok_or_else(|| {
                                AppError::Parse("缓存中的 update 记录缺少目标端行数据".to_string())
                            })?;
                            let source_row = deserialize_row_payload(&source_payload)?;
                            let target_row = deserialize_row_payload(&target_payload)?;
                            let diff_columns = compared_columns
                                .iter()
                                .filter(|column| {
                                    !values_equal(
                                        source_row.get(column.as_str()),
                                        target_row.get(column.as_str()),
                                    )
                                })
                                .cloned()
                                .collect::<Vec<_>>();

                            update_items.push(UpdateSample {
                                signature,
                                key: key_to_json(&source_row, &key_columns),
                                source_row: row_to_json(&source_row),
                                target_row: row_to_json(&target_row),
                                diff_columns,
                            });
                        }
                    }
                }

                Ok((row_items, update_items))
            })?;

        Ok(CompareDetailPageResponse {
            source_table: source_table.to_string(),
            target_table: target_table.to_string(),
            detail_type,
            total,
            offset,
            limit,
            has_more: offset.saturating_add(limit) < total,
            row_columns: compared_columns,
            row_items,
            update_items,
        })
    }

    pub fn for_each_diff<F>(
        &self,
        source_table: &str,
        target_table: &str,
        mut on_row: F,
    ) -> Result<(), AppError>
    where
        F: FnMut(CachedDiffRow) -> Result<(), AppError>,
    {
        let record = self
            .load_summary_record(source_table, target_table)?
            .ok_or_else(|| {
                AppError::Io(format!(
                    "未找到缓存中的表摘要: {} -> {}",
                    source_table, target_table
                ))
            })?;
        let total =
            record.summary.insert_count + record.summary.update_count + record.summary.delete_count;
        if record.detail_cache_file.is_none() && total > 0 {
            return Err(AppError::Io(
                "当前对比仅保留摘要，差异详情未持久化".to_string(),
            ));
        }

        self.with_table_conn(record.detail_cache_file.as_deref(), |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT diff_type, signature, key_row_payload, source_row_payload, target_row_payload
                     FROM diff_details
                     WHERE source_table = ?1 AND target_table = ?2
                     ORDER BY id",
                )
                .map_err(AppError::from)?;

            let rows = stmt
                .query_map(params![source_table, target_table], |row| {
                    let diff_type: String = row.get(0)?;
                    let signature: String = row.get(1)?;
                    let key_payload: Option<String> = row.get(2)?;
                    let source_payload: Option<String> = row.get(3)?;
                    let target_payload: Option<String> = row.get(4)?;
                    Ok((diff_type, signature, key_payload, source_payload, target_payload))
                })
                .map_err(AppError::from)?;

            for row in rows {
                let (diff_type, signature, key_payload, source_payload, target_payload) =
                    row.map_err(AppError::from)?;
                on_row(CachedDiffRow {
                    detail_type: parse_compare_detail_type(&diff_type)?,
                    signature,
                    key_row: key_payload
                        .as_deref()
                        .map(deserialize_row_payload)
                        .transpose()?,
                    source_row: source_payload
                        .as_deref()
                        .map(deserialize_row_payload)
                        .transpose()?,
                    target_row: target_payload
                        .as_deref()
                        .map(deserialize_row_payload)
                        .transpose()?,
                })?;
            }

            Ok(())
        })
    }

    pub fn load_table_summary(
        &self,
        source_table: &str,
        target_table: &str,
    ) -> Result<Option<TableCompareResult>, AppError> {
        Ok(self
            .load_summary_record(source_table, target_table)?
            .map(|record| record.summary))
    }

    pub fn list_table_pairs(&self) -> Result<Vec<(String, String)>, AppError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT source_table, target_table
                 FROM table_summaries
                 ORDER BY source_table, target_table",
            )
            .map_err(AppError::from)?;

        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(AppError::from)?;

        let mut table_pairs = Vec::new();
        for row in rows {
            table_pairs.push(row.map_err(AppError::from)?);
        }

        Ok(table_pairs)
    }

    pub fn has_detail_cache(
        &self,
        source_table: &str,
        target_table: &str,
    ) -> Result<bool, AppError> {
        Ok(self
            .load_summary_record(source_table, target_table)?
            .and_then(|record| record.detail_cache_file)
            .is_some())
    }

    fn load_summary_record(
        &self,
        source_table: &str,
        target_table: &str,
    ) -> Result<Option<CachedTableSummaryRecord>, AppError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT
                    compared_columns_json,
                    key_columns_json,
                    compare_mode,
                    warnings_json,
                    insert_count,
                    update_count,
                    delete_count,
                    detail_cache_file
                 FROM table_summaries
                 WHERE source_table = ?1 AND target_table = ?2",
            )
            .map_err(AppError::from)?;

        let row = stmt
            .query_row(params![source_table, target_table], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            })
            .optional()
            .map_err(AppError::from)?;

        let Some((
            compared_columns_json,
            key_columns_json,
            compare_mode,
            warnings_json,
            insert_count,
            update_count,
            delete_count,
            detail_cache_file,
        )) = row
        else {
            return Ok(None);
        };

        Ok(Some(CachedTableSummaryRecord {
            summary: TableCompareResult {
                source_table: source_table.to_string(),
                target_table: target_table.to_string(),
                key_columns: serde_json::from_str(&key_columns_json)
                    .map_err(|error| AppError::Parse(error.to_string()))?,
                compared_columns: serde_json::from_str(&compared_columns_json)
                    .map_err(|error| AppError::Parse(error.to_string()))?,
                compare_mode,
                insert_count: insert_count.max(0) as usize,
                update_count: update_count.max(0) as usize,
                delete_count: delete_count.max(0) as usize,
                warnings: serde_json::from_str(&warnings_json)
                    .map_err(|error| AppError::Parse(error.to_string()))?,
                sample_inserts: Vec::new(),
                sample_updates: Vec::new(),
                sample_deletes: Vec::new(),
            },
            detail_cache_file: detail_cache_file.filter(|value| !value.trim().is_empty()),
        }))
    }

    fn with_table_conn<T, F>(
        &self,
        detail_cache_file: Option<&str>,
        on_conn: F,
    ) -> Result<T, AppError>
    where
        F: FnOnce(&Connection) -> Result<T, AppError>,
    {
        match detail_cache_file
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(file_name) => {
                let conn = Connection::open(self.cache_dir.join(TABLE_CACHE_DIR).join(file_name))
                    .map_err(AppError::from)?;
                initialize_detail_schema(&conn)?;
                on_conn(&conn)
            }
            None => on_conn(&self.conn),
        }
    }
}

fn cache_root_path() -> PathBuf {
    std::env::temp_dir().join("zszc-sql-client")
}

fn diff_cache_storage_mode() -> DiffCacheStorageMode {
    let raw_mode = std::env::var(CACHE_MODE_ENV).unwrap_or_default();
    match raw_mode.trim().to_ascii_lowercase().as_str() {
        "summary" | "summary_only" | "metadata_only" => DiffCacheStorageMode::SummaryOnly,
        _ => DiffCacheStorageMode::Full,
    }
}

fn cache_retention_duration() -> Duration {
    let retention_hours = std::env::var(CACHE_RETENTION_HOURS_ENV)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(CACHE_RETENTION_HOURS);
    Duration::from_secs(retention_hours.saturating_mul(3600))
}

fn validate_compare_id(compare_id: &str) -> Result<(), AppError> {
    let trimmed = compare_id.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("compare_id 不能为空".to_string()));
    }

    if !trimmed
        .chars()
        .all(|char| char.is_ascii_alphanumeric() || matches!(char, '-' | '_'))
    {
        return Err(AppError::Validation("compare_id 格式非法".to_string()));
    }

    Ok(())
}

fn initialize_manifest_schema(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS table_summaries (
            source_table TEXT NOT NULL,
            target_table TEXT NOT NULL,
            compared_columns_json TEXT NOT NULL,
            key_columns_json TEXT NOT NULL,
            compare_mode TEXT NOT NULL,
            warnings_json TEXT NOT NULL,
            insert_count INTEGER NOT NULL,
            update_count INTEGER NOT NULL,
            delete_count INTEGER NOT NULL,
            detail_cache_file TEXT,
            PRIMARY KEY (source_table, target_table)
        );

        CREATE TABLE IF NOT EXISTS diff_details (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_table TEXT NOT NULL,
            target_table TEXT NOT NULL,
            diff_type TEXT NOT NULL,
            signature TEXT NOT NULL,
            key_row_payload TEXT,
            source_row_payload TEXT,
            target_row_payload TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_diff_details_table_type
            ON diff_details (source_table, target_table, diff_type, id);
        ",
    )
    .map_err(AppError::from)?;

    ensure_table_summary_column(conn, "detail_cache_file", "TEXT")?;
    ensure_table_column(conn, "diff_details", "key_row_payload", "TEXT")?;

    Ok(())
}

fn initialize_detail_schema(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS diff_details (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_table TEXT NOT NULL,
            target_table TEXT NOT NULL,
            diff_type TEXT NOT NULL,
            signature TEXT NOT NULL,
            key_row_payload TEXT,
            source_row_payload TEXT,
            target_row_payload TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_diff_details_table_type
            ON diff_details (source_table, target_table, diff_type, id);
        ",
    )
    .map_err(AppError::from)?;

    ensure_table_column(conn, "diff_details", "key_row_payload", "TEXT")?;

    Ok(())
}

fn ensure_table_summary_column(
    conn: &Connection,
    column_name: &str,
    column_definition: &str,
) -> Result<(), AppError> {
    ensure_table_column(conn, "table_summaries", column_name, column_definition)
}

fn ensure_table_column(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> Result<(), AppError> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(AppError::from)?;

    for row in rows {
        if row.map_err(AppError::from)? == column_name {
            return Ok(());
        }
    }

    conn.execute(
        &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}"),
        [],
    )
    .map_err(AppError::from)?;

    Ok(())
}

fn cleanup_stale_cache_dirs() -> Result<(), AppError> {
    let root = cache_root_path();
    if !root.exists() {
        return Ok(());
    }

    let retention = cache_retention_duration();
    for entry in fs::read_dir(&root).map_err(AppError::from)? {
        let entry = entry.map_err(AppError::from)?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let modified = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let is_expired = SystemTime::now()
            .duration_since(modified)
            .unwrap_or_default()
            > retention;

        if is_expired {
            let _ = fs::remove_dir_all(path);
        }
    }

    Ok(())
}

fn serialize_row_payload(row: &RowMap) -> Result<String, AppError> {
    let payload = row
        .iter()
        .map(|(column, value): (&String, &Value)| (column.clone(), cached_value_from_mysql(value)))
        .collect::<BTreeMap<_, _>>();

    serde_json::to_string(&payload).map_err(|error| AppError::Parse(error.to_string()))
}

fn deserialize_row_payload(payload: &str) -> Result<RowMap, AppError> {
    let payload_map: BTreeMap<String, CachedValue> =
        serde_json::from_str(payload).map_err(|error| AppError::Parse(error.to_string()))?;
    Ok(payload_map
        .into_iter()
        .map(|(column, value)| (column, mysql_value_from_cached(value)))
        .collect())
}

fn cached_value_from_mysql(value: &Value) -> CachedValue {
    match value {
        Value::NULL => CachedValue::Null,
        Value::Bytes(bytes) => CachedValue::Bytes(hex::encode(bytes)),
        Value::Int(value) => CachedValue::Int(*value),
        Value::UInt(value) => CachedValue::UInt(*value),
        Value::Float(value) => CachedValue::Float(value.to_bits()),
        Value::Double(value) => CachedValue::Double(value.to_bits()),
        Value::Date(year, month, day, hour, minute, second, micros) => CachedValue::Date {
            year: *year,
            month: *month,
            day: *day,
            hour: *hour,
            minute: *minute,
            second: *second,
            micros: *micros,
        },
        Value::Time(is_negative, days, hours, minutes, seconds, micros) => CachedValue::Time {
            is_negative: *is_negative,
            days: *days,
            hours: *hours,
            minutes: *minutes,
            seconds: *seconds,
            micros: *micros,
        },
    }
}

fn mysql_value_from_cached(value: CachedValue) -> Value {
    match value {
        CachedValue::Null => Value::NULL,
        CachedValue::Bytes(hex_text) => Value::Bytes(hex::decode(hex_text).unwrap_or_default()),
        CachedValue::Int(value) => Value::Int(value),
        CachedValue::UInt(value) => Value::UInt(value),
        CachedValue::Float(bits) => Value::Float(f32::from_bits(bits)),
        CachedValue::Double(bits) => Value::Double(f64::from_bits(bits)),
        CachedValue::Date {
            year,
            month,
            day,
            hour,
            minute,
            second,
            micros,
        } => Value::Date(year, month, day, hour, minute, second, micros),
        CachedValue::Time {
            is_negative,
            days,
            hours,
            minutes,
            seconds,
            micros,
        } => Value::Time(is_negative, days, hours, minutes, seconds, micros),
    }
}

fn compare_detail_type_as_str(detail_type: CompareDetailType) -> &'static str {
    match detail_type {
        CompareDetailType::Insert => "insert",
        CompareDetailType::Update => "update",
        CompareDetailType::Delete => "delete",
    }
}

fn parse_compare_detail_type(value: &str) -> Result<CompareDetailType, AppError> {
    match value {
        "insert" => Ok(CompareDetailType::Insert),
        "update" => Ok(CompareDetailType::Update),
        "delete" => Ok(CompareDetailType::Delete),
        _ => Err(AppError::Parse(format!("未知差异类型: {value}"))),
    }
}

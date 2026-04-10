use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fs::File,
    io::{BufWriter, Write},
    mem,
    sync::{
        atomic::{AtomicUsize, Ordering as AtomicOrdering},
        Arc,
    },
    time::Instant,
};

use futures::{stream, StreamExt};
use mysql_async::{prelude::Queryable, Conn, QueryResult, Row, TextProtocol, Value};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tracing::{info, warn};

use crate::{
    compare_core::errors::AppError,
    compare_core::models::api::{
        CompareDetailPageRequest, CompareDetailPageResponse, CompareDetailType, CompareRequest,
        CompareResponse, CompareSummary, CompareTaskPhase, CompareTaskPhaseProgress,
        DownloadSqlRequest, ExportSqlFileRequest, ExportSqlFileResponse, RowSample, RowTableItem,
        SkippedTable, TableCompareResult, TableDiscoveryRequest, TableDiscoveryResponse,
        TableMapping, TableMode, TableSqlSelection, UpdateSample,
    },
    compare_core::services::{
        diff_cache_service::{
            CachedDiffPage, CompareCacheWriter, DiffCacheReader, DiffCacheWriter, KeyedStageResult,
        },
        mysql_service::{row_to_map, MySqlSession, TableColumnDefinition, TableKeyColumns},
    },
    compare_core::utils::{
        sql_builder::{
            build_delete_by_keys_sql, build_delete_by_row_sql, build_insert_sql, build_script,
            build_update_sql, quote_identifier,
        },
        value::row_to_json_values,
        value::{key_to_json, row_signature, row_to_json, values_equal, RowMap},
    },
};

#[derive(Clone, Default)]
pub struct CompareService;

const KEYED_DIFF_BATCH_SIZE: usize = 200;
const TABLE_COMPARE_TASK_CONCURRENCY: usize = 8;
const HASH_SCAN_CONCURRENCY: usize = 4;
const STAGE_IO_CONCURRENCY: usize = 1;
const NUMERIC_KEY_CHUNK_SIZE: u64 = 1000;
const MAX_NUMERIC_CHUNKS: usize = 50_000;
const MAX_CHUNK_SCAN_EXPANSION: usize = 8;
const CACHED_DIFF_PAGE_SIZE: usize = 1_000;
const GROUP_CONCAT_MAX_LEN: u64 = 1024 * 1024;
const ROW_HASH_ALIAS: &str = "__row_hash__";
const CHUNK_COUNT_ALIAS: &str = "__chunk_row_count__";
const CHUNK_HASH_ALIAS: &str = "__chunk_hash__";

pub struct SqlDownloadResult {
    pub file_name: String,
    pub script: String,
}

struct SqlFileWriter {
    writer: BufWriter<File>,
    has_statements: bool,
}

#[derive(Default)]
struct SqlGenerationStats {
    insert_count: usize,
    update_count: usize,
    delete_count: usize,
}

#[derive(Clone)]
pub struct CompareExecutionUpdate {
    pub total_tables: usize,
    pub completed_tables: usize,
    pub current_table: Option<String>,
    pub current_phase: CompareTaskPhase,
    pub current_phase_progress: Option<CompareTaskPhaseProgress>,
}

#[derive(Clone, Copy, Default)]
pub struct CompareExecutionControl<'a> {
    pub compare_id: Option<&'a str>,
    pub on_progress: Option<&'a (dyn Fn(CompareExecutionUpdate) + Send + Sync)>,
    pub is_cancelled: Option<&'a (dyn Fn() -> bool + Send + Sync)>,
}

#[derive(Clone)]
struct CompareExecutionResources {
    hash_scan_semaphore: Arc<Semaphore>,
    stage_io_semaphore: Arc<Semaphore>,
}

struct CachedTableDiffResult {
    insert_count: usize,
    update_count: usize,
    delete_count: usize,
    sample_inserts: Vec<RowSample>,
    sample_updates: Vec<UpdateSample>,
    sample_deletes: Vec<RowSample>,
}

enum UnsafeKeyStageOutcome {
    Keyed(KeyedStageResult),
    FullRow {
        insert_count: usize,
        delete_count: usize,
        sample_inserts: Vec<RowSample>,
        sample_deletes: Vec<RowSample>,
    },
}

struct TableLoadPlan {
    compared_columns: Vec<String>,
    source_hash_columns: Vec<TableColumnDefinition>,
    target_hash_columns: Vec<TableColumnDefinition>,
    key_columns: Vec<String>,
    key_columns_safe_for_streaming: bool,
    numeric_chunk_plan: Option<NumericChunkPlan>,
    missing_in_target: Vec<String>,
    missing_in_source: Vec<String>,
    key_warning: Option<String>,
}

#[derive(Clone)]
struct NumericChunkPlan {
    key_column: String,
    unsigned: bool,
    chunk_size: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum NumericKeyValue {
    Signed(i64),
    Unsigned(u64),
}

struct ChunkHashSummary {
    row_count: u64,
    chunk_hash: String,
}

#[derive(Clone)]
struct KeyedHashRow {
    key_row: RowMap,
    key_signature: String,
    row_hash: String,
}

enum KeyedHashDiffEvent {
    Insert {
        source: KeyedHashRow,
    },
    Update {
        source: KeyedHashRow,
        target: KeyedHashRow,
    },
    Delete {
        target: KeyedHashRow,
    },
}

#[derive(Clone)]
struct RuntimeTableSelection {
    table_enabled: bool,
    insert_enabled: bool,
    update_enabled: bool,
    delete_enabled: bool,
    excluded_insert: BTreeMap<String, usize>,
    excluded_update: BTreeMap<String, usize>,
    excluded_delete: BTreeMap<String, usize>,
}

enum CachedDetailLoad {
    Direct(CompareDetailPageResponse),
    Keyed {
        summary: TableCompareResult,
        cached_page: CachedDiffPage,
    },
}

impl Default for RuntimeTableSelection {
    fn default() -> Self {
        Self {
            table_enabled: true,
            insert_enabled: true,
            update_enabled: true,
            delete_enabled: true,
            excluded_insert: BTreeMap::new(),
            excluded_update: BTreeMap::new(),
            excluded_delete: BTreeMap::new(),
        }
    }
}

impl CompareExecutionResources {
    fn new() -> Self {
        Self {
            hash_scan_semaphore: Arc::new(Semaphore::new(HASH_SCAN_CONCURRENCY)),
            stage_io_semaphore: Arc::new(Semaphore::new(STAGE_IO_CONCURRENCY)),
        }
    }
}

impl SqlFileWriter {
    fn create(file_path: &str) -> Result<Self, AppError> {
        let file = File::create(file_path).map_err(|error| AppError::Io(error.to_string()))?;
        Ok(Self {
            writer: BufWriter::new(file),
            has_statements: false,
        })
    }

    fn write_statement(&mut self, sql: &str) -> Result<(), AppError> {
        if !self.has_statements {
            self.writer
                .write_all(b"SET FOREIGN_KEY_CHECKS = 0;\nSTART TRANSACTION;\n")
                .map_err(|error| AppError::Io(error.to_string()))?;
            self.has_statements = true;
        }

        self.writer
            .write_all(sql.as_bytes())
            .and_then(|_| self.writer.write_all(b"\n"))
            .map_err(|error| AppError::Io(error.to_string()))
    }

    fn finish(mut self) -> Result<(), AppError> {
        if self.has_statements {
            self.writer
                .write_all(b"COMMIT;\nSET FOREIGN_KEY_CHECKS = 1;\n")
                .map_err(|error| AppError::Io(error.to_string()))?;
        } else {
            self.writer
                .write_all("-- 未检测到数据差异，无需同步。\n".as_bytes())
                .map_err(|error| AppError::Io(error.to_string()))?;
        }

        self.writer
            .flush()
            .map_err(|error| AppError::Io(error.to_string()))
    }
}

impl CompareService {
    pub fn new() -> Self {
        Self
    }

    pub async fn discover_tables(
        &self,
        request: &TableDiscoveryRequest,
    ) -> Result<TableDiscoveryResponse, AppError> {
        request
            .source
            .validate("source")
            .map_err(AppError::Validation)?;
        request
            .target
            .validate("target")
            .map_err(AppError::Validation)?;

        let source_session = MySqlSession::new(&request.source);
        let target_session = MySqlSession::new(&request.target);
        let (source_tables, target_tables) =
            tokio::try_join!(source_session.list_tables(), target_session.list_tables())?;

        let target_set = target_tables.iter().cloned().collect::<HashSet<_>>();
        let mut common_tables = source_tables
            .iter()
            .filter(|table| target_set.contains(*table))
            .cloned()
            .collect::<Vec<_>>();

        common_tables.sort();

        Ok(TableDiscoveryResponse {
            source_tables,
            target_tables,
            common_tables,
        })
    }

    pub async fn compare(&self, request: &CompareRequest) -> Result<CompareResponse, AppError> {
        self.compare_with_control(request, None).await
    }

    pub async fn compare_with_control(
        &self,
        request: &CompareRequest,
        control: Option<&CompareExecutionControl<'_>>,
    ) -> Result<CompareResponse, AppError> {
        request.validate().map_err(AppError::Validation)?;
        let compare_started_at = Instant::now();
        check_compare_cancellation(control)?;

        let source_session = MySqlSession::new(&request.source);
        let target_session = MySqlSession::new(&request.target);
        let (source_tables, target_tables) =
            tokio::try_join!(source_session.list_tables(), target_session.list_tables())?;
        check_compare_cancellation(control)?;

        let (table_pairs, mut skipped_tables) =
            build_table_pairs(request, &source_tables, &target_tables);
        let total_tables = table_pairs.len();

        report_compare_progress(
            control,
            CompareExecutionUpdate {
                total_tables,
                completed_tables: 0,
                current_table: None,
                current_phase: CompareTaskPhase::DiscoverTables,
                current_phase_progress: None,
            },
        );

        info!(
            source_db = %request.source.database,
            target_db = %request.target.database,
            table_pairs = table_pairs.len(),
            skipped_tables = skipped_tables.len(),
            preview_limit = request.options.preview_limit,
            "数据库差异对比任务已展开"
        );

        let preview_limit = request.options.preview_limit;
        let mut cache_writer = create_diff_cache_writer(control)?;
        let compare_id_value = cache_writer.compare_id().to_string();
        let compare_id = Some(compare_id_value.clone());
        let mut table_results = Vec::with_capacity(table_pairs.len());
        let completed_tables = Arc::new(AtomicUsize::new(0));
        let service = self.clone();
        let execution_resources = CompareExecutionResources::new();
        let mut table_stream =
            stream::iter(table_pairs.into_iter().map(|(source_table, target_table)| {
                let service = service.clone();
                let source_session = source_session.clone();
                let target_session = target_session.clone();
                let compare_id_value = compare_id_value.clone();
                let completed_tables = completed_tables.clone();
                let execution_resources = execution_resources.clone();

                async move {
                    check_compare_cancellation(control)?;

                    let table_started_at = Instant::now();
                    let detail_cache_file =
                        build_table_cache_file_name(&source_table, &target_table);
                    let mut table_cache_writer =
                        DiffCacheWriter::create_for_table(&compare_id_value, &detail_cache_file)?;
                    let report_child_progress = |mut update: CompareExecutionUpdate| {
                        update.completed_tables = completed_tables.load(AtomicOrdering::SeqCst);
                        report_compare_progress(control, update);
                    };
                    let child_is_cancelled = || {
                        control
                            .and_then(|item| item.is_cancelled)
                            .map(|callback| callback())
                            .unwrap_or(false)
                    };
                    let child_control = CompareExecutionControl {
                        compare_id: Some(compare_id_value.as_str()),
                        on_progress: control.map(|_| {
                            &report_child_progress
                                as &(dyn Fn(CompareExecutionUpdate) + Send + Sync)
                        }),
                        is_cancelled: control
                            .map(|_| &child_is_cancelled as &(dyn Fn() -> bool + Send + Sync)),
                    };
                    let child_control_ref = control.map(|_| &child_control);

                    let table_result = service
                        .compare_single_table(
                            &source_session,
                            &target_session,
                            &source_table,
                            &target_table,
                            preview_limit,
                            &mut table_cache_writer,
                            child_control_ref,
                            &execution_resources,
                            total_tables,
                            completed_tables.load(AtomicOrdering::SeqCst),
                        )
                        .await?;

                    Ok::<_, AppError>((
                        detail_cache_file,
                        table_result,
                        table_started_at.elapsed().as_millis() as u64,
                    ))
                }
            }))
            .buffer_unordered(TABLE_COMPARE_TASK_CONCURRENCY);

        while let Some(task_result) = table_stream.next().await {
            let (detail_cache_file, table_result, elapsed_ms) = task_result?;
            cache_writer.write_table_summary(&table_result, Some(&detail_cache_file))?;
            let completed_tables = completed_tables.fetch_add(1, AtomicOrdering::SeqCst) + 1;
            report_compare_progress(
                control,
                CompareExecutionUpdate {
                    total_tables,
                    completed_tables,
                    current_table: Some(format!(
                        "{} -> {}",
                        table_result.source_table, table_result.target_table
                    )),
                    current_phase: CompareTaskPhase::Completed,
                    current_phase_progress: Some(CompareTaskPhaseProgress {
                        current: completed_tables,
                        total: total_tables.max(1),
                    }),
                },
            );

            info!(
                source_table = %table_result.source_table,
                target_table = %table_result.target_table,
                compare_mode = %table_result.compare_mode,
                insert_count = table_result.insert_count,
                update_count = table_result.update_count,
                delete_count = table_result.delete_count,
                elapsed_ms,
                "单表差异对比完成"
            );

            table_results.push(table_result);
        }

        let completed_tables = completed_tables.load(AtomicOrdering::SeqCst);

        let total_insert = table_results.iter().map(|item| item.insert_count).sum();
        let total_update = table_results.iter().map(|item| item.update_count).sum();
        let total_delete = table_results.iter().map(|item| item.delete_count).sum();

        table_results.sort_by(|left, right| left.source_table.cmp(&right.source_table));
        skipped_tables.sort_by(|left, right| left.source_table.cmp(&right.source_table));

        let total_sql_statements = total_insert * usize::from(request.options.generate_insert)
            + total_update * usize::from(request.options.generate_update)
            + total_delete * usize::from(request.options.generate_delete);

        let summary = CompareSummary {
            total_tables: table_results.len() + skipped_tables.len(),
            compared_tables: table_results.len(),
            skipped_tables: skipped_tables.len(),
            total_insert_count: total_insert,
            total_update_count: total_update,
            total_delete_count: total_delete,
            total_sql_statements,
        };

        info!(
            source_db = %request.source.database,
            target_db = %request.target.database,
            compared_tables = summary.compared_tables,
            skipped_tables = summary.skipped_tables,
            total_insert = summary.total_insert_count,
            total_update = summary.total_update_count,
            total_delete = summary.total_delete_count,
            elapsed_ms = compare_started_at.elapsed().as_millis() as u64,
            "数据库差异对比完成"
        );

        report_compare_progress(
            control,
            CompareExecutionUpdate {
                total_tables,
                completed_tables,
                current_table: None,
                current_phase: CompareTaskPhase::Completed,
                current_phase_progress: Some(CompareTaskPhaseProgress {
                    current: completed_tables,
                    total: total_tables.max(1),
                }),
            },
        );

        Ok(CompareResponse {
            compare_id,
            summary,
            skipped_tables,
            table_results,
            sql_script: String::new(),
        })
    }

    pub async fn generate_sql_script(
        &self,
        request: &DownloadSqlRequest,
    ) -> Result<SqlDownloadResult, AppError> {
        request.validate().map_err(AppError::Validation)?;

        let cached_table_pairs = if let Some(reader) =
            open_diff_cache_reader(request.compare_id.as_deref(), "生成 SQL")
        {
            Some(reader.list_table_pairs()?)
        } else {
            None
        };

        if let (Some(compare_id), Some(table_pairs)) =
            (request.compare_id.as_deref(), cached_table_pairs)
        {
            let source_session = MySqlSession::new(&request.compare_request.source);
            let target_session = MySqlSession::new(&request.compare_request.target);
            let mut selection_map = build_runtime_selection_map(&request.table_selections);
            let mut sql_statements = Vec::new();
            let mut generation_stats = SqlGenerationStats::default();

            for (source_table, target_table) in table_pairs {
                let mut selection = selection_map
                    .remove(&(source_table.clone(), target_table.clone()))
                    .unwrap_or_default();

                if !selection.table_enabled {
                    continue;
                }

                let Some(summary) = load_cached_table_summary(
                    compare_id,
                    "生成 SQL",
                    &source_table,
                    &target_table,
                )?
                else {
                    continue;
                };

                emit_cached_sql_for_table(
                    compare_id,
                    "生成 SQL",
                    &source_session,
                    &target_session,
                    &request.compare_request.target.database,
                    &summary,
                    &mut selection,
                    |sql| {
                        sql_statements.push(sql);
                        Ok(())
                    },
                    &mut generation_stats,
                )
                .await?;
            }

            let script = build_script(&sql_statements);
            let mut file_name = request
                .file_name
                .as_ref()
                .map(|name| sanitize_file_name(name))
                .unwrap_or_else(default_sql_file_name);
            if !file_name.ends_with(".sql") {
                file_name.push_str(".sql");
            }
            if sql_statements.is_empty() {
                file_name = "mysql_sync_empty.sql".to_string();
            }

            return Ok(SqlDownloadResult { file_name, script });
        }

        let compare_request = &request.compare_request;

        let source_session = MySqlSession::new(&compare_request.source);
        let target_session = MySqlSession::new(&compare_request.target);

        let (source_tables, target_tables) =
            tokio::try_join!(source_session.list_tables(), target_session.list_tables())?;
        let (table_pairs, _) = build_table_pairs(compare_request, &source_tables, &target_tables);

        let mut selection_map = build_runtime_selection_map(&request.table_selections);
        let mut sql_statements = Vec::new();
        let mut generation_stats = SqlGenerationStats::default();

        for (source_table, target_table) in table_pairs {
            let mut selection = selection_map
                .remove(&(source_table.clone(), target_table.clone()))
                .unwrap_or_default();

            if !selection.table_enabled {
                continue;
            }

            let plan = load_table_plan(
                &source_session,
                &target_session,
                &source_table,
                &target_table,
            )
            .await?;

            if plan.compared_columns.is_empty() {
                continue;
            }

            if should_skip_by_table_checksum(
                &source_session,
                &target_session,
                &source_table,
                &target_table,
                &plan,
            )
            .await
            {
                continue;
            }

            if plan.key_columns.is_empty() {
                let (source_rows, target_rows) = fetch_rows_parallel(
                    &source_session,
                    &target_session,
                    &source_table,
                    &target_table,
                    &plan.compared_columns,
                )
                .await?;
                generate_sql_with_full_rows(
                    &compare_request.target.database,
                    &target_table,
                    &plan.compared_columns,
                    source_rows,
                    target_rows,
                    &mut selection,
                    &mut sql_statements,
                    &mut generation_stats,
                );
                continue;
            }

            if plan.key_columns_safe_for_streaming {
                generate_sql_with_keys_streaming(
                    &compare_request.target.database,
                    &source_session,
                    &target_session,
                    &source_table,
                    &target_table,
                    &plan.key_columns,
                    &plan.compared_columns,
                    &plan.source_hash_columns,
                    &plan.target_hash_columns,
                    plan.numeric_chunk_plan.as_ref(),
                    &mut selection,
                    &mut sql_statements,
                    &mut generation_stats,
                )
                .await?;
                continue;
            }

            let (source_rows, target_rows) = fetch_rows_parallel(
                &source_session,
                &target_session,
                &source_table,
                &target_table,
                &plan.compared_columns,
            )
            .await?;

            let mut duplicate_keys = collect_duplicate_keys(&source_rows, &plan.key_columns);
            duplicate_keys.extend(collect_duplicate_keys(&target_rows, &plan.key_columns));
            if !duplicate_keys.is_empty() {
                generate_sql_with_full_rows(
                    &compare_request.target.database,
                    &target_table,
                    &plan.compared_columns,
                    source_rows,
                    target_rows,
                    &mut selection,
                    &mut sql_statements,
                    &mut generation_stats,
                );
                continue;
            }

            generate_sql_with_keys(
                &compare_request.target.database,
                &target_table,
                &plan.key_columns,
                &plan.compared_columns,
                source_rows,
                target_rows,
                &mut selection,
                &mut sql_statements,
                &mut generation_stats,
            );
        }

        let script = build_script(&sql_statements);

        let mut file_name = request
            .file_name
            .as_ref()
            .map(|name| sanitize_file_name(name))
            .unwrap_or_else(default_sql_file_name);

        if !file_name.ends_with(".sql") {
            file_name.push_str(".sql");
        }

        if sql_statements.is_empty() {
            file_name = "mysql_sync_empty.sql".to_string();
        }

        Ok(SqlDownloadResult { file_name, script })
    }

    pub async fn export_sql_file(
        &self,
        request: &ExportSqlFileRequest,
    ) -> Result<ExportSqlFileResponse, AppError> {
        request.validate().map_err(AppError::Validation)?;

        let cached_table_pairs = if let Some(reader) =
            open_diff_cache_reader(request.compare_id.as_deref(), "导出 SQL 文件")
        {
            Some(reader.list_table_pairs()?)
        } else {
            None
        };

        if let (Some(compare_id), Some(table_pairs)) =
            (request.compare_id.as_deref(), cached_table_pairs)
        {
            let source_session = MySqlSession::new(&request.compare_request.source);
            let target_session = MySqlSession::new(&request.compare_request.target);
            let mut selection_map = build_runtime_selection_map(&request.table_selections);
            let mut generation_stats = SqlGenerationStats::default();
            let mut writer = SqlFileWriter::create(&request.file_path)?;

            for (source_table, target_table) in table_pairs {
                let mut selection = selection_map
                    .remove(&(source_table.clone(), target_table.clone()))
                    .unwrap_or_default();

                if !selection.table_enabled {
                    continue;
                }

                let Some(summary) = load_cached_table_summary(
                    compare_id,
                    "导出 SQL 文件",
                    &source_table,
                    &target_table,
                )?
                else {
                    continue;
                };

                emit_cached_sql_for_table(
                    compare_id,
                    "导出 SQL 文件",
                    &source_session,
                    &target_session,
                    &request.compare_request.target.database,
                    &summary,
                    &mut selection,
                    |sql| writer.write_statement(&sql),
                    &mut generation_stats,
                )
                .await?;
            }
            writer.finish()?;

            return Ok(ExportSqlFileResponse {
                file_path: request.file_path.clone(),
                insert_count: generation_stats.insert_count,
                update_count: generation_stats.update_count,
                delete_count: generation_stats.delete_count,
            });
        }

        let compare_request = &request.compare_request;
        let source_session = MySqlSession::new(&compare_request.source);
        let target_session = MySqlSession::new(&compare_request.target);

        let (source_tables, target_tables) =
            tokio::try_join!(source_session.list_tables(), target_session.list_tables())?;
        let (table_pairs, _) = build_table_pairs(compare_request, &source_tables, &target_tables);

        let mut selection_map = build_runtime_selection_map(&request.table_selections);
        let mut generation_stats = SqlGenerationStats::default();
        let mut writer = SqlFileWriter::create(&request.file_path)?;

        for (source_table, target_table) in table_pairs {
            let mut selection = selection_map
                .remove(&(source_table.clone(), target_table.clone()))
                .unwrap_or_default();

            if !selection.table_enabled {
                continue;
            }

            let plan = load_table_plan(
                &source_session,
                &target_session,
                &source_table,
                &target_table,
            )
            .await?;

            if plan.compared_columns.is_empty() {
                continue;
            }

            if should_skip_by_table_checksum(
                &source_session,
                &target_session,
                &source_table,
                &target_table,
                &plan,
            )
            .await
            {
                continue;
            }

            if plan.key_columns.is_empty() {
                let (source_rows, target_rows) = fetch_rows_parallel(
                    &source_session,
                    &target_session,
                    &source_table,
                    &target_table,
                    &plan.compared_columns,
                )
                .await?;
                write_sql_with_full_rows(
                    &compare_request.target.database,
                    &target_table,
                    &plan.compared_columns,
                    source_rows,
                    target_rows,
                    &mut selection,
                    &mut writer,
                    &mut generation_stats,
                )?;
                continue;
            }

            if plan.key_columns_safe_for_streaming {
                write_sql_with_keys_streaming(
                    &compare_request.target.database,
                    &source_session,
                    &target_session,
                    &source_table,
                    &target_table,
                    &plan.key_columns,
                    &plan.compared_columns,
                    &plan.source_hash_columns,
                    &plan.target_hash_columns,
                    plan.numeric_chunk_plan.as_ref(),
                    &mut selection,
                    &mut writer,
                    &mut generation_stats,
                )
                .await?;
                continue;
            }

            let (source_rows, target_rows) = fetch_rows_parallel(
                &source_session,
                &target_session,
                &source_table,
                &target_table,
                &plan.compared_columns,
            )
            .await?;

            let mut duplicate_keys = collect_duplicate_keys(&source_rows, &plan.key_columns);
            duplicate_keys.extend(collect_duplicate_keys(&target_rows, &plan.key_columns));
            if !duplicate_keys.is_empty() {
                write_sql_with_full_rows(
                    &compare_request.target.database,
                    &target_table,
                    &plan.compared_columns,
                    source_rows,
                    target_rows,
                    &mut selection,
                    &mut writer,
                    &mut generation_stats,
                )?;
                continue;
            }

            write_sql_with_keys(
                &compare_request.target.database,
                &target_table,
                &plan.key_columns,
                &plan.compared_columns,
                source_rows,
                target_rows,
                &mut selection,
                &mut writer,
                &mut generation_stats,
            )?;
        }

        writer.finish()?;

        Ok(ExportSqlFileResponse {
            file_path: request.file_path.clone(),
            insert_count: generation_stats.insert_count,
            update_count: generation_stats.update_count,
            delete_count: generation_stats.delete_count,
        })
    }

    pub async fn load_detail_page(
        &self,
        request: &CompareDetailPageRequest,
    ) -> Result<CompareDetailPageResponse, AppError> {
        request.validate().map_err(AppError::Validation)?;

        let compare_request = &request.compare_request;
        let source_session = MySqlSession::new(&compare_request.source);
        let target_session = MySqlSession::new(&compare_request.target);

        if let Some(compare_id) = request.compare_id.as_deref() {
            if let Some(cached_detail) = load_cached_detail(compare_id, request)? {
                return match cached_detail {
                    CachedDetailLoad::Direct(response) => Ok(response),
                    CachedDetailLoad::Keyed {
                        summary,
                        cached_page,
                    } => {
                        load_keyed_detail_page_from_cache(
                            &source_session,
                            &target_session,
                            &summary,
                            request,
                            cached_page,
                        )
                        .await
                    }
                };
            }
        }

        let plan = load_table_plan(
            &source_session,
            &target_session,
            &request.source_table,
            &request.target_table,
        )
        .await?;

        if plan.compared_columns.is_empty() {
            return Ok(empty_detail_page(request));
        }

        if should_skip_by_table_checksum(
            &source_session,
            &target_session,
            &request.source_table,
            &request.target_table,
            &plan,
        )
        .await
        {
            return Ok(empty_detail_page(request));
        }

        if plan.key_columns.is_empty() {
            return load_full_row_detail_page(
                &source_session,
                &target_session,
                &request.source_table,
                &request.target_table,
                &plan.compared_columns,
                request.detail_type,
                request.expected_total,
                request.offset,
                request.limit,
            )
            .await;
        }

        load_keyed_detail_page(
            &source_session,
            &target_session,
            &request.source_table,
            &request.target_table,
            &plan.compared_columns,
            &plan.source_hash_columns,
            &plan.target_hash_columns,
            &plan.key_columns,
            plan.numeric_chunk_plan.as_ref(),
            request.detail_type,
            request.expected_total,
            request.offset,
            request.limit,
        )
        .await
    }

    async fn compare_single_table(
        &self,
        source_session: &MySqlSession,
        target_session: &MySqlSession,
        source_table: &str,
        target_table: &str,
        preview_limit: usize,
        cache_writer: &mut DiffCacheWriter,
        control: Option<&CompareExecutionControl<'_>>,
        resources: &CompareExecutionResources,
        total_tables: usize,
        completed_tables: usize,
    ) -> Result<TableCompareResult, AppError> {
        let fetch_started_at = Instant::now();
        let plan =
            load_table_plan(source_session, target_session, source_table, target_table).await?;
        check_compare_cancellation(control)?;

        let mut table_result =
            TableCompareResult::new(source_table.to_string(), target_table.to_string());
        table_result.compared_columns = plan.compared_columns.clone();

        if !plan.missing_in_target.is_empty() {
            table_result.warnings.push(format!(
                "目标表缺少字段（仅比较同名字段）: {}",
                join_limited(&plan.missing_in_target)
            ));
        }

        if !plan.missing_in_source.is_empty() {
            table_result.warnings.push(format!(
                "源表缺少字段（仅比较同名字段）: {}",
                join_limited(&plan.missing_in_source)
            ));
        }

        if let Some(key_warning) = &plan.key_warning {
            table_result.warnings.push(key_warning.clone());
        }

        if plan.compared_columns.is_empty() {
            table_result.compare_mode = "uncomparable".to_string();
            table_result
                .warnings
                .push("源表与目标表没有可比较的同名字段，已跳过".to_string());
            return Ok(table_result);
        }

        table_result.key_columns = plan.key_columns.clone();
        report_compare_progress(
            control,
            build_table_phase_update(
                total_tables,
                completed_tables,
                source_table,
                target_table,
                CompareTaskPhase::TableChecksum,
                None,
            ),
        );
        check_compare_cancellation(control)?;

        if should_skip_by_table_checksum(
            source_session,
            target_session,
            source_table,
            target_table,
            &plan,
        )
        .await
        {
            report_compare_progress(
                control,
                build_table_phase_update(
                    total_tables,
                    completed_tables,
                    source_table,
                    target_table,
                    CompareTaskPhase::TableChecksum,
                    None,
                ),
            );
            table_result.compare_mode = "table_checksum".to_string();
            info!(
                source_table = %source_table,
                target_table = %target_table,
                "表级校验和一致，跳过深度对比"
            );
            table_result.warnings.push(
                "表级校验和一致，已跳过深度对比；如需绝对逐行校验，请继续使用非预筛模式"
                    .to_string(),
            );
            return Ok(table_result);
        }

        if plan.key_columns.is_empty() {
            let _stage_permit = acquire_stage_io_permit(resources).await?;
            report_compare_progress(
                control,
                build_table_phase_update(
                    total_tables,
                    completed_tables,
                    source_table,
                    target_table,
                    CompareTaskPhase::SourceStageLoad,
                    None,
                ),
            );
            let stage_result = compare_with_full_row_cache(
                source_session,
                target_session,
                source_table,
                target_table,
                &plan.compared_columns,
                cache_writer,
                preview_limit,
                control,
                total_tables,
                completed_tables,
            )
            .await?;
            table_result.compare_mode = "full_row_cache".to_string();
            if plan.key_warning.is_none() {
                table_result.warnings.push(
                    "未找到可用主键/唯一键，已退化为整行对比（仅生成 INSERT/DELETE）".to_string(),
                );
            }
            info!(
                source_table = %source_table,
                target_table = %target_table,
                compared_columns = plan.compared_columns.len(),
                key_columns = 0,
                fetch_elapsed_ms = fetch_started_at.elapsed().as_millis() as u64,
                "单表数据已写入差异缓存"
            );
            table_result.insert_count = stage_result.insert_count;
            table_result.delete_count = stage_result.delete_count;
            table_result.sample_inserts = stage_result.sample_inserts;
            table_result.sample_deletes = stage_result.sample_deletes;
            return Ok(table_result);
        }

        if plan.key_columns_safe_for_streaming {
            let effective_numeric_chunk_plan = resolve_numeric_chunk_plan(
                source_session,
                target_session,
                source_table,
                target_table,
                plan.numeric_chunk_plan.as_ref(),
            )
            .await?;
            let _hash_scan_permit = acquire_hash_scan_permit(resources).await?;
            table_result.compare_mode = if effective_numeric_chunk_plan.is_some() {
                "keyed_chunk_hash".to_string()
            } else {
                "keyed_hash".to_string()
            };
            if plan.numeric_chunk_plan.is_some() && effective_numeric_chunk_plan.is_none() {
                table_result
                    .warnings
                    .push("整数键跨度或稀疏度不适合分块哈希，已自动回退为键控哈希扫描".to_string());
            }
            report_compare_progress(
                control,
                build_table_phase_update(
                    total_tables,
                    completed_tables,
                    source_table,
                    target_table,
                    if effective_numeric_chunk_plan.is_some() {
                        CompareTaskPhase::ChunkHashScan
                    } else {
                        CompareTaskPhase::KeyedHashScan
                    },
                    None,
                ),
            );
            info!(
                source_table = %source_table,
                target_table = %target_table,
                compared_columns = plan.compared_columns.len(),
                key_columns = plan.key_columns.len(),
                chunk_mode = plan.numeric_chunk_plan.is_some(),
                fetch_elapsed_ms = fetch_started_at.elapsed().as_millis() as u64,
                "单表差异对比改用键控哈希扫描"
            );

            let cached_result = compare_keyed_table_hash_to_cache(
                source_session,
                target_session,
                source_table,
                target_table,
                &plan.compared_columns,
                &plan.source_hash_columns,
                &plan.target_hash_columns,
                &plan.key_columns,
                effective_numeric_chunk_plan.as_ref(),
                preview_limit,
                cache_writer,
                control,
                total_tables,
                completed_tables,
            )
            .await?;
            table_result.insert_count = cached_result.insert_count;
            table_result.update_count = cached_result.update_count;
            table_result.delete_count = cached_result.delete_count;
            table_result.sample_inserts = cached_result.sample_inserts;
            table_result.sample_updates = cached_result.sample_updates;
            table_result.sample_deletes = cached_result.sample_deletes;

            return Ok(table_result);
        }

        report_compare_progress(
            control,
            build_table_phase_update(
                total_tables,
                completed_tables,
                source_table,
                target_table,
                CompareTaskPhase::SourceStageLoad,
                None,
            ),
        );
        let _stage_permit = acquire_stage_io_permit(resources).await?;
        let stage_outcome = compare_unsafe_keyed_rows_with_cache(
            source_session,
            target_session,
            source_table,
            target_table,
            &plan.key_columns,
            &plan.compared_columns,
            cache_writer,
            preview_limit,
            control,
            total_tables,
            completed_tables,
        )
        .await?;
        info!(
            source_table = %source_table,
            target_table = %target_table,
            compared_columns = plan.compared_columns.len(),
            key_columns = plan.key_columns.len(),
            fetch_elapsed_ms = fetch_started_at.elapsed().as_millis() as u64,
            "不安全键表已写入差异缓存"
        );

        match stage_outcome {
            UnsafeKeyStageOutcome::Keyed(result) => {
                table_result.compare_mode = "keyed_stage".to_string();
                table_result.insert_count = result.insert_count;
                table_result.update_count = result.update_count;
                table_result.delete_count = result.delete_count;
                table_result.sample_inserts = result.sample_inserts;
                table_result.sample_updates = result.sample_updates;
                table_result.sample_deletes = result.sample_deletes;
            }
            UnsafeKeyStageOutcome::FullRow {
                insert_count,
                delete_count,
                sample_inserts,
                sample_deletes,
            } => {
                table_result.compare_mode = "full_row_cache".to_string();
                table_result.key_columns.clear();
                table_result
                    .warnings
                    .push("发现重复键值，已退化为整行对比（仅生成 INSERT/DELETE）".to_string());
                table_result.insert_count = insert_count;
                table_result.delete_count = delete_count;
                table_result.sample_inserts = sample_inserts;
                table_result.sample_deletes = sample_deletes;
            }
        }
        Ok(table_result)
    }
}

fn create_diff_cache_writer(
    control: Option<&CompareExecutionControl<'_>>,
) -> Result<CompareCacheWriter, AppError> {
    match control.and_then(|item| item.compare_id) {
        Some(compare_id) => CompareCacheWriter::create_with_compare_id(compare_id.to_string()),
        None => CompareCacheWriter::create(),
    }
}

async fn acquire_hash_scan_permit(
    resources: &CompareExecutionResources,
) -> Result<OwnedSemaphorePermit, AppError> {
    resources
        .hash_scan_semaphore
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| AppError::Io("键控哈希限流器已关闭".to_string()))
}

async fn acquire_stage_io_permit(
    resources: &CompareExecutionResources,
) -> Result<OwnedSemaphorePermit, AppError> {
    resources
        .stage_io_semaphore
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| AppError::Io("Stage 写盘限流器已关闭".to_string()))
}

fn build_table_cache_file_name(source_table: &str, target_table: &str) -> String {
    use sha1::{Digest, Sha1};

    let source_part = sanitize_table_cache_name(source_table);
    let target_part = sanitize_table_cache_name(target_table);
    let mut hasher = Sha1::new();
    hasher.update(source_table.as_bytes());
    hasher.update([0]);
    hasher.update(target_table.as_bytes());
    let digest = hex::encode(hasher.finalize());

    format!(
        "{}__{}__{}.sqlite3",
        source_part,
        target_part,
        &digest[..12]
    )
}

fn sanitize_table_cache_name(table_name: &str) -> String {
    let mut sanitized = String::with_capacity(table_name.len());
    let mut last_is_separator = false;

    for ch in table_name.chars() {
        let normalized = if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else {
            '_'
        };

        if normalized == '_' {
            if last_is_separator {
                continue;
            }
            last_is_separator = true;
        } else {
            last_is_separator = false;
        }

        sanitized.push(normalized);
        if sanitized.len() >= 24 {
            break;
        }
    }

    let sanitized = sanitized.trim_matches('_').to_string();
    if sanitized.is_empty() {
        "table".to_string()
    } else {
        sanitized
    }
}

fn build_table_phase_update(
    total_tables: usize,
    completed_tables: usize,
    source_table: &str,
    target_table: &str,
    current_phase: CompareTaskPhase,
    current_phase_progress: Option<CompareTaskPhaseProgress>,
) -> CompareExecutionUpdate {
    CompareExecutionUpdate {
        total_tables,
        completed_tables,
        current_table: Some(format!("{source_table} -> {target_table}")),
        current_phase,
        current_phase_progress,
    }
}

fn report_compare_progress(
    control: Option<&CompareExecutionControl<'_>>,
    update: CompareExecutionUpdate,
) {
    if let Some(callback) = control.and_then(|item| item.on_progress) {
        callback(update);
    }
}

fn check_compare_cancellation(
    control: Option<&CompareExecutionControl<'_>>,
) -> Result<(), AppError> {
    if control
        .and_then(|item| item.is_cancelled)
        .is_some_and(|is_cancelled| is_cancelled())
    {
        return Err(AppError::Cancelled("数据对比任务已取消".to_string()));
    }

    Ok(())
}

async fn load_table_plan(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
) -> Result<TableLoadPlan, AppError> {
    let (source_columns, target_columns, key_columns) = tokio::try_join!(
        source_session.list_column_definitions(source_table),
        target_session.list_column_definitions(target_table),
        source_session.load_key_columns(source_table)
    )?;

    Ok(build_table_load_plan(
        source_columns,
        target_columns,
        key_columns,
    ))
}

fn build_table_load_plan(
    source_columns: Vec<TableColumnDefinition>,
    target_columns: Vec<TableColumnDefinition>,
    key_columns: TableKeyColumns,
) -> TableLoadPlan {
    let target_column_set = target_columns
        .iter()
        .map(|column| column.name.clone())
        .collect::<HashSet<_>>();
    let source_column_set = source_columns
        .iter()
        .map(|column| column.name.clone())
        .collect::<HashSet<_>>();

    let compared_columns = source_columns
        .iter()
        .filter(|column| target_column_set.contains(&column.name))
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();

    let source_hash_columns = source_columns
        .iter()
        .filter(|column| target_column_set.contains(&column.name))
        .cloned()
        .collect::<Vec<_>>();

    let target_hash_columns = compared_columns
        .iter()
        .filter_map(|column_name| {
            target_columns
                .iter()
                .find(|column| column.name == *column_name)
                .cloned()
        })
        .collect::<Vec<_>>();

    let missing_in_target = source_columns
        .iter()
        .filter(|column| !target_column_set.contains(&column.name))
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();

    let missing_in_source = target_columns
        .iter()
        .filter(|column| !source_column_set.contains(&column.name))
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();

    let mut key_warning = None;
    let key_column_count = key_columns.columns.len();
    let missing_key_columns = key_columns
        .columns
        .iter()
        .filter(|column| !target_column_set.contains(*column))
        .cloned()
        .collect::<Vec<_>>();

    let (key_columns, key_columns_safe_for_streaming) = if key_column_count == 0 {
        (Vec::new(), false)
    } else if !missing_key_columns.is_empty() {
        key_warning = Some(format!(
            "目标表缺少键字段（{}），已退化为整行对比（仅生成 INSERT/DELETE）",
            join_limited(&missing_key_columns)
        ));
        (Vec::new(), false)
    } else {
        (key_columns.columns, key_columns.safe_for_streaming)
    };

    let numeric_chunk_plan = if key_columns_safe_for_streaming {
        build_numeric_chunk_plan(&source_columns, &target_columns, &key_columns)
    } else {
        None
    };

    TableLoadPlan {
        compared_columns,
        source_hash_columns,
        target_hash_columns,
        key_columns,
        key_columns_safe_for_streaming,
        numeric_chunk_plan,
        missing_in_target,
        missing_in_source,
        key_warning,
    }
}

async fn fetch_rows_parallel(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    compared_columns: &[String],
) -> Result<(Vec<RowMap>, Vec<RowMap>), AppError> {
    tokio::try_join!(
        source_session.fetch_rows(source_table, compared_columns),
        target_session.fetch_rows(target_table, compared_columns)
    )
}

async fn resolve_numeric_chunk_plan(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    numeric_chunk_plan: Option<&NumericChunkPlan>,
) -> Result<Option<NumericChunkPlan>, AppError> {
    let Some(chunk_plan) = numeric_chunk_plan else {
        return Ok(None);
    };

    let (source_bounds, target_bounds, source_row_estimate, target_row_estimate) = tokio::try_join!(
        source_session.get_key_range_values(source_table, &chunk_plan.key_column),
        target_session.get_key_range_values(target_table, &chunk_plan.key_column),
        source_session.get_table_row_estimate(source_table),
        target_session.get_table_row_estimate(target_table)
    )?;

    let merged_bounds = merge_numeric_ranges(
        normalize_numeric_range(source_bounds.0, source_bounds.1, chunk_plan.unsigned)?,
        normalize_numeric_range(target_bounds.0, target_bounds.1, chunk_plan.unsigned)?,
    );

    let Some((chunk_start, max_inclusive)) = merged_bounds else {
        return Ok(None);
    };

    let total_chunks = numeric_chunk_count(chunk_start, max_inclusive, chunk_plan.chunk_size);
    let estimated_rows = source_row_estimate
        .unwrap_or(0)
        .max(target_row_estimate.unwrap_or(0));
    if let Some(reason) =
        chunk_plan_rejection_reason(total_chunks, Some(estimated_rows), chunk_plan)
    {
        warn!(
            source_table = %source_table,
            target_table = %target_table,
            key_column = %chunk_plan.key_column,
            total_chunks,
            estimated_rows,
            reason = %reason,
            "整数键分块策略不适用，已回退到键控哈希扫描"
        );
        return Ok(None);
    }

    Ok(Some(chunk_plan.clone()))
}

fn chunk_plan_rejection_reason(
    total_chunks: usize,
    estimated_rows: Option<u64>,
    chunk_plan: &NumericChunkPlan,
) -> Option<&'static str> {
    if total_chunks > MAX_NUMERIC_CHUNKS {
        return Some("chunk_total_exceeds_limit");
    }

    let Some(estimated_rows) = estimated_rows.filter(|value| *value > 0) else {
        return None;
    };
    let ideal_chunks = (estimated_rows as usize).div_ceil(chunk_plan.chunk_size.max(1) as usize);
    let allowed_chunks = ideal_chunks.saturating_mul(MAX_CHUNK_SCAN_EXPANSION).max(1);
    if total_chunks > allowed_chunks {
        return Some("chunk_density_too_sparse");
    }

    None
}

fn build_numeric_chunk_plan(
    source_columns: &[TableColumnDefinition],
    target_columns: &[TableColumnDefinition],
    key_columns: &[String],
) -> Option<NumericChunkPlan> {
    if key_columns.len() != 1 {
        return None;
    }

    let key_column = &key_columns[0];
    let source_column = source_columns
        .iter()
        .find(|column| column.name == *key_column)?;
    let target_column = target_columns
        .iter()
        .find(|column| column.name == *key_column)?;

    if !is_integer_key_column(source_column) || !is_integer_key_column(target_column) {
        return None;
    }

    let source_unsigned = is_unsigned_integer_key(source_column);
    let target_unsigned = is_unsigned_integer_key(target_column);
    if source_unsigned != target_unsigned {
        return None;
    }

    Some(NumericChunkPlan {
        key_column: key_column.clone(),
        unsigned: source_unsigned,
        chunk_size: NUMERIC_KEY_CHUNK_SIZE,
    })
}

fn is_integer_key_column(column: &TableColumnDefinition) -> bool {
    matches!(
        column.data_type.to_ascii_lowercase().as_str(),
        "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "bigint"
    )
}

fn is_unsigned_integer_key(column: &TableColumnDefinition) -> bool {
    column.column_type.to_ascii_lowercase().contains("unsigned")
}

fn can_use_table_checksum_prefilter(plan: &TableLoadPlan) -> bool {
    !plan.compared_columns.is_empty()
        && plan.missing_in_target.is_empty()
        && plan.missing_in_source.is_empty()
}

async fn should_skip_by_table_checksum(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    plan: &TableLoadPlan,
) -> bool {
    if !can_use_table_checksum_prefilter(plan) {
        return false;
    }

    let checksums = tokio::try_join!(
        source_session.get_table_checksum(source_table),
        target_session.get_table_checksum(target_table)
    );

    match checksums {
        Ok((Some(source_checksum), Some(target_checksum))) => source_checksum == target_checksum,
        Ok(_) => false,
        Err(error) => {
            warn!(
                source_table = %source_table,
                target_table = %target_table,
                error = %error,
                "表级校验和预筛失败，已自动回退到深度对比"
            );
            false
        }
    }
}

async fn scan_keyed_table_hash_differences<F>(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    source_hash_columns: &[TableColumnDefinition],
    target_hash_columns: &[TableColumnDefinition],
    key_columns: &[String],
    numeric_chunk_plan: Option<&NumericChunkPlan>,
    on_event: F,
) -> Result<(), AppError>
where
    F: FnMut(KeyedHashDiffEvent) -> Result<(), AppError>,
{
    if let Some(chunk_plan) = numeric_chunk_plan {
        return scan_keyed_table_hash_differences_by_chunks(
            source_session,
            target_session,
            source_table,
            target_table,
            source_hash_columns,
            target_hash_columns,
            key_columns,
            chunk_plan,
            on_event,
        )
        .await;
    }

    scan_keyed_table_hash_differences_full(
        source_session,
        target_session,
        source_table,
        target_table,
        source_hash_columns,
        target_hash_columns,
        key_columns,
        on_event,
    )
    .await
}

async fn scan_keyed_table_hash_differences_full<F>(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    source_hash_columns: &[TableColumnDefinition],
    target_hash_columns: &[TableColumnDefinition],
    key_columns: &[String],
    mut on_event: F,
) -> Result<(), AppError>
where
    F: FnMut(KeyedHashDiffEvent) -> Result<(), AppError>,
{
    let (mut source_conn, mut target_conn) =
        tokio::try_join!(source_session.get_conn(), target_session.get_conn())?;

    let source_sql = source_session.build_select_row_hashes_sql(
        source_table,
        source_hash_columns,
        key_columns,
        ROW_HASH_ALIAS,
    );
    let target_sql = target_session.build_select_row_hashes_sql(
        target_table,
        target_hash_columns,
        key_columns,
        ROW_HASH_ALIAS,
    );

    let (mut source_result, mut target_result) = tokio::try_join!(
        async {
            source_conn
                .query_iter(source_sql)
                .await
                .map_err(AppError::from_mysql)
        },
        async {
            target_conn
                .query_iter(target_sql)
                .await
                .map_err(AppError::from_mysql)
        }
    )?;

    let scan_result = async {
        let mut source_row = next_keyed_hash_row(&mut source_result, key_columns).await?;
        let mut target_row = next_keyed_hash_row(&mut target_result, key_columns).await?;

        while source_row.is_some() || target_row.is_some() {
            match (&source_row, &target_row) {
                (Some(source), Some(target)) => {
                    match compare_row_keys(&source.key_row, &target.key_row, key_columns) {
                        Ordering::Less => {
                            on_event(KeyedHashDiffEvent::Insert {
                                source: source.clone(),
                            })?;
                            source_row =
                                next_keyed_hash_row(&mut source_result, key_columns).await?;
                        }
                        Ordering::Greater => {
                            on_event(KeyedHashDiffEvent::Delete {
                                target: target.clone(),
                            })?;
                            target_row =
                                next_keyed_hash_row(&mut target_result, key_columns).await?;
                        }
                        Ordering::Equal => {
                            if source.row_hash != target.row_hash {
                                on_event(KeyedHashDiffEvent::Update {
                                    source: source.clone(),
                                    target: target.clone(),
                                })?;
                            }

                            source_row =
                                next_keyed_hash_row(&mut source_result, key_columns).await?;
                            target_row =
                                next_keyed_hash_row(&mut target_result, key_columns).await?;
                        }
                    }
                }
                (Some(source), None) => {
                    on_event(KeyedHashDiffEvent::Insert {
                        source: source.clone(),
                    })?;
                    source_row = next_keyed_hash_row(&mut source_result, key_columns).await?;
                }
                (None, Some(target)) => {
                    on_event(KeyedHashDiffEvent::Delete {
                        target: target.clone(),
                    })?;
                    target_row = next_keyed_hash_row(&mut target_result, key_columns).await?;
                }
                (None, None) => break,
            }
        }

        Ok::<_, AppError>(())
    }
    .await;

    let source_drop = source_result
        .drop_result()
        .await
        .map_err(AppError::from_mysql);
    let target_drop = target_result
        .drop_result()
        .await
        .map_err(AppError::from_mysql);

    scan_result?;
    source_drop?;
    target_drop?;
    Ok(())
}

async fn scan_keyed_table_hash_differences_by_chunks<F>(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    source_hash_columns: &[TableColumnDefinition],
    target_hash_columns: &[TableColumnDefinition],
    key_columns: &[String],
    chunk_plan: &NumericChunkPlan,
    mut on_event: F,
) -> Result<(), AppError>
where
    F: FnMut(KeyedHashDiffEvent) -> Result<(), AppError>,
{
    let (source_bounds, target_bounds) = tokio::try_join!(
        source_session.get_key_range_values(source_table, &chunk_plan.key_column),
        target_session.get_key_range_values(target_table, &chunk_plan.key_column)
    )?;

    let merged_bounds = merge_numeric_ranges(
        normalize_numeric_range(source_bounds.0, source_bounds.1, chunk_plan.unsigned)?,
        normalize_numeric_range(target_bounds.0, target_bounds.1, chunk_plan.unsigned)?,
    );

    let Some((mut chunk_start, max_inclusive)) = merged_bounds else {
        return Ok(());
    };

    let (mut source_conn, mut target_conn) =
        tokio::try_join!(source_session.get_conn(), target_session.get_conn())?;
    tokio::try_join!(
        ensure_group_concat_max_len(&mut source_conn),
        ensure_group_concat_max_len(&mut target_conn)
    )?;

    loop {
        let chunk_end =
            build_chunk_end_inclusive(chunk_start, max_inclusive, chunk_plan.chunk_size);
        let chunk_filter =
            build_numeric_chunk_filter(&chunk_plan.key_column, chunk_start, chunk_end);

        let (source_summary, target_summary) = tokio::try_join!(
            load_chunk_hash_summary(
                &mut source_conn,
                source_session.build_chunk_hash_sql(
                    source_table,
                    source_hash_columns,
                    &chunk_plan.key_column,
                    CHUNK_COUNT_ALIAS,
                    CHUNK_HASH_ALIAS,
                    Some(&chunk_filter),
                ),
            ),
            load_chunk_hash_summary(
                &mut target_conn,
                target_session.build_chunk_hash_sql(
                    target_table,
                    target_hash_columns,
                    &chunk_plan.key_column,
                    CHUNK_COUNT_ALIAS,
                    CHUNK_HASH_ALIAS,
                    Some(&chunk_filter),
                ),
            )
        )?;

        if source_summary.row_count != target_summary.row_count
            || source_summary.chunk_hash != target_summary.chunk_hash
        {
            let (source_rows, target_rows) = tokio::try_join!(
                load_keyed_hash_rows(
                    &mut source_conn,
                    source_session.build_select_row_hashes_sql_with_filter(
                        source_table,
                        source_hash_columns,
                        key_columns,
                        ROW_HASH_ALIAS,
                        Some(&chunk_filter),
                    ),
                    key_columns,
                ),
                load_keyed_hash_rows(
                    &mut target_conn,
                    target_session.build_select_row_hashes_sql_with_filter(
                        target_table,
                        target_hash_columns,
                        key_columns,
                        ROW_HASH_ALIAS,
                        Some(&chunk_filter),
                    ),
                    key_columns,
                )
            )?;

            emit_keyed_hash_diff_events(source_rows, target_rows, key_columns, &mut on_event)?;
        }

        if chunk_end == max_inclusive {
            break;
        }
        chunk_start = next_numeric_key_value(chunk_end)?;
    }

    Ok(())
}

fn build_chunk_end_inclusive(
    chunk_start: NumericKeyValue,
    max_inclusive: NumericKeyValue,
    chunk_size: u64,
) -> NumericKeyValue {
    match (chunk_start, max_inclusive) {
        (NumericKeyValue::Signed(start), NumericKeyValue::Signed(maximum)) => {
            let candidate = i128::from(start) + i128::from(chunk_size) - 1;
            NumericKeyValue::Signed(candidate.min(i128::from(maximum)) as i64)
        }
        (NumericKeyValue::Unsigned(start), NumericKeyValue::Unsigned(maximum)) => {
            let candidate = u128::from(start) + u128::from(chunk_size) - 1;
            NumericKeyValue::Unsigned(candidate.min(u128::from(maximum)) as u64)
        }
        _ => max_inclusive,
    }
}

fn numeric_chunk_count(
    min_inclusive: NumericKeyValue,
    max_inclusive: NumericKeyValue,
    chunk_size: u64,
) -> usize {
    match (min_inclusive, max_inclusive) {
        (NumericKeyValue::Signed(minimum), NumericKeyValue::Signed(maximum)) => {
            let span = (i128::from(maximum) - i128::from(minimum) + 1).max(0) as u128;
            span.div_ceil(u128::from(chunk_size)) as usize
        }
        (NumericKeyValue::Unsigned(minimum), NumericKeyValue::Unsigned(maximum)) => {
            let span = u128::from(maximum.saturating_sub(minimum)) + 1;
            span.div_ceil(u128::from(chunk_size)) as usize
        }
        _ => 1,
    }
}

fn build_numeric_chunk_filter(
    key_column: &str,
    chunk_start: NumericKeyValue,
    chunk_end: NumericKeyValue,
) -> String {
    format!(
        "{column} >= {start} AND {column} <= {end}",
        column = quote_identifier(key_column),
        start = numeric_key_sql_literal(chunk_start),
        end = numeric_key_sql_literal(chunk_end)
    )
}

fn numeric_key_sql_literal(value: NumericKeyValue) -> String {
    match value {
        NumericKeyValue::Signed(value) => value.to_string(),
        NumericKeyValue::Unsigned(value) => value.to_string(),
    }
}

fn normalize_numeric_range(
    min_value: Option<Value>,
    max_value: Option<Value>,
    unsigned: bool,
) -> Result<Option<(NumericKeyValue, NumericKeyValue)>, AppError> {
    match (min_value, max_value) {
        (None, None) => Ok(None),
        (Some(min_value), Some(max_value)) => Ok(Some((
            parse_numeric_key_value(&min_value, unsigned)?,
            parse_numeric_key_value(&max_value, unsigned)?,
        ))),
        _ => Err(AppError::Parse("主键范围读取结果不完整".to_string())),
    }
}

fn parse_numeric_key_value(value: &Value, unsigned: bool) -> Result<NumericKeyValue, AppError> {
    match (unsigned, value) {
        (true, Value::UInt(value)) => Ok(NumericKeyValue::Unsigned(*value)),
        (true, Value::Int(value)) if *value >= 0 => Ok(NumericKeyValue::Unsigned(*value as u64)),
        (true, Value::Bytes(bytes)) => {
            let text = std::str::from_utf8(bytes)
                .map_err(|error| AppError::Parse(format!("整数主键范围解析失败: {error}")))?;
            let value = text
                .parse::<u64>()
                .map_err(|error| AppError::Parse(format!("整数主键范围解析失败: {error}")))?;
            Ok(NumericKeyValue::Unsigned(value))
        }
        (false, Value::Int(value)) => Ok(NumericKeyValue::Signed(*value)),
        (false, Value::UInt(value)) if *value <= i64::MAX as u64 => {
            Ok(NumericKeyValue::Signed(*value as i64))
        }
        (false, Value::Bytes(bytes)) => {
            let text = std::str::from_utf8(bytes)
                .map_err(|error| AppError::Parse(format!("整数主键范围解析失败: {error}")))?;
            let value = text
                .parse::<i64>()
                .map_err(|error| AppError::Parse(format!("整数主键范围解析失败: {error}")))?;
            Ok(NumericKeyValue::Signed(value))
        }
        _ => Err(AppError::Parse("暂不支持该整数主键范围类型".to_string())),
    }
}

fn merge_numeric_ranges(
    left: Option<(NumericKeyValue, NumericKeyValue)>,
    right: Option<(NumericKeyValue, NumericKeyValue)>,
) -> Option<(NumericKeyValue, NumericKeyValue)> {
    match (left, right) {
        (Some((left_min, left_max)), Some((right_min, right_max))) => {
            Some((left_min.min(right_min), left_max.max(right_max)))
        }
        (Some(range), None) | (None, Some(range)) => Some(range),
        (None, None) => None,
    }
}

fn next_numeric_key_value(value: NumericKeyValue) -> Result<NumericKeyValue, AppError> {
    match value {
        NumericKeyValue::Signed(value) => value
            .checked_add(1)
            .map(NumericKeyValue::Signed)
            .ok_or_else(|| AppError::Parse("整数主键范围溢出".to_string())),
        NumericKeyValue::Unsigned(value) => value
            .checked_add(1)
            .map(NumericKeyValue::Unsigned)
            .ok_or_else(|| AppError::Parse("整数主键范围溢出".to_string())),
    }
}

async fn ensure_group_concat_max_len(conn: &mut Conn) -> Result<(), AppError> {
    conn.query_drop(format!(
        "SET SESSION group_concat_max_len = {}",
        GROUP_CONCAT_MAX_LEN
    ))
    .await
    .map_err(AppError::from_mysql)
}

async fn load_chunk_hash_summary(
    conn: &mut Conn,
    sql: String,
) -> Result<ChunkHashSummary, AppError> {
    let row: Option<Row> = conn.query_first(sql).await.map_err(AppError::from_mysql)?;
    let Some(row) = row else {
        return Ok(ChunkHashSummary {
            row_count: 0,
            chunk_hash: String::new(),
        });
    };

    let mut mapped = row_to_map(row);
    let row_count = parse_u64_field(
        mapped.remove(CHUNK_COUNT_ALIAS).unwrap_or(Value::UInt(0)),
        "分块行数",
    )?;
    let chunk_hash = match mapped
        .remove(CHUNK_HASH_ALIAS)
        .unwrap_or(Value::Bytes(Vec::new()))
    {
        Value::Bytes(bytes) => String::from_utf8(bytes)
            .map_err(|error| AppError::Parse(format!("分块哈希不是有效 UTF-8: {error}")))?,
        other => return Err(AppError::Parse(format!("分块哈希类型异常: {:?}", other))),
    };

    Ok(ChunkHashSummary {
        row_count,
        chunk_hash,
    })
}

fn parse_u64_field(value: Value, field_label: &str) -> Result<u64, AppError> {
    match value {
        Value::UInt(value) => Ok(value),
        Value::Int(value) if value >= 0 => Ok(value as u64),
        Value::Bytes(bytes) => {
            let text = std::str::from_utf8(&bytes)
                .map_err(|error| AppError::Parse(format!("{field_label}解析失败: {error}")))?;
            text.trim()
                .parse::<u64>()
                .map_err(|error| AppError::Parse(format!("{field_label}解析失败: {error}")))
        }
        Value::NULL => Ok(0),
        other => Err(AppError::Parse(format!(
            "{field_label}类型异常: {:?}",
            other
        ))),
    }
}

async fn load_keyed_hash_rows(
    conn: &mut Conn,
    sql: String,
    key_columns: &[String],
) -> Result<Vec<KeyedHashRow>, AppError> {
    let mut result = conn.query_iter(sql).await.map_err(AppError::from_mysql)?;
    let mut rows = Vec::new();

    while let Some(row) = next_keyed_hash_row(&mut result, key_columns).await? {
        rows.push(row);
    }

    result.drop_result().await.map_err(AppError::from_mysql)?;
    Ok(rows)
}

fn emit_keyed_hash_diff_events<F>(
    source_rows: Vec<KeyedHashRow>,
    target_rows: Vec<KeyedHashRow>,
    key_columns: &[String],
    on_event: &mut F,
) -> Result<(), AppError>
where
    F: FnMut(KeyedHashDiffEvent) -> Result<(), AppError>,
{
    let mut source_iter = source_rows.into_iter().peekable();
    let mut target_iter = target_rows.into_iter().peekable();

    while source_iter.peek().is_some() || target_iter.peek().is_some() {
        match (source_iter.peek(), target_iter.peek()) {
            (Some(source), Some(target)) => {
                match compare_row_keys(&source.key_row, &target.key_row, key_columns) {
                    Ordering::Less => {
                        on_event(KeyedHashDiffEvent::Insert {
                            source: source_iter.next().expect("source row must exist"),
                        })?;
                    }
                    Ordering::Greater => {
                        on_event(KeyedHashDiffEvent::Delete {
                            target: target_iter.next().expect("target row must exist"),
                        })?;
                    }
                    Ordering::Equal => {
                        let source = source_iter.next().expect("source row must exist");
                        let target = target_iter.next().expect("target row must exist");
                        if source.row_hash != target.row_hash {
                            on_event(KeyedHashDiffEvent::Update { source, target })?;
                        }
                    }
                }
            }
            (Some(_), None) => {
                on_event(KeyedHashDiffEvent::Insert {
                    source: source_iter.next().expect("source row must exist"),
                })?;
            }
            (None, Some(_)) => {
                on_event(KeyedHashDiffEvent::Delete {
                    target: target_iter.next().expect("target row must exist"),
                })?;
            }
            (None, None) => break,
        }
    }

    Ok(())
}

async fn fetch_rows_by_keys_in_batches(
    session: &MySqlSession,
    table: &str,
    columns: &[String],
    key_columns: &[String],
    key_rows: &[RowMap],
) -> Result<Vec<RowMap>, AppError> {
    let mut rows = Vec::new();

    for chunk in key_rows.chunks(KEYED_DIFF_BATCH_SIZE) {
        let mut chunk_rows = session
            .fetch_rows_by_keys(table, columns, key_columns, chunk)
            .await?;
        rows.append(&mut chunk_rows);
    }

    Ok(rows)
}

struct KeyedDiffCacheCollector<'a> {
    source_session: &'a MySqlSession,
    target_session: &'a MySqlSession,
    source_table: &'a str,
    target_table: &'a str,
    compared_columns: &'a [String],
    key_columns: &'a [String],
    preview_limit: usize,
    cache_writer: &'a mut DiffCacheWriter,
    insert_count: usize,
    update_count: usize,
    delete_count: usize,
    sample_insert_keys: Vec<RowMap>,
    sample_update_keys: Vec<RowMap>,
    sample_delete_keys: Vec<RowMap>,
    pending_update_keys: Vec<RowMap>,
}

impl<'a> KeyedDiffCacheCollector<'a> {
    fn new(
        source_session: &'a MySqlSession,
        target_session: &'a MySqlSession,
        source_table: &'a str,
        target_table: &'a str,
        compared_columns: &'a [String],
        key_columns: &'a [String],
        preview_limit: usize,
        cache_writer: &'a mut DiffCacheWriter,
    ) -> Self {
        Self {
            source_session,
            target_session,
            source_table,
            target_table,
            compared_columns,
            key_columns,
            preview_limit,
            cache_writer,
            insert_count: 0,
            update_count: 0,
            delete_count: 0,
            sample_insert_keys: Vec::new(),
            sample_update_keys: Vec::new(),
            sample_delete_keys: Vec::new(),
            pending_update_keys: Vec::new(),
        }
    }

    async fn handle_event(&mut self, event: KeyedHashDiffEvent) -> Result<(), AppError> {
        match event {
            KeyedHashDiffEvent::Insert { source } => {
                self.insert_count += 1;
                if self.sample_insert_keys.len() < self.preview_limit {
                    self.sample_insert_keys.push(source.key_row.clone());
                }
                self.cache_writer.write_insert_key_diff(
                    self.source_table,
                    self.target_table,
                    &source.key_signature,
                    &source.key_row,
                )?;
            }
            KeyedHashDiffEvent::Update { source, .. } => {
                self.update_count += 1;
                if self.sample_update_keys.len() < self.preview_limit {
                    self.sample_update_keys.push(source.key_row.clone());
                }
                self.pending_update_keys.push(source.key_row);
                if self.pending_update_keys.len() >= KEYED_DIFF_BATCH_SIZE {
                    self.flush_update_batch().await?;
                }
            }
            KeyedHashDiffEvent::Delete { target } => {
                self.delete_count += 1;
                if self.sample_delete_keys.len() < self.preview_limit {
                    self.sample_delete_keys.push(target.key_row.clone());
                }
                self.cache_writer.write_delete_key_diff(
                    self.source_table,
                    self.target_table,
                    &target.key_signature,
                    &target.key_row,
                )?;
            }
        }

        Ok(())
    }

    async fn finish(mut self) -> Result<CachedTableDiffResult, AppError> {
        self.flush_update_batch().await?;

        let (sample_inserts, sample_updates, sample_deletes) = tokio::try_join!(
            load_row_samples_by_keys(
                self.source_session,
                self.source_table,
                self.compared_columns,
                self.key_columns,
                &self.sample_insert_keys
            ),
            load_update_samples_by_keys(
                self.source_session,
                self.target_session,
                self.source_table,
                self.target_table,
                self.compared_columns,
                self.key_columns,
                &self.sample_update_keys
            ),
            load_row_samples_by_keys(
                self.target_session,
                self.target_table,
                self.compared_columns,
                self.key_columns,
                &self.sample_delete_keys
            )
        )?;

        Ok(CachedTableDiffResult {
            insert_count: self.insert_count,
            update_count: self.update_count,
            delete_count: self.delete_count,
            sample_inserts,
            sample_updates,
            sample_deletes,
        })
    }

    async fn flush_update_batch(&mut self) -> Result<(), AppError> {
        if self.pending_update_keys.is_empty() {
            return Ok(());
        }

        let key_rows = mem::take(&mut self.pending_update_keys);
        let (source_rows, target_rows) = tokio::try_join!(
            fetch_rows_by_keys_in_batches(
                self.source_session,
                self.source_table,
                self.compared_columns,
                self.key_columns,
                &key_rows
            ),
            fetch_rows_by_keys_in_batches(
                self.target_session,
                self.target_table,
                self.compared_columns,
                self.key_columns,
                &key_rows
            )
        )?;
        let source_map = build_unique_key_map(source_rows, self.key_columns);
        let target_map = build_unique_key_map(target_rows, self.key_columns);

        for key_row in key_rows {
            let key_signature = row_signature(&key_row, self.key_columns);
            let source_row = source_map.get(&key_signature).ok_or_else(|| {
                AppError::Parse(format!("未找到 UPDATE 源端差异行: {}", key_signature))
            })?;
            let target_row = target_map.get(&key_signature).ok_or_else(|| {
                AppError::Parse(format!("未找到 UPDATE 目标端差异行: {}", key_signature))
            })?;
            self.cache_writer.write_update_diff(
                self.source_table,
                self.target_table,
                &key_signature,
                source_row,
                target_row,
            )?;
        }

        Ok(())
    }
}

fn diff_columns_between_rows(
    source_row: &RowMap,
    target_row: &RowMap,
    compared_columns: &[String],
) -> Vec<String> {
    compared_columns
        .iter()
        .filter(|column| {
            !values_equal(
                source_row.get(column.as_str()),
                target_row.get(column.as_str()),
            )
        })
        .cloned()
        .collect::<Vec<_>>()
}

async fn compare_keyed_table_hash_to_cache(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    compared_columns: &[String],
    source_hash_columns: &[TableColumnDefinition],
    target_hash_columns: &[TableColumnDefinition],
    key_columns: &[String],
    numeric_chunk_plan: Option<&NumericChunkPlan>,
    preview_limit: usize,
    cache_writer: &mut DiffCacheWriter,
    control: Option<&CompareExecutionControl<'_>>,
    total_tables: usize,
    completed_tables: usize,
) -> Result<CachedTableDiffResult, AppError> {
    cache_writer.begin_diff_write()?;
    let mut collector = KeyedDiffCacheCollector::new(
        source_session,
        target_session,
        source_table,
        target_table,
        compared_columns,
        key_columns,
        preview_limit,
        cache_writer,
    );

    let result = async {
        scan_keyed_table_hash_differences_into_cache(
            source_session,
            target_session,
            source_table,
            target_table,
            source_hash_columns,
            target_hash_columns,
            key_columns,
            numeric_chunk_plan,
            &mut collector,
            control,
            total_tables,
            completed_tables,
        )
        .await?;

        collector.finish().await
    }
    .await;

    match result {
        Ok(result) => {
            cache_writer.commit_diff_write()?;
            Ok(result)
        }
        Err(error) => {
            let _ = cache_writer.rollback_diff_write();
            Err(error)
        }
    }
}

async fn scan_keyed_table_hash_differences_into_cache(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    source_hash_columns: &[TableColumnDefinition],
    target_hash_columns: &[TableColumnDefinition],
    key_columns: &[String],
    numeric_chunk_plan: Option<&NumericChunkPlan>,
    collector: &mut KeyedDiffCacheCollector<'_>,
    control: Option<&CompareExecutionControl<'_>>,
    total_tables: usize,
    completed_tables: usize,
) -> Result<(), AppError> {
    if let Some(chunk_plan) = numeric_chunk_plan {
        return scan_keyed_table_hash_differences_by_chunks_into_cache(
            source_session,
            target_session,
            source_table,
            target_table,
            source_hash_columns,
            target_hash_columns,
            key_columns,
            chunk_plan,
            collector,
            control,
            total_tables,
            completed_tables,
        )
        .await;
    }

    scan_keyed_table_hash_differences_full_into_cache(
        source_session,
        target_session,
        source_table,
        target_table,
        source_hash_columns,
        target_hash_columns,
        key_columns,
        collector,
        control,
    )
    .await
}

async fn scan_keyed_table_hash_differences_full_into_cache(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    source_hash_columns: &[TableColumnDefinition],
    target_hash_columns: &[TableColumnDefinition],
    key_columns: &[String],
    collector: &mut KeyedDiffCacheCollector<'_>,
    control: Option<&CompareExecutionControl<'_>>,
) -> Result<(), AppError> {
    check_compare_cancellation(control)?;
    let (mut source_conn, mut target_conn) =
        tokio::try_join!(source_session.get_conn(), target_session.get_conn())?;

    let source_sql = source_session.build_select_row_hashes_sql(
        source_table,
        source_hash_columns,
        key_columns,
        ROW_HASH_ALIAS,
    );
    let target_sql = target_session.build_select_row_hashes_sql(
        target_table,
        target_hash_columns,
        key_columns,
        ROW_HASH_ALIAS,
    );

    let (mut source_result, mut target_result) = tokio::try_join!(
        async {
            source_conn
                .query_iter(source_sql)
                .await
                .map_err(AppError::from_mysql)
        },
        async {
            target_conn
                .query_iter(target_sql)
                .await
                .map_err(AppError::from_mysql)
        }
    )?;

    let scan_result = async {
        let mut source_row = next_keyed_hash_row(&mut source_result, key_columns).await?;
        let mut target_row = next_keyed_hash_row(&mut target_result, key_columns).await?;

        while source_row.is_some() || target_row.is_some() {
            check_compare_cancellation(control)?;
            match (&source_row, &target_row) {
                (Some(source), Some(target)) => {
                    match compare_row_keys(&source.key_row, &target.key_row, key_columns) {
                        Ordering::Less => {
                            collector
                                .handle_event(KeyedHashDiffEvent::Insert {
                                    source: source.clone(),
                                })
                                .await?;
                            source_row =
                                next_keyed_hash_row(&mut source_result, key_columns).await?;
                        }
                        Ordering::Greater => {
                            collector
                                .handle_event(KeyedHashDiffEvent::Delete {
                                    target: target.clone(),
                                })
                                .await?;
                            target_row =
                                next_keyed_hash_row(&mut target_result, key_columns).await?;
                        }
                        Ordering::Equal => {
                            if source.row_hash != target.row_hash {
                                collector
                                    .handle_event(KeyedHashDiffEvent::Update {
                                        source: source.clone(),
                                        target: target.clone(),
                                    })
                                    .await?;
                            }

                            source_row =
                                next_keyed_hash_row(&mut source_result, key_columns).await?;
                            target_row =
                                next_keyed_hash_row(&mut target_result, key_columns).await?;
                        }
                    }
                }
                (Some(source), None) => {
                    collector
                        .handle_event(KeyedHashDiffEvent::Insert {
                            source: source.clone(),
                        })
                        .await?;
                    source_row = next_keyed_hash_row(&mut source_result, key_columns).await?;
                }
                (None, Some(target)) => {
                    collector
                        .handle_event(KeyedHashDiffEvent::Delete {
                            target: target.clone(),
                        })
                        .await?;
                    target_row = next_keyed_hash_row(&mut target_result, key_columns).await?;
                }
                (None, None) => break,
            }
        }

        Ok::<_, AppError>(())
    }
    .await;

    let source_drop = source_result
        .drop_result()
        .await
        .map_err(AppError::from_mysql);
    let target_drop = target_result
        .drop_result()
        .await
        .map_err(AppError::from_mysql);

    scan_result?;
    source_drop?;
    target_drop?;
    Ok(())
}

async fn scan_keyed_table_hash_differences_by_chunks_into_cache(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    source_hash_columns: &[TableColumnDefinition],
    target_hash_columns: &[TableColumnDefinition],
    key_columns: &[String],
    chunk_plan: &NumericChunkPlan,
    collector: &mut KeyedDiffCacheCollector<'_>,
    control: Option<&CompareExecutionControl<'_>>,
    total_tables: usize,
    completed_tables: usize,
) -> Result<(), AppError> {
    check_compare_cancellation(control)?;
    let (source_bounds, target_bounds) = tokio::try_join!(
        source_session.get_key_range_values(source_table, &chunk_plan.key_column),
        target_session.get_key_range_values(target_table, &chunk_plan.key_column)
    )?;

    let merged_bounds = merge_numeric_ranges(
        normalize_numeric_range(source_bounds.0, source_bounds.1, chunk_plan.unsigned)?,
        normalize_numeric_range(target_bounds.0, target_bounds.1, chunk_plan.unsigned)?,
    );

    let Some((mut chunk_start, max_inclusive)) = merged_bounds else {
        return Ok(());
    };
    let total_chunks = numeric_chunk_count(chunk_start, max_inclusive, chunk_plan.chunk_size);

    let (mut source_conn, mut target_conn) =
        tokio::try_join!(source_session.get_conn(), target_session.get_conn())?;
    tokio::try_join!(
        ensure_group_concat_max_len(&mut source_conn),
        ensure_group_concat_max_len(&mut target_conn)
    )?;

    let mut current_chunk = 0usize;
    loop {
        check_compare_cancellation(control)?;
        current_chunk += 1;
        report_compare_progress(
            control,
            build_table_phase_update(
                total_tables,
                completed_tables,
                source_table,
                target_table,
                CompareTaskPhase::ChunkHashScan,
                Some(CompareTaskPhaseProgress {
                    current: current_chunk,
                    total: total_chunks.max(1),
                }),
            ),
        );
        let chunk_end =
            build_chunk_end_inclusive(chunk_start, max_inclusive, chunk_plan.chunk_size);
        let chunk_filter =
            build_numeric_chunk_filter(&chunk_plan.key_column, chunk_start, chunk_end);

        let (source_summary, target_summary) = tokio::try_join!(
            load_chunk_hash_summary(
                &mut source_conn,
                source_session.build_chunk_hash_sql(
                    source_table,
                    source_hash_columns,
                    &chunk_plan.key_column,
                    CHUNK_COUNT_ALIAS,
                    CHUNK_HASH_ALIAS,
                    Some(&chunk_filter),
                ),
            ),
            load_chunk_hash_summary(
                &mut target_conn,
                target_session.build_chunk_hash_sql(
                    target_table,
                    target_hash_columns,
                    &chunk_plan.key_column,
                    CHUNK_COUNT_ALIAS,
                    CHUNK_HASH_ALIAS,
                    Some(&chunk_filter),
                ),
            )
        )?;

        if source_summary.row_count != target_summary.row_count
            || source_summary.chunk_hash != target_summary.chunk_hash
        {
            let (source_rows, target_rows) = tokio::try_join!(
                load_keyed_hash_rows(
                    &mut source_conn,
                    source_session.build_select_row_hashes_sql_with_filter(
                        source_table,
                        source_hash_columns,
                        key_columns,
                        ROW_HASH_ALIAS,
                        Some(&chunk_filter),
                    ),
                    key_columns,
                ),
                load_keyed_hash_rows(
                    &mut target_conn,
                    target_session.build_select_row_hashes_sql_with_filter(
                        target_table,
                        target_hash_columns,
                        key_columns,
                        ROW_HASH_ALIAS,
                        Some(&chunk_filter),
                    ),
                    key_columns,
                )
            )?;

            emit_keyed_hash_diff_events_into_cache(
                source_rows,
                target_rows,
                key_columns,
                collector,
            )
            .await?;
        }

        if chunk_end == max_inclusive {
            break;
        }
        chunk_start = next_numeric_key_value(chunk_end)?;
    }

    Ok(())
}

async fn emit_keyed_hash_diff_events_into_cache(
    source_rows: Vec<KeyedHashRow>,
    target_rows: Vec<KeyedHashRow>,
    key_columns: &[String],
    collector: &mut KeyedDiffCacheCollector<'_>,
) -> Result<(), AppError> {
    let mut source_iter = source_rows.into_iter().peekable();
    let mut target_iter = target_rows.into_iter().peekable();

    while source_iter.peek().is_some() || target_iter.peek().is_some() {
        match (source_iter.peek(), target_iter.peek()) {
            (Some(source), Some(target)) => {
                match compare_row_keys(&source.key_row, &target.key_row, key_columns) {
                    Ordering::Less => {
                        collector
                            .handle_event(KeyedHashDiffEvent::Insert {
                                source: source_iter.next().expect("source row must exist"),
                            })
                            .await?;
                    }
                    Ordering::Greater => {
                        collector
                            .handle_event(KeyedHashDiffEvent::Delete {
                                target: target_iter.next().expect("target row must exist"),
                            })
                            .await?;
                    }
                    Ordering::Equal => {
                        let source = source_iter.next().expect("source row must exist");
                        let target = target_iter.next().expect("target row must exist");
                        if source.row_hash != target.row_hash {
                            collector
                                .handle_event(KeyedHashDiffEvent::Update { source, target })
                                .await?;
                        }
                    }
                }
            }
            (Some(_), None) => {
                collector
                    .handle_event(KeyedHashDiffEvent::Insert {
                        source: source_iter.next().expect("source row must exist"),
                    })
                    .await?;
            }
            (None, Some(_)) => {
                collector
                    .handle_event(KeyedHashDiffEvent::Delete {
                        target: target_iter.next().expect("target row must exist"),
                    })
                    .await?;
            }
            (None, None) => break,
        }
    }

    Ok(())
}

async fn compare_with_full_row_cache(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    compared_columns: &[String],
    cache_writer: &mut DiffCacheWriter,
    preview_limit: usize,
    control: Option<&CompareExecutionControl<'_>>,
    total_tables: usize,
    completed_tables: usize,
) -> Result<CachedTableDiffResult, AppError> {
    cache_writer.reset_full_row_staging()?;
    cache_writer.begin_stage_load()?;

    let load_result = async {
        stage_rows_for_full_row_cache(
            source_session,
            source_table,
            compared_columns,
            cache_writer,
            true,
            control,
        )
        .await?;
        report_compare_progress(
            control,
            build_table_phase_update(
                total_tables,
                completed_tables,
                source_table,
                target_table,
                CompareTaskPhase::TargetStageLoad,
                None,
            ),
        );
        stage_rows_for_full_row_cache(
            target_session,
            target_table,
            compared_columns,
            cache_writer,
            false,
            control,
        )
        .await?;
        Ok::<_, AppError>(())
    }
    .await;

    match load_result {
        Ok(()) => {
            cache_writer.commit_stage_load()?;
            report_compare_progress(
                control,
                build_table_phase_update(
                    total_tables,
                    completed_tables,
                    source_table,
                    target_table,
                    CompareTaskPhase::FinalizeCache,
                    None,
                ),
            );
            let stage_result =
                cache_writer.finalize_full_row_stage(source_table, target_table, preview_limit)?;
            Ok(CachedTableDiffResult {
                insert_count: stage_result.insert_count,
                update_count: 0,
                delete_count: stage_result.delete_count,
                sample_inserts: stage_result.sample_inserts,
                sample_updates: Vec::new(),
                sample_deletes: stage_result.sample_deletes,
            })
        }
        Err(error) => {
            let _ = cache_writer.rollback_stage_load();
            Err(error)
        }
    }
}

async fn compare_unsafe_keyed_rows_with_cache(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    key_columns: &[String],
    compared_columns: &[String],
    cache_writer: &mut DiffCacheWriter,
    preview_limit: usize,
    control: Option<&CompareExecutionControl<'_>>,
    total_tables: usize,
    completed_tables: usize,
) -> Result<UnsafeKeyStageOutcome, AppError> {
    cache_writer.reset_keyed_row_staging()?;
    cache_writer.begin_stage_load()?;

    let load_result = async {
        stage_rows_for_keyed_cache(
            source_session,
            source_table,
            compared_columns,
            key_columns,
            cache_writer,
            true,
            control,
        )
        .await?;
        report_compare_progress(
            control,
            build_table_phase_update(
                total_tables,
                completed_tables,
                source_table,
                target_table,
                CompareTaskPhase::TargetStageLoad,
                None,
            ),
        );
        stage_rows_for_keyed_cache(
            target_session,
            target_table,
            compared_columns,
            key_columns,
            cache_writer,
            false,
            control,
        )
        .await?;
        Ok::<_, AppError>(())
    }
    .await;

    match load_result {
        Ok(()) => {
            cache_writer.commit_stage_load()?;
        }
        Err(error) => {
            let _ = cache_writer.rollback_stage_load();
            return Err(error);
        }
    }

    report_compare_progress(
        control,
        build_table_phase_update(
            total_tables,
            completed_tables,
            source_table,
            target_table,
            CompareTaskPhase::FinalizeCache,
            None,
        ),
    );
    if cache_writer.has_duplicate_key_stage_rows()? {
        let stage_result = cache_writer.finalize_keyed_stage_as_full_row(
            source_table,
            target_table,
            preview_limit,
        )?;
        return Ok(UnsafeKeyStageOutcome::FullRow {
            insert_count: stage_result.insert_count,
            delete_count: stage_result.delete_count,
            sample_inserts: stage_result.sample_inserts,
            sample_deletes: stage_result.sample_deletes,
        });
    }

    cache_writer
        .finalize_keyed_stage(
            source_table,
            target_table,
            key_columns,
            compared_columns,
            preview_limit,
        )
        .map(UnsafeKeyStageOutcome::Keyed)
}

async fn stage_rows_for_full_row_cache(
    session: &MySqlSession,
    table: &str,
    compared_columns: &[String],
    cache_writer: &mut DiffCacheWriter,
    is_source: bool,
    control: Option<&CompareExecutionControl<'_>>,
) -> Result<(), AppError> {
    let mut conn = session.get_conn().await?;
    let sql = session.build_select_rows_sql(table, compared_columns, &[]);
    let mut result = conn.query_iter(sql).await.map_err(AppError::from_mysql)?;

    while let Some(row) = next_row_map(&mut result).await? {
        check_compare_cancellation(control)?;
        let signature = row_signature(&row, compared_columns);
        if is_source {
            cache_writer.insert_source_stage_row(&signature, &row)?;
        } else {
            cache_writer.insert_target_stage_row(&signature, &row)?;
        }
    }

    result.drop_result().await.map_err(AppError::from_mysql)?;
    Ok(())
}

async fn stage_rows_for_keyed_cache(
    session: &MySqlSession,
    table: &str,
    compared_columns: &[String],
    key_columns: &[String],
    cache_writer: &mut DiffCacheWriter,
    is_source: bool,
    control: Option<&CompareExecutionControl<'_>>,
) -> Result<(), AppError> {
    let mut conn = session.get_conn().await?;
    let sql = session.build_select_rows_sql(table, compared_columns, &[]);
    let mut result = conn.query_iter(sql).await.map_err(AppError::from_mysql)?;

    while let Some(row) = next_row_map(&mut result).await? {
        check_compare_cancellation(control)?;
        let key_signature = row_signature(&row, key_columns);
        let row_signature_text = row_signature(&row, compared_columns);
        if is_source {
            cache_writer.insert_source_key_stage_row(&key_signature, &row_signature_text, &row)?;
        } else {
            cache_writer.insert_target_key_stage_row(&key_signature, &row_signature_text, &row)?;
        }
    }

    result.drop_result().await.map_err(AppError::from_mysql)?;
    Ok(())
}

async fn load_row_samples_by_keys(
    session: &MySqlSession,
    table: &str,
    compared_columns: &[String],
    key_columns: &[String],
    key_rows: &[RowMap],
) -> Result<Vec<RowSample>, AppError> {
    if key_rows.is_empty() {
        return Ok(Vec::new());
    }

    let rows =
        fetch_rows_by_keys_in_batches(session, table, compared_columns, key_columns, key_rows)
            .await?;
    let row_map = build_unique_key_map(rows, key_columns);

    Ok(key_rows
        .iter()
        .filter_map(|key_row| {
            let key_signature = row_signature(key_row, key_columns);
            row_map.get(&key_signature).map(|row| RowSample {
                signature: key_signature,
                row: row_to_json(row),
            })
        })
        .collect())
}

async fn load_row_items_by_keys(
    session: &MySqlSession,
    table: &str,
    compared_columns: &[String],
    key_columns: &[String],
    key_rows: &[RowMap],
) -> Result<Vec<RowTableItem>, AppError> {
    if key_rows.is_empty() {
        return Ok(Vec::new());
    }

    let rows =
        fetch_rows_by_keys_in_batches(session, table, compared_columns, key_columns, key_rows)
            .await?;
    let row_map = build_unique_key_map(rows, key_columns);

    Ok(key_rows
        .iter()
        .filter_map(|key_row| {
            let key_signature = row_signature(key_row, key_columns);
            row_map.get(&key_signature).map(|row| RowTableItem {
                signature: key_signature,
                values: row_to_json_values(row, compared_columns),
            })
        })
        .collect())
}

async fn load_update_samples_by_keys(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    compared_columns: &[String],
    key_columns: &[String],
    key_rows: &[RowMap],
) -> Result<Vec<UpdateSample>, AppError> {
    if key_rows.is_empty() {
        return Ok(Vec::new());
    }

    let (source_rows, target_rows) = tokio::try_join!(
        fetch_rows_by_keys_in_batches(
            source_session,
            source_table,
            compared_columns,
            key_columns,
            key_rows
        ),
        fetch_rows_by_keys_in_batches(
            target_session,
            target_table,
            compared_columns,
            key_columns,
            key_rows
        )
    )?;

    let source_map = build_unique_key_map(source_rows, key_columns);
    let target_map = build_unique_key_map(target_rows, key_columns);

    Ok(key_rows
        .iter()
        .filter_map(|key_row| {
            let key_signature = row_signature(key_row, key_columns);
            let source_row = source_map.get(&key_signature)?;
            let target_row = target_map.get(&key_signature)?;
            let diff_columns = diff_columns_between_rows(source_row, target_row, compared_columns);
            if diff_columns.is_empty() {
                return None;
            }

            Some(UpdateSample {
                signature: key_signature,
                key: key_to_json(source_row, key_columns),
                source_row: row_to_json(source_row),
                target_row: row_to_json(target_row),
                diff_columns,
            })
        })
        .collect())
}

async fn build_insert_sql_batch(
    target_database: &str,
    target_table: &str,
    source_session: &MySqlSession,
    source_table: &str,
    compared_columns: &[String],
    key_columns: &[String],
    key_rows: &[RowMap],
) -> Result<Vec<String>, AppError> {
    if key_rows.is_empty() {
        return Ok(Vec::new());
    }

    let rows = fetch_rows_by_keys_in_batches(
        source_session,
        source_table,
        compared_columns,
        key_columns,
        key_rows,
    )
    .await?;
    let row_map = build_unique_key_map(rows, key_columns);

    Ok(key_rows
        .iter()
        .filter_map(|key_row| {
            let key_signature = row_signature(key_row, key_columns);
            row_map
                .get(&key_signature)
                .map(|row| build_insert_sql(target_database, target_table, compared_columns, row))
        })
        .collect())
}

async fn build_update_sql_batch(
    target_database: &str,
    target_table: &str,
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table_name: &str,
    compared_columns: &[String],
    key_columns: &[String],
    key_rows: &[RowMap],
) -> Result<Vec<String>, AppError> {
    if key_rows.is_empty() {
        return Ok(Vec::new());
    }

    let (source_rows, target_rows) = tokio::try_join!(
        fetch_rows_by_keys_in_batches(
            source_session,
            source_table,
            compared_columns,
            key_columns,
            key_rows
        ),
        fetch_rows_by_keys_in_batches(
            target_session,
            target_table_name,
            compared_columns,
            key_columns,
            key_rows
        )
    )?;

    let key_column_set = key_columns.iter().cloned().collect::<HashSet<_>>();
    let source_map = build_unique_key_map(source_rows, key_columns);
    let target_map = build_unique_key_map(target_rows, key_columns);

    Ok(key_rows
        .iter()
        .filter_map(|key_row| {
            let key_signature = row_signature(key_row, key_columns);
            let source_row = source_map.get(&key_signature)?;
            let target_row = target_map.get(&key_signature)?;
            let update_columns =
                diff_columns_between_rows(source_row, target_row, compared_columns)
                    .into_iter()
                    .filter(|column| !key_column_set.contains(column))
                    .collect::<Vec<_>>();

            build_update_sql(
                target_database,
                target_table,
                &update_columns,
                key_columns,
                source_row,
            )
        })
        .collect())
}

async fn generate_sql_with_keys_streaming(
    target_database: &str,
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    key_columns: &[String],
    compared_columns: &[String],
    source_hash_columns: &[TableColumnDefinition],
    target_hash_columns: &[TableColumnDefinition],
    numeric_chunk_plan: Option<&NumericChunkPlan>,
    selection: &mut RuntimeTableSelection,
    sql_statements: &mut Vec<String>,
    stats: &mut SqlGenerationStats,
) -> Result<(), AppError> {
    let mut insert_keys = Vec::new();
    let mut update_keys = Vec::new();
    let effective_numeric_chunk_plan = resolve_numeric_chunk_plan(
        source_session,
        target_session,
        source_table,
        target_table,
        numeric_chunk_plan,
    )
    .await?;

    scan_keyed_table_hash_differences(
        source_session,
        target_session,
        source_table,
        target_table,
        source_hash_columns,
        target_hash_columns,
        key_columns,
        effective_numeric_chunk_plan.as_ref(),
        |event| {
            match event {
                KeyedHashDiffEvent::Insert { source } => {
                    if selection.insert_enabled
                        && !consume_exclusion(&mut selection.excluded_insert, &source.key_signature)
                    {
                        insert_keys.push(source.key_row);
                    }
                }
                KeyedHashDiffEvent::Update { source, target } => {
                    let _ = target;
                    if selection.update_enabled
                        && !consume_exclusion(&mut selection.excluded_update, &source.key_signature)
                    {
                        update_keys.push(source.key_row);
                    }
                }
                KeyedHashDiffEvent::Delete { target } => {
                    if selection.delete_enabled
                        && !consume_exclusion(&mut selection.excluded_delete, &target.key_signature)
                    {
                        sql_statements.push(build_delete_by_keys_sql(
                            target_database,
                            target_table,
                            key_columns,
                            &target.key_row,
                        ));
                        stats.delete_count += 1;
                    }
                }
            }

            Ok(())
        },
    )
    .await?;

    for chunk in insert_keys.chunks(KEYED_DIFF_BATCH_SIZE) {
        let sql_batch = build_insert_sql_batch(
            target_database,
            target_table,
            source_session,
            source_table,
            compared_columns,
            key_columns,
            chunk,
        )
        .await?;
        stats.insert_count += sql_batch.len();
        sql_statements.extend(sql_batch);
    }

    for chunk in update_keys.chunks(KEYED_DIFF_BATCH_SIZE) {
        let sql_batch = build_update_sql_batch(
            target_database,
            target_table,
            source_session,
            target_session,
            source_table,
            target_table,
            compared_columns,
            key_columns,
            chunk,
        )
        .await?;
        stats.update_count += sql_batch.len();
        sql_statements.extend(sql_batch);
    }

    Ok(())
}

async fn write_sql_with_keys_streaming(
    target_database: &str,
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    key_columns: &[String],
    compared_columns: &[String],
    source_hash_columns: &[TableColumnDefinition],
    target_hash_columns: &[TableColumnDefinition],
    numeric_chunk_plan: Option<&NumericChunkPlan>,
    selection: &mut RuntimeTableSelection,
    writer: &mut SqlFileWriter,
    stats: &mut SqlGenerationStats,
) -> Result<(), AppError> {
    let mut insert_keys = Vec::new();
    let mut update_keys = Vec::new();
    let effective_numeric_chunk_plan = resolve_numeric_chunk_plan(
        source_session,
        target_session,
        source_table,
        target_table,
        numeric_chunk_plan,
    )
    .await?;

    scan_keyed_table_hash_differences(
        source_session,
        target_session,
        source_table,
        target_table,
        source_hash_columns,
        target_hash_columns,
        key_columns,
        effective_numeric_chunk_plan.as_ref(),
        |event| {
            match event {
                KeyedHashDiffEvent::Insert { source } => {
                    if selection.insert_enabled
                        && !consume_exclusion(&mut selection.excluded_insert, &source.key_signature)
                    {
                        insert_keys.push(source.key_row);
                    }
                }
                KeyedHashDiffEvent::Update { source, target } => {
                    let _ = target;
                    if selection.update_enabled
                        && !consume_exclusion(&mut selection.excluded_update, &source.key_signature)
                    {
                        update_keys.push(source.key_row);
                    }
                }
                KeyedHashDiffEvent::Delete { target } => {
                    if selection.delete_enabled
                        && !consume_exclusion(&mut selection.excluded_delete, &target.key_signature)
                    {
                        writer.write_statement(&build_delete_by_keys_sql(
                            target_database,
                            target_table,
                            key_columns,
                            &target.key_row,
                        ))?;
                        stats.delete_count += 1;
                    }
                }
            }

            Ok(())
        },
    )
    .await?;

    for chunk in insert_keys.chunks(KEYED_DIFF_BATCH_SIZE) {
        let sql_batch = build_insert_sql_batch(
            target_database,
            target_table,
            source_session,
            source_table,
            compared_columns,
            key_columns,
            chunk,
        )
        .await?;
        for sql in &sql_batch {
            writer.write_statement(sql)?;
        }
        stats.insert_count += sql_batch.len();
    }

    for chunk in update_keys.chunks(KEYED_DIFF_BATCH_SIZE) {
        let sql_batch = build_update_sql_batch(
            target_database,
            target_table,
            source_session,
            target_session,
            source_table,
            target_table,
            compared_columns,
            key_columns,
            chunk,
        )
        .await?;
        for sql in &sql_batch {
            writer.write_statement(sql)?;
        }
        stats.update_count += sql_batch.len();
    }

    Ok(())
}

fn build_unique_key_map(rows: Vec<RowMap>, key_columns: &[String]) -> BTreeMap<String, RowMap> {
    let mut map = BTreeMap::new();

    for row in rows {
        let key = row_signature(&row, key_columns);
        map.insert(key, row);
    }

    map
}

fn build_table_pairs(
    request: &CompareRequest,
    source_tables: &[String],
    target_tables: &[String],
) -> (Vec<(String, String)>, Vec<SkippedTable>) {
    let source_set = source_tables.iter().cloned().collect::<HashSet<_>>();
    let target_set = target_tables.iter().cloned().collect::<HashSet<_>>();

    let mut pairs = Vec::new();
    let mut skipped = Vec::new();

    if !request.table_mappings.is_empty() {
        for mapping in &request.table_mappings {
            match validate_pair(&source_set, &target_set, mapping) {
                Ok(pair) => pairs.push(pair),
                Err(reason) => {
                    skipped.push(SkippedTable {
                        source_table: mapping.source_table.clone(),
                        target_table: mapping.target_table.clone(),
                        reason,
                    });
                }
            }
        }
        deduplicate_pairs(&mut pairs);
        return (pairs, skipped);
    }

    match request.table_mode {
        TableMode::Selected => {
            for table in &request.selected_tables {
                let mapping = TableMapping {
                    source_table: table.clone(),
                    target_table: table.clone(),
                };

                match validate_pair(&source_set, &target_set, &mapping) {
                    Ok(pair) => pairs.push(pair),
                    Err(reason) => {
                        skipped.push(SkippedTable {
                            source_table: table.clone(),
                            target_table: table.clone(),
                            reason,
                        });
                    }
                }
            }
        }
        TableMode::All => {
            for source_table in source_tables {
                if target_set.contains(source_table) {
                    pairs.push((source_table.clone(), source_table.clone()));
                } else {
                    skipped.push(SkippedTable {
                        source_table: source_table.clone(),
                        target_table: source_table.clone(),
                        reason: "目标库不存在同名表".to_string(),
                    });
                }
            }

            for target_table in target_tables {
                if !source_set.contains(target_table) {
                    skipped.push(SkippedTable {
                        source_table: target_table.clone(),
                        target_table: target_table.clone(),
                        reason: "源库不存在同名表".to_string(),
                    });
                }
            }
        }
    }

    deduplicate_pairs(&mut pairs);
    (pairs, skipped)
}

fn validate_pair(
    source_set: &HashSet<String>,
    target_set: &HashSet<String>,
    mapping: &TableMapping,
) -> Result<(String, String), String> {
    if !source_set.contains(&mapping.source_table) {
        return Err("源库不存在该表".to_string());
    }

    if !target_set.contains(&mapping.target_table) {
        return Err("目标库不存在该表".to_string());
    }

    Ok((mapping.source_table.clone(), mapping.target_table.clone()))
}

fn deduplicate_pairs(pairs: &mut Vec<(String, String)>) {
    let mut set = BTreeSet::new();
    pairs.retain(|pair| set.insert(pair.clone()));
}

fn join_limited(values: &[String]) -> String {
    const LIMIT: usize = 8;
    if values.len() <= LIMIT {
        return values.join(", ");
    }

    let mut head = values[..LIMIT].to_vec();
    head.push(format!("... 共 {} 项", values.len()));
    head.join(", ")
}

fn build_runtime_selection_map(
    selections: &[TableSqlSelection],
) -> HashMap<(String, String), RuntimeTableSelection> {
    let mut map = HashMap::new();

    for selection in selections {
        map.insert(
            (
                selection.source_table.clone(),
                selection.target_table.clone(),
            ),
            RuntimeTableSelection {
                table_enabled: selection.table_enabled,
                insert_enabled: selection.insert_enabled,
                update_enabled: selection.update_enabled,
                delete_enabled: selection.delete_enabled,
                excluded_insert: build_exclusion_counts(&selection.excluded_insert_signatures),
                excluded_update: build_exclusion_counts(&selection.excluded_update_signatures),
                excluded_delete: build_exclusion_counts(&selection.excluded_delete_signatures),
            },
        );
    }

    map
}

fn build_exclusion_counts(signatures: &[String]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for signature in signatures {
        let normalized = signature.trim();
        if normalized.is_empty() {
            continue;
        }
        let counter = counts.entry(normalized.to_string()).or_insert(0);
        *counter += 1;
    }
    counts
}

fn consume_exclusion(counts: &mut BTreeMap<String, usize>, signature: &str) -> bool {
    if let Some(counter) = counts.get_mut(signature) {
        if *counter > 0 {
            *counter -= 1;
            return true;
        }
    }
    false
}

fn open_diff_cache_reader(compare_id: Option<&str>, action_label: &str) -> Option<DiffCacheReader> {
    let compare_id = compare_id
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    match DiffCacheReader::open(compare_id) {
        Ok(reader) => Some(reader),
        Err(error) => {
            warn!(
                compare_id = %compare_id,
                error = %error,
                action = %action_label,
                "差异缓存不可用，已回退到实时计算路径"
            );
            None
        }
    }
}

fn load_cached_detail(
    compare_id: &str,
    request: &CompareDetailPageRequest,
) -> Result<Option<CachedDetailLoad>, AppError> {
    let Some(reader) = open_diff_cache_reader(Some(compare_id), "加载差异详情") else {
        return Ok(None);
    };

    let Some(summary) = reader.load_table_summary(&request.source_table, &request.target_table)?
    else {
        return Ok(None);
    };

    if is_lazy_keyed_compare_mode(&summary.compare_mode) {
        let cached_page = reader.load_diff_page(
            &request.source_table,
            &request.target_table,
            request.detail_type,
            request.offset,
            request.limit,
        )?;
        return Ok(Some(CachedDetailLoad::Keyed {
            summary,
            cached_page,
        }));
    }

    let response = reader.load_detail_page(
        &request.source_table,
        &request.target_table,
        request.detail_type,
        request.offset,
        request.limit,
    )?;
    Ok(Some(CachedDetailLoad::Direct(response)))
}

fn load_cached_table_summary(
    compare_id: &str,
    action_label: &str,
    source_table: &str,
    target_table: &str,
) -> Result<Option<TableCompareResult>, AppError> {
    let Some(reader) = open_diff_cache_reader(Some(compare_id), action_label) else {
        return Ok(None);
    };
    reader.load_table_summary(source_table, target_table)
}

fn load_cached_diff_page_by_compare_id(
    compare_id: &str,
    action_label: &str,
    source_table: &str,
    target_table: &str,
    detail_type: CompareDetailType,
    offset: usize,
    limit: usize,
) -> Result<Option<CachedDiffPage>, AppError> {
    let Some(reader) = open_diff_cache_reader(Some(compare_id), action_label) else {
        return Ok(None);
    };
    reader
        .load_diff_page(source_table, target_table, detail_type, offset, limit)
        .map(Some)
}

async fn emit_cached_sql_for_table<F>(
    compare_id: &str,
    action_label: &str,
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    target_database: &str,
    summary: &TableCompareResult,
    selection: &mut RuntimeTableSelection,
    mut on_sql: F,
    stats: &mut SqlGenerationStats,
) -> Result<(), AppError>
where
    F: FnMut(String) -> Result<(), AppError>,
{
    let key_column_set = summary.key_columns.iter().cloned().collect::<HashSet<_>>();
    let mut insert_key_rows = Vec::new();
    let mut update_key_rows = Vec::new();

    let mut delete_offset = 0usize;
    loop {
        let Some(page) = load_cached_diff_page_by_compare_id(
            compare_id,
            action_label,
            &summary.source_table,
            &summary.target_table,
            CompareDetailType::Delete,
            delete_offset,
            CACHED_DIFF_PAGE_SIZE,
        )?
        else {
            break;
        };

        if page.rows.is_empty() {
            break;
        }

        let page_len = page.rows.len();
        let page_total = page.total;
        for diff in page.rows {
            if !selection.delete_enabled
                || consume_exclusion(&mut selection.excluded_delete, &diff.signature)
            {
                continue;
            }

            let target_row = diff.target_row.or(diff.key_row).ok_or_else(|| {
                AppError::Parse("缓存中的 delete 记录缺少目标端行数据".to_string())
            })?;
            let sql = if summary.key_columns.is_empty() {
                build_delete_by_row_sql(
                    target_database,
                    &summary.target_table,
                    &summary.compared_columns,
                    &target_row,
                )
            } else {
                build_delete_by_keys_sql(
                    target_database,
                    &summary.target_table,
                    &summary.key_columns,
                    &target_row,
                )
            };
            on_sql(sql)?;
            stats.delete_count += 1;
        }

        delete_offset = delete_offset.saturating_add(page_len);
        if delete_offset >= page_total {
            break;
        }
    }

    let mut insert_offset = 0usize;
    loop {
        let Some(page) = load_cached_diff_page_by_compare_id(
            compare_id,
            action_label,
            &summary.source_table,
            &summary.target_table,
            CompareDetailType::Insert,
            insert_offset,
            CACHED_DIFF_PAGE_SIZE,
        )?
        else {
            break;
        };

        if page.rows.is_empty() {
            break;
        }

        let page_len = page.rows.len();
        let page_total = page.total;
        for diff in page.rows {
            if !selection.insert_enabled
                || consume_exclusion(&mut selection.excluded_insert, &diff.signature)
            {
                continue;
            }

            if let Some(source_row) = diff.source_row {
                on_sql(build_insert_sql(
                    target_database,
                    &summary.target_table,
                    &summary.compared_columns,
                    &source_row,
                ))?;
                stats.insert_count += 1;
            } else {
                let key_row = diff.key_row.ok_or_else(|| {
                    AppError::Parse("缓存中的 insert 记录缺少差异键数据".to_string())
                })?;
                insert_key_rows.push(key_row);
                if insert_key_rows.len() >= KEYED_DIFF_BATCH_SIZE {
                    let sql_batch = build_insert_sql_batch(
                        target_database,
                        &summary.target_table,
                        source_session,
                        &summary.source_table,
                        &summary.compared_columns,
                        &summary.key_columns,
                        &insert_key_rows,
                    )
                    .await?;
                    for sql in sql_batch {
                        on_sql(sql)?;
                        stats.insert_count += 1;
                    }
                    insert_key_rows.clear();
                }
            }
        }

        insert_offset = insert_offset.saturating_add(page_len);
        if insert_offset >= page_total {
            break;
        }
    }

    let mut update_offset = 0usize;
    loop {
        let Some(page) = load_cached_diff_page_by_compare_id(
            compare_id,
            action_label,
            &summary.source_table,
            &summary.target_table,
            CompareDetailType::Update,
            update_offset,
            CACHED_DIFF_PAGE_SIZE,
        )?
        else {
            break;
        };

        if page.rows.is_empty() {
            break;
        }

        let page_len = page.rows.len();
        let page_total = page.total;
        for diff in page.rows {
            if !selection.update_enabled
                || consume_exclusion(&mut selection.excluded_update, &diff.signature)
                || summary.key_columns.is_empty()
            {
                continue;
            }

            if let (Some(source_row), Some(target_row)) = (diff.source_row, diff.target_row) {
                let update_columns =
                    diff_columns_between_rows(&source_row, &target_row, &summary.compared_columns)
                        .into_iter()
                        .filter(|column| !key_column_set.contains(column))
                        .collect::<Vec<_>>();

                if let Some(sql) = build_update_sql(
                    target_database,
                    &summary.target_table,
                    &update_columns,
                    &summary.key_columns,
                    &source_row,
                ) {
                    on_sql(sql)?;
                    stats.update_count += 1;
                }
            } else {
                let key_row = diff.key_row.ok_or_else(|| {
                    AppError::Parse("缓存中的 update 记录缺少差异键数据".to_string())
                })?;
                update_key_rows.push(key_row);
                if update_key_rows.len() >= KEYED_DIFF_BATCH_SIZE {
                    let sql_batch = build_update_sql_batch(
                        target_database,
                        &summary.target_table,
                        source_session,
                        target_session,
                        &summary.source_table,
                        &summary.target_table,
                        &summary.compared_columns,
                        &summary.key_columns,
                        &update_key_rows,
                    )
                    .await?;
                    for sql in sql_batch {
                        on_sql(sql)?;
                        stats.update_count += 1;
                    }
                    update_key_rows.clear();
                }
            }
        }

        update_offset = update_offset.saturating_add(page_len);
        if update_offset >= page_total {
            break;
        }
    }

    if !insert_key_rows.is_empty() {
        let sql_batch = build_insert_sql_batch(
            target_database,
            &summary.target_table,
            source_session,
            &summary.source_table,
            &summary.compared_columns,
            &summary.key_columns,
            &insert_key_rows,
        )
        .await?;
        for sql in sql_batch {
            on_sql(sql)?;
            stats.insert_count += 1;
        }
    }

    if !update_key_rows.is_empty() {
        let sql_batch = build_update_sql_batch(
            target_database,
            &summary.target_table,
            source_session,
            target_session,
            &summary.source_table,
            &summary.target_table,
            &summary.compared_columns,
            &summary.key_columns,
            &update_key_rows,
        )
        .await?;
        for sql in sql_batch {
            on_sql(sql)?;
            stats.update_count += 1;
        }
    }

    Ok(())
}

fn generate_sql_with_keys(
    target_database: &str,
    target_table: &str,
    key_columns: &[String],
    compared_columns: &[String],
    source_rows: Vec<RowMap>,
    target_rows: Vec<RowMap>,
    selection: &mut RuntimeTableSelection,
    sql_statements: &mut Vec<String>,
    stats: &mut SqlGenerationStats,
) {
    let key_column_set = key_columns.iter().cloned().collect::<HashSet<_>>();
    let source_map = build_unique_key_map(source_rows, key_columns);
    let target_map = build_unique_key_map(target_rows, key_columns);

    let mut delete_statements = Vec::new();
    let mut update_statements = Vec::new();
    let mut insert_statements = Vec::new();

    for (key_signature, source_row) in &source_map {
        match target_map.get(key_signature) {
            None => {
                if !selection.insert_enabled
                    || consume_exclusion(&mut selection.excluded_insert, key_signature)
                {
                    continue;
                }

                insert_statements.push(build_insert_sql(
                    target_database,
                    target_table,
                    compared_columns,
                    source_row,
                ));
                stats.insert_count += 1;
            }
            Some(target_row) => {
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

                if diff_columns.is_empty() {
                    continue;
                }

                if !selection.update_enabled
                    || consume_exclusion(&mut selection.excluded_update, key_signature)
                {
                    continue;
                }

                let update_columns = diff_columns
                    .into_iter()
                    .filter(|column| !key_column_set.contains(column))
                    .collect::<Vec<_>>();
                if let Some(sql) = build_update_sql(
                    target_database,
                    target_table,
                    &update_columns,
                    key_columns,
                    source_row,
                ) {
                    update_statements.push(sql);
                    stats.update_count += 1;
                }
            }
        }
    }

    for (key_signature, target_row) in &target_map {
        if source_map.contains_key(key_signature) {
            continue;
        }

        if !selection.delete_enabled
            || consume_exclusion(&mut selection.excluded_delete, key_signature)
        {
            continue;
        }

        delete_statements.push(build_delete_by_keys_sql(
            target_database,
            target_table,
            key_columns,
            target_row,
        ));
        stats.delete_count += 1;
    }

    sql_statements.extend(delete_statements);
    sql_statements.extend(update_statements);
    sql_statements.extend(insert_statements);
}

fn generate_sql_with_full_rows(
    target_database: &str,
    target_table: &str,
    compared_columns: &[String],
    source_rows: Vec<RowMap>,
    target_rows: Vec<RowMap>,
    selection: &mut RuntimeTableSelection,
    sql_statements: &mut Vec<String>,
    stats: &mut SqlGenerationStats,
) {
    let mut source_buckets = BTreeMap::<String, Vec<RowMap>>::new();
    let mut target_buckets = BTreeMap::<String, Vec<RowMap>>::new();

    for row in source_rows {
        let signature = row_signature(&row, compared_columns);
        source_buckets.entry(signature).or_default().push(row);
    }

    for row in target_rows {
        let signature = row_signature(&row, compared_columns);
        target_buckets.entry(signature).or_default().push(row);
    }

    let all_signatures = source_buckets
        .keys()
        .chain(target_buckets.keys())
        .cloned()
        .collect::<BTreeSet<_>>();

    let mut delete_statements = Vec::new();
    let mut insert_statements = Vec::new();

    for signature in all_signatures {
        let source_group = source_buckets.get(&signature).cloned().unwrap_or_default();
        let target_group = target_buckets.get(&signature).cloned().unwrap_or_default();

        if source_group.len() > target_group.len() {
            let diff = source_group.len() - target_group.len();
            for row in source_group.into_iter().take(diff) {
                if !selection.insert_enabled
                    || consume_exclusion(&mut selection.excluded_insert, &signature)
                {
                    continue;
                }
                insert_statements.push(build_insert_sql(
                    target_database,
                    target_table,
                    compared_columns,
                    &row,
                ));
                stats.insert_count += 1;
            }
        } else if target_group.len() > source_group.len() {
            let diff = target_group.len() - source_group.len();
            for row in target_group.into_iter().take(diff) {
                if !selection.delete_enabled
                    || consume_exclusion(&mut selection.excluded_delete, &signature)
                {
                    continue;
                }
                delete_statements.push(build_delete_by_row_sql(
                    target_database,
                    target_table,
                    compared_columns,
                    &row,
                ));
                stats.delete_count += 1;
            }
        }
    }

    sql_statements.extend(delete_statements);
    sql_statements.extend(insert_statements);
}

fn write_sql_with_keys(
    target_database: &str,
    target_table: &str,
    key_columns: &[String],
    compared_columns: &[String],
    source_rows: Vec<RowMap>,
    target_rows: Vec<RowMap>,
    selection: &mut RuntimeTableSelection,
    writer: &mut SqlFileWriter,
    stats: &mut SqlGenerationStats,
) -> Result<(), AppError> {
    let key_column_set = key_columns.iter().cloned().collect::<HashSet<_>>();
    let source_map = build_unique_key_map(source_rows, key_columns);
    let target_map = build_unique_key_map(target_rows, key_columns);

    for (key_signature, source_row) in &source_map {
        match target_map.get(key_signature) {
            None => {
                if !selection.insert_enabled
                    || consume_exclusion(&mut selection.excluded_insert, key_signature)
                {
                    continue;
                }

                writer.write_statement(&build_insert_sql(
                    target_database,
                    target_table,
                    compared_columns,
                    source_row,
                ))?;
                stats.insert_count += 1;
            }
            Some(target_row) => {
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

                if diff_columns.is_empty() {
                    continue;
                }

                if !selection.update_enabled
                    || consume_exclusion(&mut selection.excluded_update, key_signature)
                {
                    continue;
                }

                let update_columns = diff_columns
                    .into_iter()
                    .filter(|column| !key_column_set.contains(column))
                    .collect::<Vec<_>>();

                if let Some(sql) = build_update_sql(
                    target_database,
                    target_table,
                    &update_columns,
                    key_columns,
                    source_row,
                ) {
                    writer.write_statement(&sql)?;
                    stats.update_count += 1;
                }
            }
        }
    }

    for (key_signature, target_row) in &target_map {
        if source_map.contains_key(key_signature) {
            continue;
        }

        if !selection.delete_enabled
            || consume_exclusion(&mut selection.excluded_delete, key_signature)
        {
            continue;
        }

        writer.write_statement(&build_delete_by_keys_sql(
            target_database,
            target_table,
            key_columns,
            target_row,
        ))?;
        stats.delete_count += 1;
    }

    Ok(())
}

fn write_sql_with_full_rows(
    target_database: &str,
    target_table: &str,
    compared_columns: &[String],
    source_rows: Vec<RowMap>,
    target_rows: Vec<RowMap>,
    selection: &mut RuntimeTableSelection,
    writer: &mut SqlFileWriter,
    stats: &mut SqlGenerationStats,
) -> Result<(), AppError> {
    let mut source_buckets = BTreeMap::<String, Vec<RowMap>>::new();
    let mut target_buckets = BTreeMap::<String, Vec<RowMap>>::new();

    for row in source_rows {
        let signature = row_signature(&row, compared_columns);
        source_buckets.entry(signature).or_default().push(row);
    }

    for row in target_rows {
        let signature = row_signature(&row, compared_columns);
        target_buckets.entry(signature).or_default().push(row);
    }

    let all_signatures = source_buckets
        .keys()
        .chain(target_buckets.keys())
        .cloned()
        .collect::<BTreeSet<_>>();

    for signature in all_signatures {
        let source_group = source_buckets.get(&signature).cloned().unwrap_or_default();
        let target_group = target_buckets.get(&signature).cloned().unwrap_or_default();

        if source_group.len() > target_group.len() {
            let diff = source_group.len() - target_group.len();
            for row in source_group.into_iter().take(diff) {
                if !selection.insert_enabled
                    || consume_exclusion(&mut selection.excluded_insert, &signature)
                {
                    continue;
                }

                writer.write_statement(&build_insert_sql(
                    target_database,
                    target_table,
                    compared_columns,
                    &row,
                ))?;
                stats.insert_count += 1;
            }
        } else if target_group.len() > source_group.len() {
            let diff = target_group.len() - source_group.len();
            for row in target_group.into_iter().take(diff) {
                if !selection.delete_enabled
                    || consume_exclusion(&mut selection.excluded_delete, &signature)
                {
                    continue;
                }

                writer.write_statement(&build_delete_by_row_sql(
                    target_database,
                    target_table,
                    compared_columns,
                    &row,
                ))?;
                stats.delete_count += 1;
            }
        }
    }

    Ok(())
}

fn collect_duplicate_keys(rows: &[RowMap], key_columns: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut duplicates = Vec::new();

    for row in rows {
        let key = row_signature(row, key_columns);
        if !seen.insert(key.clone()) {
            duplicates.push(key);
        }
    }

    duplicates.sort();
    duplicates.dedup();
    duplicates
}

fn empty_detail_page(request: &CompareDetailPageRequest) -> CompareDetailPageResponse {
    CompareDetailPageResponse {
        source_table: request.source_table.clone(),
        target_table: request.target_table.clone(),
        detail_type: request.detail_type,
        total: 0,
        offset: request.offset,
        limit: request.limit,
        has_more: false,
        row_columns: Vec::new(),
        row_items: Vec::new(),
        update_items: Vec::new(),
    }
}

fn is_lazy_keyed_compare_mode(compare_mode: &str) -> bool {
    matches!(compare_mode, "keyed_hash" | "keyed_chunk_hash")
}

async fn load_keyed_detail_page_from_cache(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    summary: &TableCompareResult,
    request: &CompareDetailPageRequest,
    cached_page: CachedDiffPage,
) -> Result<CompareDetailPageResponse, AppError> {
    let ordered_signatures = cached_page
        .rows
        .iter()
        .map(|row| row.signature.clone())
        .collect::<Vec<_>>();
    let mut row_items_by_signature = BTreeMap::new();
    let mut update_items_by_signature = BTreeMap::new();
    let mut pending_insert_keys = Vec::new();
    let mut pending_delete_keys = Vec::new();
    let mut pending_update_keys = Vec::new();

    for diff in cached_page.rows {
        match request.detail_type {
            CompareDetailType::Insert => {
                if let Some(source_row) = diff.source_row {
                    row_items_by_signature.insert(
                        diff.signature.clone(),
                        RowTableItem {
                            signature: diff.signature,
                            values: row_to_json_values(&source_row, &summary.compared_columns),
                        },
                    );
                } else {
                    pending_insert_keys.push(diff.key_row.ok_or_else(|| {
                        AppError::Parse("缓存中的 insert 记录缺少差异键数据".to_string())
                    })?);
                }
            }
            CompareDetailType::Delete => {
                if let Some(target_row) = diff.target_row {
                    row_items_by_signature.insert(
                        diff.signature.clone(),
                        RowTableItem {
                            signature: diff.signature,
                            values: row_to_json_values(&target_row, &summary.compared_columns),
                        },
                    );
                } else {
                    pending_delete_keys.push(diff.key_row.ok_or_else(|| {
                        AppError::Parse("缓存中的 delete 记录缺少差异键数据".to_string())
                    })?);
                }
            }
            CompareDetailType::Update => {
                if let (Some(source_row), Some(target_row)) = (diff.source_row, diff.target_row) {
                    update_items_by_signature.insert(
                        diff.signature.clone(),
                        UpdateSample {
                            signature: diff.signature,
                            key: key_to_json(&source_row, &summary.key_columns),
                            source_row: row_to_json(&source_row),
                            target_row: row_to_json(&target_row),
                            diff_columns: diff_columns_between_rows(
                                &source_row,
                                &target_row,
                                &summary.compared_columns,
                            ),
                        },
                    );
                } else {
                    pending_update_keys.push(diff.key_row.ok_or_else(|| {
                        AppError::Parse("缓存中的 update 记录缺少差异键数据".to_string())
                    })?);
                }
            }
        }
    }

    if !pending_insert_keys.is_empty() {
        for item in load_row_items_by_keys(
            source_session,
            &summary.source_table,
            &summary.compared_columns,
            &summary.key_columns,
            &pending_insert_keys,
        )
        .await?
        {
            row_items_by_signature.insert(item.signature.clone(), item);
        }
    }

    if !pending_delete_keys.is_empty() {
        for item in load_row_items_by_keys(
            target_session,
            &summary.target_table,
            &summary.compared_columns,
            &summary.key_columns,
            &pending_delete_keys,
        )
        .await?
        {
            row_items_by_signature.insert(item.signature.clone(), item);
        }
    }

    if !pending_update_keys.is_empty() {
        for item in load_update_samples_by_keys(
            source_session,
            target_session,
            &summary.source_table,
            &summary.target_table,
            &summary.compared_columns,
            &summary.key_columns,
            &pending_update_keys,
        )
        .await?
        {
            update_items_by_signature.insert(item.signature.clone(), item);
        }
    }

    let row_items = ordered_signatures
        .iter()
        .filter_map(|signature| row_items_by_signature.remove(signature))
        .collect::<Vec<_>>();
    let update_items = ordered_signatures
        .iter()
        .filter_map(|signature| update_items_by_signature.remove(signature))
        .collect::<Vec<_>>();

    Ok(CompareDetailPageResponse {
        source_table: request.source_table.clone(),
        target_table: request.target_table.clone(),
        detail_type: request.detail_type,
        total: cached_page.total,
        offset: request.offset,
        limit: request.limit,
        has_more: request.offset.saturating_add(request.limit) < cached_page.total,
        row_columns: summary.compared_columns.clone(),
        row_items,
        update_items,
    })
}

async fn load_keyed_detail_page(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    compared_columns: &[String],
    source_hash_columns: &[TableColumnDefinition],
    target_hash_columns: &[TableColumnDefinition],
    key_columns: &[String],
    numeric_chunk_plan: Option<&NumericChunkPlan>,
    detail_type: CompareDetailType,
    expected_total: usize,
    offset: usize,
    limit: usize,
) -> Result<CompareDetailPageResponse, AppError> {
    let end = offset.saturating_add(limit);
    let mut matched = 0usize;
    let mut page_key_rows = Vec::new();
    let effective_numeric_chunk_plan = resolve_numeric_chunk_plan(
        source_session,
        target_session,
        source_table,
        target_table,
        numeric_chunk_plan,
    )
    .await?;
    scan_keyed_table_hash_differences(
        source_session,
        target_session,
        source_table,
        target_table,
        source_hash_columns,
        target_hash_columns,
        key_columns,
        effective_numeric_chunk_plan.as_ref(),
        |event| {
            if matched >= end {
                return Ok(());
            }

            match event {
                KeyedHashDiffEvent::Insert { source }
                    if detail_type == CompareDetailType::Insert =>
                {
                    if matched >= offset && matched < end {
                        page_key_rows.push(source.key_row);
                    }
                    matched += 1;
                }
                KeyedHashDiffEvent::Update { source, .. }
                    if detail_type == CompareDetailType::Update =>
                {
                    if matched >= offset && matched < end {
                        page_key_rows.push(source.key_row);
                    }
                    matched += 1;
                }
                KeyedHashDiffEvent::Delete { target }
                    if detail_type == CompareDetailType::Delete =>
                {
                    if matched >= offset && matched < end {
                        page_key_rows.push(target.key_row);
                    }
                    matched += 1;
                }
                _ => {}
            }

            Ok(())
        },
    )
    .await?;

    let (row_items, update_items) = match detail_type {
        CompareDetailType::Insert => (
            load_row_items_by_keys(
                source_session,
                source_table,
                compared_columns,
                key_columns,
                &page_key_rows,
            )
            .await?,
            Vec::new(),
        ),
        CompareDetailType::Delete => (
            load_row_items_by_keys(
                target_session,
                target_table,
                compared_columns,
                key_columns,
                &page_key_rows,
            )
            .await?,
            Vec::new(),
        ),
        CompareDetailType::Update => (
            Vec::new(),
            load_update_samples_by_keys(
                source_session,
                target_session,
                source_table,
                target_table,
                compared_columns,
                key_columns,
                &page_key_rows,
            )
            .await?,
        ),
    };

    Ok(CompareDetailPageResponse {
        source_table: source_table.to_string(),
        target_table: target_table.to_string(),
        detail_type,
        total: expected_total,
        offset,
        limit,
        has_more: offset.saturating_add(limit) < expected_total,
        row_columns: compared_columns.to_vec(),
        row_items,
        update_items,
    })
}

async fn load_full_row_detail_page(
    source_session: &MySqlSession,
    target_session: &MySqlSession,
    source_table: &str,
    target_table: &str,
    compared_columns: &[String],
    detail_type: CompareDetailType,
    expected_total: usize,
    offset: usize,
    limit: usize,
) -> Result<CompareDetailPageResponse, AppError> {
    if detail_type == CompareDetailType::Update {
        return Ok(CompareDetailPageResponse {
            source_table: source_table.to_string(),
            target_table: target_table.to_string(),
            detail_type,
            total: 0,
            offset,
            limit,
            has_more: false,
            row_columns: Vec::new(),
            row_items: Vec::new(),
            update_items: Vec::new(),
        });
    }

    let (source_rows, target_rows) = fetch_rows_parallel(
        source_session,
        target_session,
        source_table,
        target_table,
        compared_columns,
    )
    .await?;

    let mut source_buckets = BTreeMap::<String, Vec<RowMap>>::new();
    let mut target_buckets = BTreeMap::<String, Vec<RowMap>>::new();

    for row in source_rows {
        let signature = row_signature(&row, compared_columns);
        source_buckets.entry(signature).or_default().push(row);
    }

    for row in target_rows {
        let signature = row_signature(&row, compared_columns);
        target_buckets.entry(signature).or_default().push(row);
    }

    let all_signatures = source_buckets
        .keys()
        .chain(target_buckets.keys())
        .cloned()
        .collect::<BTreeSet<_>>();

    let end = offset.saturating_add(limit);
    let mut matched = 0usize;
    let mut row_items = Vec::new();

    for signature in all_signatures {
        if matched >= end {
            break;
        }

        let source_group = source_buckets.get(&signature).cloned().unwrap_or_default();
        let target_group = target_buckets.get(&signature).cloned().unwrap_or_default();

        if detail_type == CompareDetailType::Insert && source_group.len() > target_group.len() {
            let diff = source_group.len() - target_group.len();
            for row in source_group.into_iter().take(diff) {
                if matched >= offset && matched < end {
                    row_items.push(RowTableItem {
                        signature: signature.clone(),
                        values: row_to_json_values(&row, compared_columns),
                    });
                }
                matched += 1;
                if matched >= end {
                    break;
                }
            }
        } else if detail_type == CompareDetailType::Delete
            && target_group.len() > source_group.len()
        {
            let diff = target_group.len() - source_group.len();
            for row in target_group.into_iter().take(diff) {
                if matched >= offset && matched < end {
                    row_items.push(RowTableItem {
                        signature: signature.clone(),
                        values: row_to_json_values(&row, compared_columns),
                    });
                }
                matched += 1;
                if matched >= end {
                    break;
                }
            }
        }
    }

    Ok(CompareDetailPageResponse {
        source_table: source_table.to_string(),
        target_table: target_table.to_string(),
        detail_type,
        total: expected_total,
        offset,
        limit,
        has_more: offset.saturating_add(limit) < expected_total,
        row_columns: compared_columns.to_vec(),
        row_items,
        update_items: Vec::new(),
    })
}

async fn next_row_map(
    result: &mut QueryResult<'_, 'static, TextProtocol>,
) -> Result<Option<RowMap>, AppError> {
    result
        .next()
        .await
        .map_err(AppError::from_mysql)
        .map(|row| row.map(row_to_map))
}

async fn next_keyed_hash_row(
    result: &mut QueryResult<'_, 'static, TextProtocol>,
    key_columns: &[String],
) -> Result<Option<KeyedHashRow>, AppError> {
    let Some(mut row) = next_row_map(result).await? else {
        return Ok(None);
    };

    let row_hash_value = row
        .remove(ROW_HASH_ALIAS)
        .ok_or_else(|| AppError::Parse(format!("结果集中缺少 {} 字段", ROW_HASH_ALIAS)))?;
    let row_hash = match row_hash_value {
        Value::Bytes(bytes) => String::from_utf8(bytes)
            .map_err(|error| AppError::Parse(format!("行哈希不是有效 UTF-8: {error}")))?,
        other => return Err(AppError::Parse(format!("行哈希字段类型异常: {:?}", other))),
    };
    let key_signature = row_signature(&row, key_columns);

    Ok(Some(KeyedHashRow {
        key_row: row,
        key_signature,
        row_hash,
    }))
}

fn compare_row_keys(left: &RowMap, right: &RowMap, key_columns: &[String]) -> Ordering {
    for column in key_columns {
        let left_value = left.get(column).unwrap_or(&Value::NULL);
        let right_value = right.get(column).unwrap_or(&Value::NULL);
        let order = compare_mysql_value(left_value, right_value);
        if order != Ordering::Equal {
            return order;
        }
    }

    Ordering::Equal
}

fn compare_mysql_value(left: &Value, right: &Value) -> Ordering {
    match (left, right) {
        (Value::NULL, Value::NULL) => Ordering::Equal,
        (Value::NULL, _) => Ordering::Less,
        (_, Value::NULL) => Ordering::Greater,
        (Value::Bytes(left), Value::Bytes(right)) => left.cmp(right),
        (Value::Int(left), Value::Int(right)) => left.cmp(right),
        (Value::UInt(left), Value::UInt(right)) => left.cmp(right),
        (Value::Float(left), Value::Float(right)) => {
            left.partial_cmp(right).unwrap_or(Ordering::Equal)
        }
        (Value::Double(left), Value::Double(right)) => {
            left.partial_cmp(right).unwrap_or(Ordering::Equal)
        }
        (
            Value::Date(ly, lm, ld, lh, lmin, ls, lmicros),
            Value::Date(ry, rm, rd, rh, rmin, rs, rmicros),
        ) => (ly, lm, ld, lh, lmin, ls, lmicros).cmp(&(ry, rm, rd, rh, rmin, rs, rmicros)),
        (
            Value::Time(ln, ld, lh, lmin, ls, lmicros),
            Value::Time(rn, rd, rh, rmin, rs, rmicros),
        ) => (ln, ld, lh, lmin, ls, lmicros).cmp(&(rn, rd, rh, rmin, rs, rmicros)),
        _ => row_signature(
            &RowMap::from([("value".to_string(), left.clone())]),
            &["value".to_string()],
        )
        .cmp(&row_signature(
            &RowMap::from([("value".to_string(), right.clone())]),
            &["value".to_string()],
        )),
    }
}

fn default_sql_file_name() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("mysql_sync_{ts}.sql")
}

fn sanitize_file_name(input: &str) -> String {
    let mut sanitized = input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    if sanitized.is_empty() {
        sanitized = default_sql_file_name();
    }

    sanitized
}

#[cfg(test)]
mod tests {
    use mysql_async::Value;

    use super::{chunk_plan_rejection_reason, parse_u64_field, NumericChunkPlan};

    #[test]
    fn parse_u64_field_accepts_text_protocol_bytes() {
        let value = parse_u64_field(Value::Bytes(b"0".to_vec()), "分块行数")
            .expect("bytes count should parse");
        assert_eq!(value, 0);

        let value = parse_u64_field(Value::Bytes(b"42".to_vec()), "分块行数")
            .expect("bytes count should parse");
        assert_eq!(value, 42);
    }

    #[test]
    fn chunk_plan_rejection_reason_rejects_sparse_huge_ranges() {
        let plan = NumericChunkPlan {
            key_column: "id".to_string(),
            unsigned: true,
            chunk_size: 1000,
        };

        assert_eq!(
            chunk_plan_rejection_reason(450_793_591_322_117, Some(9_716), &plan),
            Some("chunk_total_exceeds_limit")
        );
        assert_eq!(
            chunk_plan_rejection_reason(9_272, Some(9_716), &plan),
            Some("chunk_density_too_sparse")
        );
        assert_eq!(chunk_plan_rejection_reason(10, Some(9_716), &plan), None);
    }
}

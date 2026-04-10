use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    fs::File,
    io::{BufWriter, Write},
    sync::LazyLock,
    time::Instant,
};

use futures::{stream, StreamExt, TryStreamExt};
use mysql_async::prelude::Queryable;
use regex::Regex;
use tracing::info;

use crate::{
    compare_core::errors::AppError,
    compare_core::models::api::{
        StructureCompareDetailRequest, StructureCompareDetailResponse, StructureCompareOptions,
        StructureCompareRequest, StructureCompareResponse, StructureCompareSummary,
        StructureDetailCategory, StructureExportSqlFileRequest, StructureExportSqlFileResponse,
        StructureTableItem,
    },
    compare_core::models::desktop::{CompareHistoryPerformance, CompareHistoryPerformanceStage},
    compare_core::services::mysql_service::MySqlSession,
    compare_core::utils::sql_builder::quote_identifier,
};

#[derive(Clone, Default)]
pub struct StructureCompareService;

const STRUCTURE_COMPARE_CONCURRENCY: usize = 8;
const STRUCTURE_COMPARE_CONCURRENCY_MAX: usize = 16;

struct StructureSqlWriter {
    writer: BufWriter<File>,
    has_statements: bool,
}

#[derive(Clone)]
struct ColumnFragment {
    name: String,
    sql: String,
    normalized_sql: String,
}

#[derive(Clone)]
struct ConstraintFragment {
    sql: String,
    kind: ConstraintKind,
}

#[derive(Clone, Copy)]
enum ConstraintKind {
    ForeignKey,
    Check,
    Other,
}

#[derive(Default)]
struct TableOptions {
    engine: Option<String>,
    default_charset: Option<String>,
    collation: Option<String>,
    row_format: Option<String>,
    comment: Option<String>,
}

struct ParsedCreateTable {
    columns: Vec<ColumnFragment>,
    primary_key: Option<String>,
    indexes: BTreeMap<String, String>,
    constraints: BTreeMap<String, ConstraintFragment>,
    options: TableOptions,
    line_map: ParsedCreateTableLineMap,
}

struct AlterPlan {
    statements: Vec<String>,
    warnings: Vec<String>,
}

struct StructureExportBlock {
    comment: String,
    warnings: Vec<String>,
    statements: Vec<String>,
    empty_comment: Option<String>,
}

#[derive(Default)]
struct StructureLineDiff {
    source_changed_lines: BTreeSet<usize>,
    target_changed_lines: BTreeSet<usize>,
}

#[derive(Default)]
struct ParsedCreateTableLineMap {
    column_lines: BTreeMap<String, usize>,
    primary_key_line: Option<usize>,
    index_lines: BTreeMap<String, usize>,
    constraint_lines: BTreeMap<String, usize>,
    table_options_line: Option<usize>,
}

struct ColumnNormalizationContext {
    default_charset_regex: Option<Regex>,
    default_collation_regex: Option<Regex>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct TableStructureSignature {
    options: Vec<String>,
    columns: Vec<String>,
    indexes: Vec<String>,
    foreign_keys: Vec<String>,
    checks: Vec<String>,
}

#[derive(Debug)]
struct TableOptionRow {
    table_name: String,
    engine: Option<String>,
    table_collation: Option<String>,
    row_format: Option<String>,
    table_comment: Option<String>,
}

#[derive(Debug)]
struct ColumnMetadataRow {
    table_name: String,
    column_name: String,
    ordinal_position: u64,
    column_type: String,
    is_nullable: String,
    column_default: Option<String>,
    extra: String,
    character_set_name: Option<String>,
    collation_name: Option<String>,
    column_comment: String,
    generation_expression: Option<String>,
}

#[derive(Debug)]
struct IndexMetadataRow {
    table_name: String,
    index_name: String,
    non_unique: u8,
    seq_in_index: u64,
    column_name: String,
    collation: Option<String>,
    sub_part: Option<u64>,
    index_type: String,
}

#[derive(Debug)]
struct ForeignKeyMetadataRow {
    table_name: String,
    constraint_name: String,
    ordinal_position: u64,
    column_name: String,
    referenced_table_name: Option<String>,
    referenced_column_name: Option<String>,
    update_rule: Option<String>,
    delete_rule: Option<String>,
}

#[derive(Debug)]
struct CheckMetadataRow {
    table_name: String,
    constraint_name: String,
    check_clause: String,
}

struct MetadataLoadResult<T> {
    rows: Vec<T>,
    elapsed_ms: u64,
    note: Option<String>,
}

static INDEX_NAME_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)^(?:UNIQUE\s+)?(?:FULLTEXT\s+|SPATIAL\s+)?(?:KEY|INDEX)\s+`([^`]+)`"#)
        .expect("valid regex")
});
static CONSTRAINT_NAME_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)^CONSTRAINT\s+`([^`]+)`"#).expect("valid regex"));
static ENGINE_OPTION_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)\bENGINE\s*=\s*([^\s]+)"#).expect("valid regex"));
static DEFAULT_CHARSET_OPTION_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)\b(?:DEFAULT\s+)?CHARSET\s*=\s*([^\s]+)"#).expect("valid regex")
});
static COLLATE_OPTION_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)\bCOLLATE\s*=\s*([^\s]+)"#).expect("valid regex"));
static ROW_FORMAT_OPTION_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)\bROW_FORMAT\s*=\s*([^\s]+)"#).expect("valid regex"));
static COMMENT_OPTION_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)\bCOMMENT\s*=\s*'((?:''|[^'])*)'"#).expect("valid regex"));
static DEFAULT_NULL_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\s+DEFAULT\s+NULL\b").expect("valid regex"));
static INTEGER_DISPLAY_WIDTH_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(tinyint|smallint|mediumint|int|integer|bigint)\s*\(\s*\d+\s*\)")
        .expect("valid regex")
});
static USING_BTREE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\s+USING\s+BTREE\b").expect("valid regex"));
static WHITESPACE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s+").expect("valid regex"));

impl ColumnNormalizationContext {
    fn new(table_options: &TableOptions) -> Self {
        Self {
            default_charset_regex: table_options
                .default_charset
                .as_ref()
                .map(|default_charset| {
                    Regex::new(&format!(
                        r"(?i)\s+CHARACTER\s+SET\s+{}",
                        regex::escape(default_charset)
                    ))
                    .expect("valid regex")
                }),
            default_collation_regex: table_options.collation.as_ref().map(|default_collation| {
                Regex::new(&format!(
                    r"(?i)\s+COLLATE\s+{}",
                    regex::escape(default_collation)
                ))
                .expect("valid regex")
            }),
        }
    }
}

impl StructureSqlWriter {
    fn create(file_path: &str) -> Result<Self, AppError> {
        let file = File::create(file_path).map_err(|error| AppError::Io(error.to_string()))?;
        Ok(Self {
            writer: BufWriter::new(file),
            has_statements: false,
        })
    }

    fn write_comment(&mut self, comment: &str) -> Result<(), AppError> {
        self.writer
            .write_all(format!("-- {}\n", comment).as_bytes())
            .map_err(|error| AppError::Io(error.to_string()))
    }

    fn write_statement(&mut self, sql: &str) -> Result<(), AppError> {
        if !self.has_statements {
            self.writer
                .write_all(b"SET FOREIGN_KEY_CHECKS = 0;\n")
                .map_err(|error| AppError::Io(error.to_string()))?;
            self.has_statements = true;
        }

        self.writer
            .write_all(sql.as_bytes())
            .and_then(|_| self.writer.write_all(b"\n"))
            .map_err(|error| AppError::Io(error.to_string()))
    }

    fn write_blank_line(&mut self) -> Result<(), AppError> {
        self.writer
            .write_all(b"\n")
            .map_err(|error| AppError::Io(error.to_string()))
    }

    fn finish(mut self) -> Result<(), AppError> {
        if self.has_statements {
            self.writer
                .write_all(b"SET FOREIGN_KEY_CHECKS = 1;\n")
                .map_err(|error| AppError::Io(error.to_string()))?;
        } else {
            self.writer
                .write_all("-- 未检测到结构差异，无需同步。\n".as_bytes())
                .map_err(|error| AppError::Io(error.to_string()))?;
        }

        self.writer
            .flush()
            .map_err(|error| AppError::Io(error.to_string()))
    }
}

impl StructureCompareService {
    pub fn new() -> Self {
        Self
    }

    pub async fn compare(
        &self,
        request: &StructureCompareRequest,
    ) -> Result<StructureCompareResponse, AppError> {
        request.validate().map_err(AppError::Validation)?;
        let compare_started_at = Instant::now();

        let source_session = MySqlSession::new(&request.source);
        let target_session = MySqlSession::new(&request.target);

        let ((source_signatures, mut source_stages), (target_signatures, mut target_stages)) = tokio::try_join!(
            load_lightweight_structure_signatures(source_session.clone(), "source"),
            load_lightweight_structure_signatures(target_session.clone(), "target")
        )?;

        let mut performance_stages = Vec::new();
        performance_stages.append(&mut source_stages);
        performance_stages.append(&mut target_stages);

        let classify_started_at = Instant::now();
        let source_tables = source_signatures.keys().cloned().collect::<Vec<_>>();
        let target_tables = target_signatures.keys().cloned().collect::<Vec<_>>();
        let source_set = source_tables.iter().cloned().collect::<HashSet<_>>();
        let target_set = target_tables.iter().cloned().collect::<HashSet<_>>();

        let added_table_names = source_tables
            .iter()
            .filter(|table_name| !target_set.contains(*table_name))
            .cloned()
            .collect::<Vec<_>>();
        let deleted_table_names = target_tables
            .iter()
            .filter(|table_name| !source_set.contains(*table_name))
            .cloned()
            .collect::<Vec<_>>();
        let modified_table_names = source_tables
            .iter()
            .filter(|table_name| target_set.contains(*table_name))
            .filter(|table_name| {
                source_signatures.get(*table_name) != target_signatures.get(*table_name)
            })
            .cloned()
            .collect::<Vec<_>>();
        performance_stages.push(build_performance_stage(
            "classify_tables",
            "归类新增/修改/删除表",
            elapsed_millis(classify_started_at),
            Some(source_tables.len().max(target_tables.len())),
            Some(format!(
                "轻量签名判定：新增 {} 张，修改候选 {} 张，删除 {} 张",
                added_table_names.len(),
                modified_table_names.len(),
                deleted_table_names.len()
            )),
        ));

        let detail_concurrency = resolve_structure_task_concurrency(
            &request.options,
            added_table_names.len() + modified_table_names.len() + deleted_table_names.len(),
        );
        let target_database = request.target.database.clone();
        let mut added_tables = added_table_names
            .into_iter()
            .map(build_shallow_structure_item)
            .collect::<Vec<_>>();
        let mut modified_tables = modified_table_names
            .into_iter()
            .map(build_shallow_structure_item)
            .collect::<Vec<_>>();
        let mut deleted_tables = deleted_table_names
            .into_iter()
            .map(build_shallow_structure_item)
            .collect::<Vec<_>>();

        performance_stages.push(build_performance_stage(
            "detail_strategy",
            "结构明细加载策略",
            0,
            Some(added_tables.len() + modified_tables.len() + deleted_tables.len()),
            Some(if request.options.preload_details {
                format!("预加载详情开启，并发度 {}", detail_concurrency)
            } else {
                format!(
                    "首屏仅返回分类结果，详情按需加载，建议并发度 {}",
                    detail_concurrency
                )
            }),
        ));

        if request.options.preload_details {
            let preload_started_at = Instant::now();
            added_tables = stream::iter(added_tables.into_iter().map(|item| {
                let source_session = source_session.clone();
                let target_database = target_database.clone();
                async move {
                    load_added_table_detail(source_session, target_database, item.table_name).await
                }
            }))
            .buffer_unordered(detail_concurrency)
            .try_collect()
            .await?;

            modified_tables = stream::iter(modified_tables.into_iter().map(|item| {
                let source_session = source_session.clone();
                let target_session = target_session.clone();
                let target_database = target_database.clone();
                async move {
                    load_modified_table_detail(
                        source_session,
                        target_session,
                        target_database,
                        item.table_name,
                    )
                    .await
                }
            }))
            .buffer_unordered(detail_concurrency)
            .try_collect()
            .await?;

            deleted_tables = deleted_tables
                .into_iter()
                .map(|item| build_deleted_table_item(&target_database, item.table_name))
                .collect();

            performance_stages.push(build_performance_stage(
                "preload_detail_payloads",
                "预加载结构详情",
                elapsed_millis(preload_started_at),
                Some(added_tables.len() + modified_tables.len() + deleted_tables.len()),
                Some(format!("并发度 {}", detail_concurrency)),
            ));
        }

        let sort_started_at = Instant::now();
        added_tables.sort_by(|left, right| left.table_name.cmp(&right.table_name));
        modified_tables.sort_by(|left, right| left.table_name.cmp(&right.table_name));
        deleted_tables.sort_by(|left, right| left.table_name.cmp(&right.table_name));
        performance_stages.push(build_performance_stage(
            "sort_results",
            "排序结构对比结果",
            elapsed_millis(sort_started_at),
            Some(added_tables.len() + modified_tables.len() + deleted_tables.len()),
            None,
        ));

        let performance = CompareHistoryPerformance {
            total_elapsed_ms: elapsed_millis(compare_started_at),
            stages: performance_stages,
            max_parallelism: Some(if request.options.preload_details {
                detail_concurrency.max(10)
            } else {
                10
            }),
        };

        info!(
            source_db = %request.source.database,
            target_db = %request.target.database,
            source_tables = source_tables.len(),
            target_tables = target_tables.len(),
            added_tables = added_tables.len(),
            modified_tables = modified_tables.len(),
            deleted_tables = deleted_tables.len(),
            elapsed_ms = performance.total_elapsed_ms,
            "数据库结构对比完成"
        );

        Ok(StructureCompareResponse {
            summary: StructureCompareSummary {
                source_table_count: source_tables.len(),
                target_table_count: target_tables.len(),
                added_table_count: added_tables.len(),
                modified_table_count: modified_tables.len(),
                deleted_table_count: deleted_tables.len(),
            },
            added_tables,
            modified_tables,
            deleted_tables,
            performance,
        })
    }

    pub async fn load_detail(
        &self,
        request: &StructureCompareDetailRequest,
    ) -> Result<StructureCompareDetailResponse, AppError> {
        request.validate().map_err(AppError::Validation)?;
        let started_at = Instant::now();
        let source_session = MySqlSession::new(&request.compare_request.source);
        let target_session = MySqlSession::new(&request.compare_request.target);
        let target_database = request.compare_request.target.database.clone();

        let (detail, mut stages) = match request.category {
            StructureDetailCategory::Added => {
                load_added_table_detail_with_performance(
                    source_session,
                    target_database,
                    request.table_name.clone(),
                )
                .await?
            }
            StructureDetailCategory::Modified => {
                load_modified_table_detail_with_performance(
                    source_session,
                    target_session,
                    target_database,
                    request.table_name.clone(),
                )
                .await?
            }
            StructureDetailCategory::Deleted => (
                build_deleted_table_item(&target_database, request.table_name.clone()),
                vec![build_performance_stage(
                    "build_deleted_preview",
                    "生成删除表预览",
                    0,
                    Some(1),
                    None,
                )],
            ),
        };

        let performance = CompareHistoryPerformance {
            total_elapsed_ms: elapsed_millis(started_at),
            stages: {
                stages.push(build_performance_stage(
                    "finish_detail_response",
                    "组装详情响应",
                    0,
                    Some(1),
                    None,
                ));
                stages
            },
            max_parallelism: None,
        };

        Ok(StructureCompareDetailResponse {
            category: request.category,
            table_name: request.table_name.clone(),
            detail,
            performance,
        })
    }

    pub async fn export_sql_file(
        &self,
        request: &StructureExportSqlFileRequest,
    ) -> Result<StructureExportSqlFileResponse, AppError> {
        request.validate().map_err(AppError::Validation)?;

        let source_session = MySqlSession::new(&request.compare_request.source);
        let target_session = MySqlSession::new(&request.compare_request.target);
        let mut writer = StructureSqlWriter::create(&request.file_path)?;

        let target_database = request.compare_request.target.database.clone();
        let detail_concurrency = resolve_structure_task_concurrency(
            &request.compare_request.options,
            request.selection.added_tables.len()
                + request.selection.modified_tables.len()
                + request.selection.deleted_tables.len(),
        );

        let added_blocks: Vec<StructureExportBlock> = stream::iter(
            request
                .selection
                .added_tables
                .iter()
                .cloned()
                .map(|table_name| {
                    let source_session = source_session.clone();
                    let target_database = target_database.clone();
                    async move {
                        prepare_added_export_block(source_session, target_database, table_name)
                            .await
                    }
                }),
        )
        .buffer_unordered(detail_concurrency)
        .try_collect()
        .await?;

        let modified_blocks: Vec<StructureExportBlock> = stream::iter(
            request
                .selection
                .modified_tables
                .iter()
                .cloned()
                .map(|table_name| {
                    let source_session = source_session.clone();
                    let target_session = target_session.clone();
                    let target_database = target_database.clone();
                    async move {
                        prepare_modified_export_block(
                            source_session,
                            target_session,
                            target_database,
                            table_name,
                        )
                        .await
                    }
                }),
        )
        .buffer_unordered(detail_concurrency)
        .try_collect()
        .await?;

        let deleted_blocks: Vec<StructureExportBlock> = stream::iter(
            request
                .selection
                .deleted_tables
                .iter()
                .cloned()
                .map(|table_name| {
                    let target_session = target_session.clone();
                    let target_database = target_database.clone();
                    async move {
                        prepare_deleted_export_block(target_session, target_database, table_name)
                            .await
                    }
                }),
        )
        .buffer_unordered(detail_concurrency)
        .try_collect()
        .await?;

        for block in added_blocks
            .into_iter()
            .chain(modified_blocks.into_iter())
            .chain(deleted_blocks.into_iter())
        {
            write_structure_export_block(&mut writer, block)?;
        }

        writer.finish()?;

        Ok(StructureExportSqlFileResponse {
            file_path: request.file_path.clone(),
            added_count: request.selection.added_tables.len(),
            modified_count: request.selection.modified_tables.len(),
            deleted_count: request.selection.deleted_tables.len(),
        })
    }
}

fn build_performance_stage(
    key: &str,
    label: &str,
    elapsed_ms: u64,
    item_count: Option<usize>,
    note: Option<String>,
) -> CompareHistoryPerformanceStage {
    CompareHistoryPerformanceStage {
        key: key.to_string(),
        label: label.to_string(),
        elapsed_ms,
        item_count,
        note,
    }
}

fn elapsed_millis(started_at: Instant) -> u64 {
    started_at.elapsed().as_millis() as u64
}

fn structure_side_label(side: &str) -> &'static str {
    if side.eq_ignore_ascii_case("source") {
        "源端"
    } else {
        "目标端"
    }
}

fn build_shallow_structure_item(table_name: String) -> StructureTableItem {
    StructureTableItem {
        table_name,
        preview_sql: None,
        source_sql: None,
        target_sql: None,
        source_changed_lines: Vec::new(),
        target_changed_lines: Vec::new(),
        warnings: Vec::new(),
    }
}

fn resolve_structure_task_concurrency(
    options: &StructureCompareOptions,
    task_count: usize,
) -> usize {
    let effective_task_count = task_count.max(1);
    if let Some(configured) = options.detail_concurrency {
        return configured
            .clamp(1, STRUCTURE_COMPARE_CONCURRENCY_MAX)
            .min(effective_task_count);
    }

    let adaptive_base = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(STRUCTURE_COMPARE_CONCURRENCY);
    let adaptive = adaptive_base
        .saturating_mul(2)
        .clamp(4, STRUCTURE_COMPARE_CONCURRENCY_MAX);

    adaptive.min(effective_task_count).max(1)
}

fn unique_table_count<I>(table_names: I) -> usize
where
    I: IntoIterator<Item = String>,
{
    table_names.into_iter().collect::<BTreeSet<_>>().len()
}

fn infer_charset_from_collation(collation: Option<&str>) -> Option<String> {
    collation
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.split('_').next())
        .map(|value| value.to_ascii_lowercase())
}

fn normalize_optional_trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn normalize_optional_lower(value: Option<&str>) -> Option<String> {
    normalize_optional_trimmed(value).map(|value| value.to_ascii_lowercase())
}

fn normalize_optional_sql_fragment(value: Option<&str>) -> Option<String> {
    normalize_optional_trimmed(value).map(|value| normalize_fragment(&value))
}

fn table_options_from_metadata_row(row: &TableOptionRow) -> TableOptions {
    TableOptions {
        engine: normalize_optional_lower(row.engine.as_deref()),
        default_charset: infer_charset_from_collation(row.table_collation.as_deref()),
        collation: normalize_optional_lower(row.table_collation.as_deref()),
        row_format: normalize_optional_lower(row.row_format.as_deref()),
        comment: normalize_optional_trimmed(row.table_comment.as_deref()),
    }
}

fn build_table_option_signature(row: &TableOptionRow) -> Vec<String> {
    let normalized = table_options_from_metadata_row(row);
    vec![
        format!("engine:{}", normalized.engine.unwrap_or_default()),
        format!(
            "default_charset:{}",
            normalized.default_charset.unwrap_or_default()
        ),
        format!("collation:{}", normalized.collation.unwrap_or_default()),
        format!("row_format:{}", normalized.row_format.unwrap_or_default()),
        format!("comment:{}", normalized.comment.unwrap_or_default()),
    ]
}

fn build_column_signature(row: &ColumnMetadataRow, table_options: Option<&TableOptions>) -> String {
    let default_charset = table_options.and_then(|options| options.default_charset.as_deref());
    let default_collation = table_options.and_then(|options| options.collation.as_deref());

    let column_charset = normalize_optional_lower(row.character_set_name.as_deref());
    let column_collation = normalize_optional_lower(row.collation_name.as_deref());
    let effective_charset = match (column_charset.as_deref(), default_charset) {
        (Some(column_charset), Some(default_charset))
            if column_charset.eq_ignore_ascii_case(default_charset) =>
        {
            None
        }
        _ => column_charset,
    };
    let effective_collation = match (column_collation.as_deref(), default_collation) {
        (Some(column_collation), Some(default_collation))
            if column_collation.eq_ignore_ascii_case(default_collation) =>
        {
            None
        }
        _ => column_collation,
    };

    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
        row.ordinal_position,
        row.column_name,
        normalize_integer_display_width(&row.column_type).to_ascii_lowercase(),
        row.is_nullable.to_ascii_lowercase(),
        normalize_optional_sql_fragment(row.column_default.as_deref()).unwrap_or_default(),
        normalize_optional_sql_fragment(Some(&row.extra)).unwrap_or_default(),
        effective_charset.unwrap_or_default(),
        effective_collation.unwrap_or_default(),
        normalize_optional_trimmed(Some(&row.column_comment)).unwrap_or_default(),
        normalize_optional_sql_fragment(row.generation_expression.as_deref()).unwrap_or_default(),
    )
}

fn normalize_index_column_order(collation: Option<&str>) -> &'static str {
    match collation
        .unwrap_or_default()
        .trim()
        .to_ascii_uppercase()
        .as_str()
    {
        "D" => "desc",
        _ => "asc",
    }
}

fn normalize_index_type(index_type: &str) -> String {
    let normalized = index_type.trim().to_ascii_lowercase();
    if normalized == "btree" {
        String::new()
    } else {
        normalized
    }
}

fn build_index_signature(rows: &[IndexMetadataRow]) -> String {
    let first = &rows[0];
    let columns = rows
        .iter()
        .map(|row| {
            let prefix = row
                .sub_part
                .map(|value| value.to_string())
                .unwrap_or_default();
            format!(
                "{}:{}:{}",
                row.column_name,
                prefix,
                normalize_index_column_order(row.collation.as_deref())
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let index_type = normalize_index_type(&first.index_type);

    if first.index_name.eq_ignore_ascii_case("PRIMARY") {
        return format!("primary:{}", columns);
    }

    format!(
        "index:{}:{}:{}:{}",
        first.index_name,
        if first.non_unique == 0 {
            "unique"
        } else {
            "non_unique"
        },
        index_type,
        columns
    )
}

fn build_foreign_key_signature(rows: &[ForeignKeyMetadataRow]) -> String {
    let first = &rows[0];
    let columns = rows
        .iter()
        .map(|row| row.column_name.clone())
        .collect::<Vec<_>>()
        .join(",");
    let referenced_columns = rows
        .iter()
        .map(|row| row.referenced_column_name.clone().unwrap_or_default())
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "fk:{}:{}:{}:{}:{}:{}",
        first.constraint_name,
        columns,
        first.referenced_table_name.clone().unwrap_or_default(),
        referenced_columns,
        normalize_optional_lower(first.update_rule.as_deref()).unwrap_or_default(),
        normalize_optional_lower(first.delete_rule.as_deref()).unwrap_or_default(),
    )
}

fn build_check_signature(row: &CheckMetadataRow) -> String {
    format!(
        "check:{}:{}",
        row.constraint_name,
        normalize_fragment(&row.check_clause)
    )
}

async fn load_lightweight_structure_signatures(
    session: MySqlSession,
    side: &str,
) -> Result<
    (
        BTreeMap<String, TableStructureSignature>,
        Vec<CompareHistoryPerformanceStage>,
    ),
    AppError,
> {
    let side_label = structure_side_label(side);
    let list_started_at = Instant::now();
    let table_names = session.list_tables().await?;
    let list_elapsed_ms = elapsed_millis(list_started_at);
    let table_count = table_names.len();
    let mut signatures = table_names
        .iter()
        .cloned()
        .map(|table_name| (table_name, TableStructureSignature::default()))
        .collect::<BTreeMap<_, _>>();
    let mut stages = vec![build_performance_stage(
        &format!("load_{}_tables", side),
        &format!("加载{}表清单", side_label),
        list_elapsed_ms,
        Some(table_count),
        None,
    )];

    if table_names.is_empty() {
        return Ok((signatures, stages));
    }

    let (table_options_result, columns_result, indexes_result, foreign_keys_result, checks_result) =
        tokio::try_join!(
            load_table_option_rows(session.clone()),
            load_column_metadata_rows(session.clone()),
            load_index_metadata_rows(session.clone()),
            load_foreign_key_metadata_rows(session.clone()),
            load_check_metadata_rows(session.clone())
        )?;

    let mut table_options_map = BTreeMap::new();
    for row in &table_options_result.rows {
        table_options_map.insert(row.table_name.clone(), table_options_from_metadata_row(row));
        if let Some(signature) = signatures.get_mut(&row.table_name) {
            signature.options = build_table_option_signature(row);
        }
    }

    for row in &columns_result.rows {
        if let Some(signature) = signatures.get_mut(&row.table_name) {
            signature.columns.push(build_column_signature(
                row,
                table_options_map.get(&row.table_name),
            ));
        }
    }

    let index_table_count =
        unique_table_count(indexes_result.rows.iter().map(|row| row.table_name.clone()));
    let index_row_count = indexes_result.rows.len();
    let mut index_groups = BTreeMap::<(String, String), Vec<IndexMetadataRow>>::new();
    for row in indexes_result.rows {
        index_groups
            .entry((row.table_name.clone(), row.index_name.clone()))
            .or_default()
            .push(row);
    }
    for ((table_name, _), mut rows) in index_groups {
        rows.sort_by_key(|row| row.seq_in_index);
        if let Some(signature) = signatures.get_mut(&table_name) {
            signature.indexes.push(build_index_signature(&rows));
        }
    }

    let foreign_key_table_count = unique_table_count(
        foreign_keys_result
            .rows
            .iter()
            .map(|row| row.table_name.clone()),
    );
    let foreign_key_row_count = foreign_keys_result.rows.len();
    let mut foreign_key_groups = BTreeMap::<(String, String), Vec<ForeignKeyMetadataRow>>::new();
    for row in foreign_keys_result.rows {
        foreign_key_groups
            .entry((row.table_name.clone(), row.constraint_name.clone()))
            .or_default()
            .push(row);
    }
    for ((table_name, _), mut rows) in foreign_key_groups {
        rows.sort_by_key(|row| row.ordinal_position);
        if let Some(signature) = signatures.get_mut(&table_name) {
            signature
                .foreign_keys
                .push(build_foreign_key_signature(&rows));
        }
    }

    for row in &checks_result.rows {
        if let Some(signature) = signatures.get_mut(&row.table_name) {
            signature.checks.push(build_check_signature(row));
        }
    }

    stages.push(build_performance_stage(
        &format!("load_{}_table_options", side),
        &format!("加载{}表选项", side_label),
        table_options_result.elapsed_ms,
        Some(unique_table_count(
            table_options_result
                .rows
                .iter()
                .map(|row| row.table_name.clone()),
        )),
        table_options_result.note.clone(),
    ));
    stages.push(build_performance_stage(
        &format!("load_{}_column_metadata", side),
        &format!("加载{}列元数据", side_label),
        columns_result.elapsed_ms,
        Some(unique_table_count(
            columns_result.rows.iter().map(|row| row.table_name.clone()),
        )),
        Some(format!("列记录 {} 行", columns_result.rows.len())),
    ));
    stages.push(build_performance_stage(
        &format!("load_{}_index_metadata", side),
        &format!("加载{}索引元数据", side_label),
        indexes_result.elapsed_ms,
        Some(index_table_count),
        Some(format!("索引记录 {} 行", index_row_count)),
    ));
    stages.push(build_performance_stage(
        &format!("load_{}_foreign_key_metadata", side),
        &format!("加载{}外键元数据", side_label),
        foreign_keys_result.elapsed_ms,
        Some(foreign_key_table_count),
        if let Some(note) = &foreign_keys_result.note {
            Some(note.clone())
        } else {
            Some(format!("外键记录 {} 行", foreign_key_row_count))
        },
    ));
    stages.push(build_performance_stage(
        &format!("load_{}_check_metadata", side),
        &format!("加载{}检查约束元数据", side_label),
        checks_result.elapsed_ms,
        Some(unique_table_count(
            checks_result.rows.iter().map(|row| row.table_name.clone()),
        )),
        if let Some(note) = &checks_result.note {
            Some(note.clone())
        } else {
            Some(format!("检查约束 {} 条", checks_result.rows.len()))
        },
    ));

    Ok((signatures, stages))
}

async fn load_table_option_rows(
    session: MySqlSession,
) -> Result<MetadataLoadResult<TableOptionRow>, AppError> {
    let database = session.database_name().to_string();
    let started_at = Instant::now();
    let mut conn = session.get_conn().await?;
    let sql = "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, ROW_FORMAT, TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME";
    let rows = conn
        .exec_map(
            sql,
            (&database,),
            |(table_name, engine, table_collation, row_format, table_comment): (
                String,
                Option<String>,
                Option<String>,
                Option<String>,
                Option<String>,
            )| TableOptionRow {
                table_name,
                engine,
                table_collation,
                row_format,
                table_comment,
            },
        )
        .await
        .map_err(AppError::from_mysql)?;

    Ok(MetadataLoadResult {
        rows,
        elapsed_ms: elapsed_millis(started_at),
        note: None,
    })
}

async fn load_column_metadata_rows(
    session: MySqlSession,
) -> Result<MetadataLoadResult<ColumnMetadataRow>, AppError> {
    let database = session.database_name().to_string();
    let started_at = Instant::now();
    let mut conn = session.get_conn().await?;
    let sql = "SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_COMMENT, GENERATION_EXPRESSION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION";
    let rows = conn
        .exec_map(
            sql,
            (&database,),
            |(
                table_name,
                column_name,
                ordinal_position,
                column_type,
                is_nullable,
                column_default,
                extra,
                character_set_name,
                collation_name,
                column_comment,
                generation_expression,
            ): (
                String,
                String,
                u64,
                String,
                String,
                Option<String>,
                String,
                Option<String>,
                Option<String>,
                String,
                Option<String>,
            )| ColumnMetadataRow {
                table_name,
                column_name,
                ordinal_position,
                column_type,
                is_nullable,
                column_default,
                extra,
                character_set_name,
                collation_name,
                column_comment,
                generation_expression,
            },
        )
        .await
        .map_err(AppError::from_mysql)?;

    Ok(MetadataLoadResult {
        rows,
        elapsed_ms: elapsed_millis(started_at),
        note: None,
    })
}

async fn load_index_metadata_rows(
    session: MySqlSession,
) -> Result<MetadataLoadResult<IndexMetadataRow>, AppError> {
    let database = session.database_name().to_string();
    let started_at = Instant::now();
    let mut conn = session.get_conn().await?;
    let sql = "SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, COLLATION, SUB_PART, INDEX_TYPE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX";
    let rows = conn
        .exec_map(
            sql,
            (&database,),
            |(
                table_name,
                index_name,
                non_unique,
                seq_in_index,
                column_name,
                collation,
                sub_part,
                index_type,
            ): (
                String,
                String,
                u8,
                u64,
                String,
                Option<String>,
                Option<u64>,
                String,
            )| IndexMetadataRow {
                table_name,
                index_name,
                non_unique,
                seq_in_index,
                column_name,
                collation,
                sub_part,
                index_type,
            },
        )
        .await
        .map_err(AppError::from_mysql)?;

    Ok(MetadataLoadResult {
        rows,
        elapsed_ms: elapsed_millis(started_at),
        note: None,
    })
}

async fn load_foreign_key_metadata_rows(
    session: MySqlSession,
) -> Result<MetadataLoadResult<ForeignKeyMetadataRow>, AppError> {
    let database = session.database_name().to_string();
    let started_at = Instant::now();
    let mut conn = session.get_conn().await?;
    let sql = "SELECT kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, rc.UPDATE_RULE, rc.DELETE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu INNER JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND tc.TABLE_NAME = kcu.TABLE_NAME AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.TABLE_NAME = kcu.TABLE_NAME AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME WHERE kcu.TABLE_SCHEMA = ? AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY' ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION";
    let rows = conn
        .exec_map(
            sql,
            (&database,),
            |(
                table_name,
                constraint_name,
                ordinal_position,
                column_name,
                referenced_table_name,
                referenced_column_name,
                update_rule,
                delete_rule,
            ): (
                String,
                String,
                u64,
                String,
                Option<String>,
                Option<String>,
                Option<String>,
                Option<String>,
            )| ForeignKeyMetadataRow {
                table_name,
                constraint_name,
                ordinal_position,
                column_name,
                referenced_table_name,
                referenced_column_name,
                update_rule,
                delete_rule,
            },
        )
        .await
        .map_err(AppError::from_mysql)?;

    Ok(MetadataLoadResult {
        rows,
        elapsed_ms: elapsed_millis(started_at),
        note: None,
    })
}

async fn load_check_metadata_rows(
    session: MySqlSession,
) -> Result<MetadataLoadResult<CheckMetadataRow>, AppError> {
    let database = session.database_name().to_string();
    let started_at = Instant::now();
    let mut conn = session.get_conn().await?;
    let sql = "SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc INNER JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA = ? AND tc.CONSTRAINT_TYPE = 'CHECK' ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME";
    let rows = match conn
        .exec_map(
            sql,
            (&database,),
            |(table_name, constraint_name, check_clause): (String, String, String)| {
                CheckMetadataRow {
                    table_name,
                    constraint_name,
                    check_clause,
                }
            },
        )
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            let message = error.to_string().to_ascii_lowercase();
            if message.contains("check_constraints")
                || message.contains("unknown table")
                || message.contains("doesn't exist")
            {
                return Ok(MetadataLoadResult {
                    rows: Vec::new(),
                    elapsed_ms: elapsed_millis(started_at),
                    note: Some("当前数据库未暴露 CHECK 元数据，轻量签名已跳过该项".to_string()),
                });
            }
            return Err(AppError::from_mysql(error));
        }
    };

    Ok(MetadataLoadResult {
        rows,
        elapsed_ms: elapsed_millis(started_at),
        note: None,
    })
}

fn write_structure_export_block(
    writer: &mut StructureSqlWriter,
    block: StructureExportBlock,
) -> Result<(), AppError> {
    writer.write_comment(&block.comment)?;
    for warning in block.warnings {
        writer.write_comment(&warning)?;
    }

    if block.statements.is_empty() {
        if let Some(empty_comment) = block.empty_comment {
            writer.write_comment(&empty_comment)?;
        }
    } else {
        for statement in block.statements {
            writer.write_statement(&statement)?;
        }
    }

    writer.write_blank_line()
}

async fn prepare_added_export_block(
    source_session: MySqlSession,
    target_database: String,
    table_name: String,
) -> Result<StructureExportBlock, AppError> {
    let create_sql = source_session.show_create_table(&table_name).await?;
    Ok(StructureExportBlock {
        comment: format!("新增表：{}", table_name),
        warnings: Vec::new(),
        statements: vec![qualify_create_table_sql(
            &create_sql,
            &target_database,
            &table_name,
        )],
        empty_comment: None,
    })
}

async fn prepare_modified_export_block(
    source_session: MySqlSession,
    target_session: MySqlSession,
    target_database: String,
    table_name: String,
) -> Result<StructureExportBlock, AppError> {
    let (source_create_sql, target_create_sql) = tokio::try_join!(
        source_session.show_create_table(&table_name),
        target_session.show_create_table(&table_name)
    )?;
    let source_definition = parse_create_table(&source_create_sql)?;
    let target_definition = parse_create_table(&target_create_sql)?;
    let plan = build_alter_plan(
        &target_database,
        &table_name,
        &source_definition,
        &target_definition,
    );

    Ok(StructureExportBlock {
        comment: format!("修改表：{}，按结构差异生成 ALTER TABLE 语句", table_name),
        warnings: plan.warnings,
        statements: plan.statements,
        empty_comment: Some(
            "仅检测到 AUTO_INCREMENT 等运行态差异，无需导出结构变更语句".to_string(),
        ),
    })
}

async fn prepare_deleted_export_block(
    target_session: MySqlSession,
    target_database: String,
    table_name: String,
) -> Result<StructureExportBlock, AppError> {
    let _ = target_session.show_create_table(&table_name).await?;
    Ok(StructureExportBlock {
        comment: format!("删除表：{}", table_name),
        warnings: Vec::new(),
        statements: vec![format!(
            "DROP TABLE IF EXISTS {}.{};",
            quote_identifier(&target_database),
            quote_identifier(&table_name)
        )],
        empty_comment: None,
    })
}

async fn load_added_table_detail(
    source_session: MySqlSession,
    target_database: String,
    table_name: String,
) -> Result<StructureTableItem, AppError> {
    load_added_table_detail_with_performance(source_session, target_database, table_name)
        .await
        .map(|(detail, _)| detail)
}

async fn load_added_table_detail_with_performance(
    source_session: MySqlSession,
    target_database: String,
    table_name: String,
) -> Result<(StructureTableItem, Vec<CompareHistoryPerformanceStage>), AppError> {
    let fetch_started_at = Instant::now();
    let create_sql = source_session.show_create_table(&table_name).await?;
    let qualify_started_at = Instant::now();
    let detail = StructureTableItem {
        table_name: table_name.clone(),
        preview_sql: Some(qualify_create_table_sql(
            &create_sql,
            &target_database,
            &table_name,
        )),
        source_sql: None,
        target_sql: None,
        source_changed_lines: Vec::new(),
        target_changed_lines: Vec::new(),
        warnings: Vec::new(),
    };

    Ok((
        detail,
        vec![
            build_performance_stage(
                "load_source_create_sql",
                "读取源端建表语句",
                elapsed_millis(fetch_started_at),
                Some(1),
                None,
            ),
            build_performance_stage(
                "build_added_preview_sql",
                "生成新增表预览 SQL",
                elapsed_millis(qualify_started_at),
                Some(1),
                None,
            ),
        ],
    ))
}

fn build_deleted_table_item(target_database: &str, table_name: String) -> StructureTableItem {
    StructureTableItem {
        preview_sql: Some(format!(
            "DROP TABLE IF EXISTS {}.{};",
            quote_identifier(target_database),
            quote_identifier(&table_name)
        )),
        table_name,
        source_sql: None,
        target_sql: None,
        source_changed_lines: Vec::new(),
        target_changed_lines: Vec::new(),
        warnings: Vec::new(),
    }
}

fn build_modified_detail_item(
    table_name: String,
    source_sql: String,
    target_sql: String,
    line_diff: StructureLineDiff,
    warnings: Vec<String>,
) -> StructureTableItem {
    StructureTableItem {
        table_name,
        preview_sql: None,
        source_sql: Some(source_sql),
        target_sql: Some(target_sql),
        source_changed_lines: line_diff.source_changed_lines.into_iter().collect(),
        target_changed_lines: line_diff.target_changed_lines.into_iter().collect(),
        warnings,
    }
}

async fn load_modified_table_detail(
    source_session: MySqlSession,
    target_session: MySqlSession,
    target_database: String,
    table_name: String,
) -> Result<StructureTableItem, AppError> {
    load_modified_table_detail_with_performance(
        source_session,
        target_session,
        target_database,
        table_name,
    )
    .await
    .map(|(detail, _)| detail)
}

async fn load_modified_table_detail_with_performance(
    source_session: MySqlSession,
    target_session: MySqlSession,
    target_database: String,
    table_name: String,
) -> Result<(StructureTableItem, Vec<CompareHistoryPerformanceStage>), AppError> {
    let ((source_sql, source_fetch_ms), (target_sql, target_fetch_ms)) = tokio::try_join!(
        async {
            let started_at = Instant::now();
            let sql = source_session.show_create_table(&table_name).await?;
            Ok::<_, AppError>((sql, elapsed_millis(started_at)))
        },
        async {
            let started_at = Instant::now();
            let sql = target_session.show_create_table(&table_name).await?;
            Ok::<_, AppError>((sql, elapsed_millis(started_at)))
        }
    )?;
    let mut stages = vec![
        build_performance_stage(
            "load_source_create_sql",
            "读取源端建表语句",
            source_fetch_ms,
            Some(1),
            None,
        ),
        build_performance_stage(
            "load_target_create_sql",
            "读取目标端建表语句",
            target_fetch_ms,
            Some(1),
            None,
        ),
    ];

    if source_sql == target_sql {
        stages.push(build_performance_stage(
            "short_circuit_equal_sql",
            "原始建表语句短路",
            0,
            Some(1),
            Some("源端与目标端 DDL 完全一致，跳过解析".to_string()),
        ));
        return Ok((
            build_modified_detail_item(
                table_name,
                source_sql,
                target_sql,
                StructureLineDiff::default(),
                Vec::new(),
            ),
            stages,
        ));
    }

    let source_parse_started_at = Instant::now();
    let source_definition = parse_create_table(&source_sql)?;
    stages.push(build_performance_stage(
        "parse_source_create_sql",
        "解析源端建表语句",
        elapsed_millis(source_parse_started_at),
        Some(1),
        None,
    ));

    let target_parse_started_at = Instant::now();
    let target_definition = parse_create_table(&target_sql)?;
    stages.push(build_performance_stage(
        "parse_target_create_sql",
        "解析目标端建表语句",
        elapsed_millis(target_parse_started_at),
        Some(1),
        None,
    ));

    let plan_started_at = Instant::now();
    let plan = build_alter_plan(
        &target_database,
        &table_name,
        &source_definition,
        &target_definition,
    );
    stages.push(build_performance_stage(
        "build_alter_plan",
        "生成结构变更计划",
        elapsed_millis(plan_started_at),
        Some(1),
        Some(format!(
            "SQL {} 条，警告 {} 条",
            plan.statements.len(),
            plan.warnings.len()
        )),
    ));

    let line_diff_started_at = Instant::now();
    let line_diff = build_structure_line_diff(&source_definition, &target_definition);
    stages.push(build_performance_stage(
        "build_line_diff",
        "计算高亮行差异",
        elapsed_millis(line_diff_started_at),
        Some(line_diff.source_changed_lines.len() + line_diff.target_changed_lines.len()),
        None,
    ));

    Ok((
        build_modified_detail_item(table_name, source_sql, target_sql, line_diff, plan.warnings),
        stages,
    ))
}

fn build_alter_plan(
    database: &str,
    table_name: &str,
    source: &ParsedCreateTable,
    target: &ParsedCreateTable,
) -> AlterPlan {
    let qualified_table = format!(
        "{}.{}",
        quote_identifier(database),
        quote_identifier(table_name)
    );
    let mut statements = Vec::new();
    let mut warnings = Vec::new();

    let source_constraints = &source.constraints;
    let target_constraints = &target.constraints;

    for (name, target_constraint) in target_constraints {
        let should_drop = match source_constraints.get(name) {
            Some(source_constraint) => {
                normalize_fragment(&source_constraint.sql)
                    != normalize_fragment(&target_constraint.sql)
            }
            None => true,
        };

        if should_drop {
            match target_constraint.kind {
                ConstraintKind::ForeignKey => statements.push(format!(
                    "ALTER TABLE {} DROP FOREIGN KEY {};",
                    qualified_table,
                    quote_identifier(name)
                )),
                ConstraintKind::Check => statements.push(format!(
                    "ALTER TABLE {} DROP CHECK {};",
                    qualified_table,
                    quote_identifier(name)
                )),
                ConstraintKind::Other => warnings.push(format!(
                    "检测到约束 {} 发生变化，当前未自动生成删除语句，请人工复核",
                    name
                )),
            }
        }
    }

    for (name, target_index) in &target.indexes {
        let should_drop = match source.indexes.get(name) {
            Some(source_index) => {
                normalize_fragment(source_index) != normalize_fragment(target_index)
            }
            None => true,
        };

        if should_drop {
            statements.push(format!(
                "ALTER TABLE {} DROP INDEX {};",
                qualified_table,
                quote_identifier(name)
            ));
        }
    }

    if primary_key_changed(source, target) && target.primary_key.is_some() {
        statements.push(format!("ALTER TABLE {} DROP PRIMARY KEY;", qualified_table));
    }

    let source_column_map = source
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<BTreeMap<_, _>>();
    let target_column_map = target
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<BTreeMap<_, _>>();

    let mut current_order = target
        .columns
        .iter()
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();

    for target_column in &target.columns {
        if !source_column_map.contains_key(target_column.name.as_str()) {
            statements.push(format!(
                "ALTER TABLE {} DROP COLUMN {};",
                qualified_table,
                quote_identifier(&target_column.name)
            ));
            current_order.retain(|name| name != &target_column.name);
        }
    }

    for (index, source_column) in source.columns.iter().enumerate() {
        let desired_previous = previous_source_column_name(source, index);
        let position_clause = build_column_position_clause(desired_previous.as_deref());
        let current_previous = current_previous_column_name(&current_order, &source_column.name);

        match target_column_map.get(source_column.name.as_str()) {
            None => {
                statements.push(format!(
                    "ALTER TABLE {} ADD COLUMN {}{};",
                    qualified_table, source_column.sql, position_clause
                ));
                reposition_column(
                    &mut current_order,
                    &source_column.name,
                    desired_previous.as_deref(),
                );
            }
            Some(target_column) => {
                let definition_changed =
                    source_column.normalized_sql != target_column.normalized_sql;
                let order_changed = current_previous != desired_previous;
                if definition_changed || order_changed {
                    statements.push(format!(
                        "ALTER TABLE {} MODIFY COLUMN {}{};",
                        qualified_table, source_column.sql, position_clause
                    ));
                    reposition_column(
                        &mut current_order,
                        &source_column.name,
                        desired_previous.as_deref(),
                    );
                }
            }
        }
    }

    if primary_key_changed(source, target) {
        if let Some(primary_key) = &source.primary_key {
            statements.push(format!(
                "ALTER TABLE {} ADD {};",
                qualified_table, primary_key
            ));
        }
    }

    for (name, source_index) in &source.indexes {
        let should_add = match target.indexes.get(name) {
            Some(target_index) => {
                normalize_fragment(source_index) != normalize_fragment(target_index)
            }
            None => true,
        };

        if should_add {
            statements.push(format!(
                "ALTER TABLE {} ADD {};",
                qualified_table, source_index
            ));
        }
    }

    for (name, source_constraint) in source_constraints {
        let should_add = match target_constraints.get(name) {
            Some(target_constraint) => {
                normalize_fragment(&source_constraint.sql)
                    != normalize_fragment(&target_constraint.sql)
            }
            None => true,
        };

        if should_add {
            statements.push(format!(
                "ALTER TABLE {} ADD {};",
                qualified_table, source_constraint.sql
            ));
        }
    }

    statements.extend(build_table_option_statements(
        &qualified_table,
        &source.options,
        &target.options,
    ));

    AlterPlan {
        statements,
        warnings,
    }
}

fn build_structure_line_diff(
    source: &ParsedCreateTable,
    target: &ParsedCreateTable,
) -> StructureLineDiff {
    let source_lines = &source.line_map;
    let target_lines = &target.line_map;
    let mut diff = StructureLineDiff::default();

    let source_constraints = &source.constraints;
    let target_constraints = &target.constraints;
    for (name, target_constraint) in target_constraints {
        let changed = match source_constraints.get(name) {
            Some(source_constraint) => {
                normalize_fragment(&source_constraint.sql)
                    != normalize_fragment(&target_constraint.sql)
            }
            None => true,
        };
        if changed {
            mark_named_line(
                &mut diff.target_changed_lines,
                &target_lines.constraint_lines,
                name,
            );
            mark_named_line(
                &mut diff.source_changed_lines,
                &source_lines.constraint_lines,
                name,
            );
        }
    }

    for (name, source_constraint) in source_constraints {
        let changed = match target_constraints.get(name) {
            Some(target_constraint) => {
                normalize_fragment(&source_constraint.sql)
                    != normalize_fragment(&target_constraint.sql)
            }
            None => true,
        };
        if changed {
            mark_named_line(
                &mut diff.source_changed_lines,
                &source_lines.constraint_lines,
                name,
            );
            mark_named_line(
                &mut diff.target_changed_lines,
                &target_lines.constraint_lines,
                name,
            );
        }
    }

    for (name, target_index) in &target.indexes {
        let changed = match source.indexes.get(name) {
            Some(source_index) => {
                normalize_fragment(source_index) != normalize_fragment(target_index)
            }
            None => true,
        };
        if changed {
            mark_named_line(
                &mut diff.target_changed_lines,
                &target_lines.index_lines,
                name,
            );
            mark_named_line(
                &mut diff.source_changed_lines,
                &source_lines.index_lines,
                name,
            );
        }
    }

    for (name, source_index) in &source.indexes {
        let changed = match target.indexes.get(name) {
            Some(target_index) => {
                normalize_fragment(source_index) != normalize_fragment(target_index)
            }
            None => true,
        };
        if changed {
            mark_named_line(
                &mut diff.source_changed_lines,
                &source_lines.index_lines,
                name,
            );
            mark_named_line(
                &mut diff.target_changed_lines,
                &target_lines.index_lines,
                name,
            );
        }
    }

    if primary_key_changed(source, target) {
        mark_optional_line(
            &mut diff.source_changed_lines,
            source_lines.primary_key_line,
        );
        mark_optional_line(
            &mut diff.target_changed_lines,
            target_lines.primary_key_line,
        );
    }

    let source_column_map = source
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<BTreeMap<_, _>>();
    let target_column_map = target
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<BTreeMap<_, _>>();

    let mut current_order = target
        .columns
        .iter()
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();

    for target_column in &target.columns {
        if !source_column_map.contains_key(target_column.name.as_str()) {
            mark_named_line(
                &mut diff.target_changed_lines,
                &target_lines.column_lines,
                &target_column.name,
            );
            current_order.retain(|name| name != &target_column.name);
        }
    }

    for (index, source_column) in source.columns.iter().enumerate() {
        let desired_previous = previous_source_column_name(source, index);
        let current_previous = current_previous_column_name(&current_order, &source_column.name);

        match target_column_map.get(source_column.name.as_str()) {
            None => {
                mark_named_line(
                    &mut diff.source_changed_lines,
                    &source_lines.column_lines,
                    &source_column.name,
                );
                reposition_column(
                    &mut current_order,
                    &source_column.name,
                    desired_previous.as_deref(),
                );
            }
            Some(target_column) => {
                let definition_changed =
                    source_column.normalized_sql != target_column.normalized_sql;
                let order_changed = current_previous != desired_previous;
                if definition_changed || order_changed {
                    mark_named_line(
                        &mut diff.source_changed_lines,
                        &source_lines.column_lines,
                        &source_column.name,
                    );
                    mark_named_line(
                        &mut diff.target_changed_lines,
                        &target_lines.column_lines,
                        &target_column.name,
                    );
                    reposition_column(
                        &mut current_order,
                        &source_column.name,
                        desired_previous.as_deref(),
                    );
                }
            }
        }
    }

    if source.options.engine != target.options.engine
        || source.options.default_charset != target.options.default_charset
        || source.options.collation != target.options.collation
        || source.options.row_format != target.options.row_format
        || source.options.comment != target.options.comment
    {
        mark_optional_line(
            &mut diff.source_changed_lines,
            source_lines.table_options_line,
        );
        mark_optional_line(
            &mut diff.target_changed_lines,
            target_lines.table_options_line,
        );
    }

    diff
}

fn build_table_option_statements(
    qualified_table: &str,
    source: &TableOptions,
    target: &TableOptions,
) -> Vec<String> {
    let mut clauses = Vec::new();

    if source.engine != target.engine {
        if let Some(engine) = &source.engine {
            clauses.push(format!("ENGINE = {}", engine));
        }
    }

    if source.default_charset != target.default_charset {
        if let Some(default_charset) = &source.default_charset {
            clauses.push(format!("DEFAULT CHARACTER SET = {}", default_charset));
        }
    }

    if source.collation != target.collation {
        if let Some(collation) = &source.collation {
            clauses.push(format!("COLLATE = {}", collation));
        }
    }

    if source.row_format != target.row_format {
        if let Some(row_format) = &source.row_format {
            clauses.push(format!("ROW_FORMAT = {}", row_format));
        }
    }

    if source.comment != target.comment {
        clauses.push(format!(
            "COMMENT = '{}'",
            escape_sql_string(source.comment.as_deref().unwrap_or_default())
        ));
    }

    if clauses.is_empty() {
        return Vec::new();
    }

    vec![format!(
        "ALTER TABLE {} {};",
        qualified_table,
        clauses.join(", ")
    )]
}

fn parse_create_table(create_sql: &str) -> Result<ParsedCreateTable, AppError> {
    let (body, options) = extract_create_body_and_options(create_sql)?;
    let fragments = split_create_body_fragments(body);
    let mut parsed = ParsedCreateTable {
        columns: Vec::new(),
        primary_key: None,
        indexes: BTreeMap::new(),
        constraints: BTreeMap::new(),
        options: parse_table_options(options),
        line_map: ParsedCreateTableLineMap::default(),
    };
    let column_context = ColumnNormalizationContext::new(&parsed.options);

    for (index, fragment) in fragments.iter().enumerate() {
        let trimmed = fragment.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        let line_number = index + 2;

        if trimmed.starts_with('`') {
            let column_name = extract_backtick_name(&trimmed)
                .ok_or_else(|| AppError::Parse(format!("未识别列定义名称: {}", trimmed)))?;
            let normalized_sql = normalize_column_fragment_with_context(&trimmed, &column_context);
            parsed
                .line_map
                .column_lines
                .insert(column_name.clone(), line_number);
            parsed.columns.push(ColumnFragment {
                name: column_name,
                sql: trimmed,
                normalized_sql,
            });
            continue;
        }

        let upper = trimmed.to_uppercase();
        if upper.starts_with("PRIMARY KEY") {
            parsed.line_map.primary_key_line = Some(line_number);
            parsed.primary_key = Some(trimmed);
            continue;
        }

        if is_index_fragment(&upper) {
            if let Some(index_name) = extract_index_name(&trimmed) {
                parsed
                    .line_map
                    .index_lines
                    .insert(index_name.clone(), line_number);
                parsed.indexes.insert(index_name, trimmed);
                continue;
            }
        }

        if upper.starts_with("CONSTRAINT ") {
            if let Some(constraint_name) = extract_constraint_name(&trimmed) {
                parsed
                    .line_map
                    .constraint_lines
                    .insert(constraint_name.clone(), line_number);
                parsed.constraints.insert(
                    constraint_name.clone(),
                    ConstraintFragment {
                        kind: detect_constraint_kind(&upper),
                        sql: trimmed,
                    },
                );
                continue;
            }
        }
    }

    if !options.is_empty() {
        parsed.line_map.table_options_line = Some(fragments.len() + 2);
    }

    Ok(parsed)
}

fn extract_create_body_and_options(create_sql: &str) -> Result<(&str, &str), AppError> {
    let open_index = create_sql
        .find('(')
        .ok_or_else(|| AppError::Parse("建表语句缺少左括号".to_string()))?;
    let close_index = find_matching_parenthesis(create_sql, open_index)
        .ok_or_else(|| AppError::Parse("建表语句缺少右括号".to_string()))?;

    Ok((
        &create_sql[open_index + 1..close_index],
        create_sql[close_index + 1..].trim(),
    ))
}

fn find_matching_parenthesis(input: &str, open_index: usize) -> Option<usize> {
    let mut depth = 0_i32;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_backtick = false;
    let mut previous_char = '\0';

    for (index, ch) in input
        .char_indices()
        .skip_while(|(index, _)| *index < open_index)
    {
        if in_single_quote {
            if ch == '\'' && previous_char != '\\' {
                in_single_quote = false;
            }
            previous_char = ch;
            continue;
        }
        if in_double_quote {
            if ch == '"' && previous_char != '\\' {
                in_double_quote = false;
            }
            previous_char = ch;
            continue;
        }
        if in_backtick {
            if ch == '`' {
                in_backtick = false;
            }
            previous_char = ch;
            continue;
        }

        match ch {
            '\'' => in_single_quote = true,
            '"' => in_double_quote = true,
            '`' => in_backtick = true,
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }

        previous_char = ch;
    }

    None
}

fn split_create_body_fragments(body: &str) -> Vec<String> {
    let mut fragments = Vec::new();
    let mut current = String::new();
    let mut depth = 0_i32;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_backtick = false;
    let mut previous_char = '\0';

    for ch in body.chars() {
        if in_single_quote {
            current.push(ch);
            if ch == '\'' && previous_char != '\\' {
                in_single_quote = false;
            }
            previous_char = ch;
            continue;
        }
        if in_double_quote {
            current.push(ch);
            if ch == '"' && previous_char != '\\' {
                in_double_quote = false;
            }
            previous_char = ch;
            continue;
        }
        if in_backtick {
            current.push(ch);
            if ch == '`' {
                in_backtick = false;
            }
            previous_char = ch;
            continue;
        }

        match ch {
            '\'' => {
                in_single_quote = true;
                current.push(ch);
            }
            '"' => {
                in_double_quote = true;
                current.push(ch);
            }
            '`' => {
                in_backtick = true;
                current.push(ch);
            }
            '(' => {
                depth += 1;
                current.push(ch);
            }
            ')' => {
                depth -= 1;
                current.push(ch);
            }
            ',' if depth == 0 => {
                fragments.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }

        previous_char = ch;
    }

    if !current.trim().is_empty() {
        fragments.push(current.trim().to_string());
    }

    fragments
}

fn is_index_fragment(upper: &str) -> bool {
    upper.starts_with("KEY ")
        || upper.starts_with("INDEX ")
        || upper.starts_with("UNIQUE KEY ")
        || upper.starts_with("UNIQUE INDEX ")
        || upper.starts_with("FULLTEXT KEY ")
        || upper.starts_with("SPATIAL KEY ")
}

fn extract_backtick_name(fragment: &str) -> Option<String> {
    let start = fragment.find('`')?;
    let end = fragment[start + 1..].find('`')?;
    Some(fragment[start + 1..start + 1 + end].to_string())
}

fn extract_index_name(fragment: &str) -> Option<String> {
    INDEX_NAME_REGEX
        .captures(fragment)
        .and_then(|captures| captures.get(1))
        .map(|matched| matched.as_str().to_string())
}

fn extract_constraint_name(fragment: &str) -> Option<String> {
    CONSTRAINT_NAME_REGEX
        .captures(fragment)
        .and_then(|captures| captures.get(1))
        .map(|matched| matched.as_str().to_string())
}

fn detect_constraint_kind(upper_fragment: &str) -> ConstraintKind {
    if upper_fragment.contains(" FOREIGN KEY ") {
        ConstraintKind::ForeignKey
    } else if upper_fragment.contains(" CHECK ") {
        ConstraintKind::Check
    } else {
        ConstraintKind::Other
    }
}

fn previous_source_column_name(source: &ParsedCreateTable, index: usize) -> Option<String> {
    if index == 0 {
        None
    } else {
        Some(source.columns[index - 1].name.clone())
    }
}

fn current_previous_column_name(current_order: &[String], column_name: &str) -> Option<String> {
    current_order
        .iter()
        .position(|item| item == column_name)
        .and_then(|position| position.checked_sub(1))
        .map(|position| current_order[position].clone())
}

fn mark_optional_line(lines: &mut BTreeSet<usize>, line_number: Option<usize>) {
    if let Some(line_number) = line_number {
        lines.insert(line_number);
    }
}

fn mark_named_line(lines: &mut BTreeSet<usize>, line_map: &BTreeMap<String, usize>, name: &str) {
    if let Some(line_number) = line_map.get(name) {
        lines.insert(*line_number);
    }
}

fn build_column_position_clause(previous_column: Option<&str>) -> String {
    match previous_column {
        Some(previous_column) => format!(" AFTER {}", quote_identifier(previous_column)),
        None => " FIRST".to_string(),
    }
}

fn reposition_column(
    current_order: &mut Vec<String>,
    column_name: &str,
    previous_column: Option<&str>,
) {
    current_order.retain(|item| item != column_name);

    let insert_index = match previous_column {
        Some(previous_column) => current_order
            .iter()
            .position(|item| item == previous_column)
            .map(|position| position + 1)
            .unwrap_or(current_order.len()),
        None => 0,
    };

    current_order.insert(insert_index, column_name.to_string());
}

fn primary_key_changed(source: &ParsedCreateTable, target: &ParsedCreateTable) -> bool {
    match (&source.primary_key, &target.primary_key) {
        (Some(source_primary_key), Some(target_primary_key)) => {
            normalize_fragment(source_primary_key) != normalize_fragment(target_primary_key)
        }
        (None, None) => false,
        _ => true,
    }
}

#[cfg(test)]
fn has_meaningful_structure_difference(
    database: &str,
    table_name: &str,
    source: &ParsedCreateTable,
    target: &ParsedCreateTable,
) -> bool {
    let plan = build_alter_plan(database, table_name, source, target);
    !plan.statements.is_empty() || !plan.warnings.is_empty()
}

fn parse_table_options(options: &str) -> TableOptions {
    let normalized = options.trim().trim_end_matches(';');
    TableOptions {
        engine: capture_option_with_regex(normalized, &ENGINE_OPTION_REGEX),
        default_charset: capture_option_with_regex(normalized, &DEFAULT_CHARSET_OPTION_REGEX),
        collation: capture_option_with_regex(normalized, &COLLATE_OPTION_REGEX),
        row_format: capture_option_with_regex(normalized, &ROW_FORMAT_OPTION_REGEX),
        comment: capture_option_with_regex(normalized, &COMMENT_OPTION_REGEX)
            .map(|value| value.replace("''", "'")),
    }
}

fn capture_option_with_regex(options: &str, regex: &Regex) -> Option<String> {
    regex
        .captures(options)
        .and_then(|captures| captures.get(1))
        .map(|matched| matched.as_str().to_string())
}

fn normalize_fragment(fragment: &str) -> String {
    normalize_sql_semantics(fragment)
}

#[cfg(test)]
fn normalize_column_fragment(fragment: &str, table_options: &TableOptions) -> String {
    let context = ColumnNormalizationContext::new(table_options);
    normalize_column_fragment_with_context(fragment, &context)
}

fn normalize_column_fragment_with_context(
    fragment: &str,
    context: &ColumnNormalizationContext,
) -> String {
    let mut normalized = fragment.trim().to_string();

    normalized = normalize_integer_display_width(&normalized);

    if let Some(charset_regex) = &context.default_charset_regex {
        normalized = charset_regex.replace_all(&normalized, "").to_string();
    }

    if let Some(collation_regex) = &context.default_collation_regex {
        normalized = collation_regex.replace_all(&normalized, "").to_string();
    }

    if !contains_not_null_constraint(&normalized) {
        normalized = DEFAULT_NULL_REGEX.replace_all(&normalized, "").to_string();
    }

    normalize_sql_semantics(&normalized)
}

fn normalize_integer_display_width(input: &str) -> String {
    let mut normalized = String::with_capacity(input.len());
    let mut last_end = 0;
    for captures in INTEGER_DISPLAY_WIDTH_REGEX.captures_iter(input) {
        let Some(full_match) = captures.get(0) else {
            continue;
        };
        let Some(type_match) = captures.get(1) else {
            continue;
        };

        let suffix = &input[full_match.end()..];
        let suffix_trimmed = suffix.trim_start();
        if suffix_trimmed.to_uppercase().starts_with("ZEROFILL") {
            continue;
        }

        normalized.push_str(&input[last_end..full_match.start()]);
        normalized.push_str(type_match.as_str());
        last_end = full_match.end();
    }

    if last_end == 0 {
        return input.to_string();
    }

    normalized.push_str(&input[last_end..]);
    normalized
}

fn contains_not_null_constraint(input: &str) -> bool {
    input.to_uppercase().contains("NOT NULL")
}

fn normalize_sql_semantics(input: &str) -> String {
    // `USING BTREE` 是 MySQL 在 SHOW CREATE TABLE 中常见的展示差异，
    // 对 InnoDB 主键和普通 BTREE 索引来说通常不构成实际结构变化。
    let normalized = USING_BTREE_REGEX.replace_all(input.trim(), "");
    WHITESPACE_REGEX
        .replace_all(normalized.trim(), " ")
        .to_string()
}

fn qualify_create_table_sql(create_sql: &str, database: &str, table_name: &str) -> String {
    let qualified_name = format!(
        "{}.{}",
        quote_identifier(database),
        quote_identifier(table_name)
    );
    let if_not_exists_pattern = format!(
        "CREATE TABLE IF NOT EXISTS {}",
        quote_identifier(table_name)
    );
    let plain_pattern = format!("CREATE TABLE {}", quote_identifier(table_name));

    if create_sql.starts_with(&if_not_exists_pattern) {
        return create_sql.replacen(
            &if_not_exists_pattern,
            &format!("CREATE TABLE IF NOT EXISTS {}", qualified_name),
            1,
        );
    }

    if create_sql.starts_with(&plain_pattern) {
        return create_sql.replacen(
            &plain_pattern,
            &format!("CREATE TABLE {}", qualified_name),
            1,
        );
    }

    create_sql.to_string()
}

fn escape_sql_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "''")
}

#[cfg(test)]
mod tests {
    use super::{
        build_structure_line_diff, has_meaningful_structure_difference, normalize_column_fragment,
        normalize_fragment, parse_create_table, TableOptions,
    };

    #[test]
    fn normalize_fragment_ignores_using_btree() {
        let left = "PRIMARY KEY (`menu_group_id`) USING BTREE";
        let right = "PRIMARY KEY (`menu_group_id`)";

        assert_eq!(normalize_fragment(left), normalize_fragment(right));
    }

    #[test]
    fn normalize_column_fragment_ignores_explicit_default_charset_and_collation() {
        let table_options = TableOptions {
            default_charset: Some("utf8mb4".to_string()),
            collation: Some("utf8mb4_general_ci".to_string()),
            ..Default::default()
        };
        let implicit =
            "`address` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '详细地址'";
        let explicit = "`address` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '详细地址'";

        assert_eq!(
            normalize_column_fragment(implicit, &table_options),
            normalize_column_fragment(explicit, &table_options)
        );
    }

    #[test]
    fn normalize_column_fragment_ignores_default_null_and_integer_display_width() {
        let table_options = TableOptions::default();
        let left = "`status` int(11) DEFAULT NULL COMMENT '状态'";
        let right = "`status` int COMMENT '状态'";

        assert_eq!(
            normalize_column_fragment(left, &table_options),
            normalize_column_fragment(right, &table_options)
        );
    }

    #[test]
    fn parsed_create_table_ignores_equivalent_column_charset_display() {
        let source_sql = "CREATE TABLE `user_demo` (
  `user_id` bigint NOT NULL,
  `address` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '详细地址',
  `city_name` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '所在城市',
  PRIMARY KEY (`user_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;";
        let target_sql = "CREATE TABLE `user_demo` (
  `user_id` bigint NOT NULL,
  `address` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '详细地址',
  `city_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '所在城市',
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;";

        let source_definition = parse_create_table(source_sql).expect("source parse");
        let target_definition = parse_create_table(target_sql).expect("target parse");

        assert!(!has_meaningful_structure_difference(
            "demo_db",
            "user_demo",
            &source_definition,
            &target_definition
        ));
    }

    #[test]
    fn parsed_create_table_ignores_equivalent_integer_width_and_default_null_display() {
        let source_sql = "CREATE TABLE `account_demo` (
  `id` bigint NOT NULL,
  `status` int(11) DEFAULT NULL COMMENT '状态',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";
        let target_sql = "CREATE TABLE `account_demo` (
  `id` bigint NOT NULL,
  `status` int COMMENT '状态',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";

        let source_definition = parse_create_table(source_sql).expect("source parse");
        let target_definition = parse_create_table(target_sql).expect("target parse");

        assert!(!has_meaningful_structure_difference(
            "demo_db",
            "account_demo",
            &source_definition,
            &target_definition
        ));
    }

    #[test]
    fn structure_line_diff_marks_real_changed_lines_instead_of_equivalent_display_lines() {
        let source_sql = "CREATE TABLE `user` (
  `user_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '用户id',
  `jis_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '大汉统一认证平台UUID',
  `ztk_guid` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '主体库用户唯一标识',
  `ca_guid` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'ca唯一标识',
  `ca_serial` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'ca序列号',
  `jis_status` int DEFAULT NULL COMMENT '大汉状态',
  `login_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '登录账号',
  `password` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '登录密码',
  `address` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '详细地址',
  `city_name` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '所在城市',
  PRIMARY KEY (`user_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='用户表';";
        let target_sql = "CREATE TABLE `user` (
  `user_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '用户id',
  `jis_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '大汉统一认证平台UUID',
  `ztk_guid` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '主体库用户唯一标识',
  `ca_guid` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'ca唯一标识',
  `ca_serial` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'ca序列号',
  `jis_status` int DEFAULT NULL COMMENT '大汉状态',
  `login_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '登录账号',
  `password` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '登录密码',
  `address` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '详细地址',
  `city_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '所在城市',
  PRIMARY KEY (`user_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='用户表';";

        let source_definition = parse_create_table(source_sql).expect("source parse");
        let target_definition = parse_create_table(target_sql).expect("target parse");
        let line_diff = build_structure_line_diff(&source_definition, &target_definition);

        assert!(line_diff.source_changed_lines.contains(&8));
        assert!(line_diff.target_changed_lines.contains(&8));
        assert!(!line_diff.source_changed_lines.contains(&10));
        assert!(!line_diff.source_changed_lines.contains(&11));
        assert!(!line_diff.target_changed_lines.contains(&10));
        assert!(!line_diff.target_changed_lines.contains(&11));
    }
}

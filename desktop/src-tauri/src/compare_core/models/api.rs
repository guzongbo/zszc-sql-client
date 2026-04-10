use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::compare_core::models::desktop::CompareHistoryPerformance;

fn default_mysql_port() -> u16 {
    3306
}

fn default_true() -> bool {
    true
}

fn default_preview_limit() -> usize {
    20
}

fn default_detail_page_limit() -> usize {
    100
}

fn default_structure_preload_details() -> bool {
    false
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub code: i32,
    pub message: String,
    pub data: Option<T>,
    pub request_id: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T, request_id: Option<String>) -> Self {
        Self {
            code: 0,
            message: "ok".to_string(),
            data: Some(data),
            request_id,
        }
    }

    pub fn error(code: i32, message: impl Into<String>, request_id: Option<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
            request_id,
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DataSourceConnectionConfig {
    pub host: String,
    #[serde(default = "default_mysql_port")]
    pub port: u16,
    pub username: String,
    pub password: String,
}

impl DataSourceConnectionConfig {
    pub fn validate(&self, label: &str) -> Result<(), String> {
        if self.host.trim().is_empty() {
            return Err(format!("{} host 不能为空", label));
        }
        if self.username.trim().is_empty() {
            return Err(format!("{} username 不能为空", label));
        }
        if self.port == 0 {
            return Err(format!("{} port 必须大于 0", label));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DbConnectionConfig {
    pub host: String,
    #[serde(default = "default_mysql_port")]
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
}

impl DbConnectionConfig {
    pub fn validate(&self, label: &str) -> Result<(), String> {
        if self.host.trim().is_empty() {
            return Err(format!("{} host 不能为空", label));
        }
        if self.username.trim().is_empty() {
            return Err(format!("{} username 不能为空", label));
        }
        if self.database.trim().is_empty() {
            return Err(format!("{} database 不能为空", label));
        }
        if self.port == 0 {
            return Err(format!("{} port 必须大于 0", label));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
pub struct DataSourceInspectionRequest {
    pub connection: DataSourceConnectionConfig,
}

impl DataSourceInspectionRequest {
    pub fn validate(&self) -> Result<(), String> {
        self.connection.validate("connection")
    }
}

#[derive(Debug, Serialize)]
pub struct DataSourceInspectionResponse {
    pub server_version: String,
    pub databases: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct TableDiscoveryRequest {
    pub source: DbConnectionConfig,
    pub target: DbConnectionConfig,
}

#[derive(Debug, Serialize)]
pub struct TableDiscoveryResponse {
    pub source_tables: Vec<String>,
    pub target_tables: Vec<String>,
    pub common_tables: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, Default)]
#[serde(rename_all = "snake_case")]
pub enum TableMode {
    #[default]
    All,
    Selected,
}

#[derive(Debug, Deserialize, Clone)]
pub struct TableMapping {
    pub source_table: String,
    pub target_table: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct CompareOptions {
    #[serde(default = "default_true")]
    pub generate_insert: bool,
    #[serde(default = "default_true")]
    pub generate_update: bool,
    #[serde(default = "default_true")]
    pub generate_delete: bool,
    #[serde(default = "default_preview_limit")]
    pub preview_limit: usize,
}

impl Default for CompareOptions {
    fn default() -> Self {
        Self {
            generate_insert: true,
            generate_update: true,
            generate_delete: true,
            preview_limit: default_preview_limit(),
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct CompareRequest {
    pub source: DbConnectionConfig,
    pub target: DbConnectionConfig,
    #[serde(default)]
    pub table_mode: TableMode,
    #[serde(default)]
    pub selected_tables: Vec<String>,
    #[serde(default)]
    pub table_mappings: Vec<TableMapping>,
    #[serde(default)]
    pub options: CompareOptions,
}

impl CompareRequest {
    pub fn validate(&self) -> Result<(), String> {
        self.source.validate("source")?;
        self.target.validate("target")?;

        validate_compare_selector(
            self.table_mode,
            &self.selected_tables,
            &self.table_mappings,
            self.options.preview_limit,
        )?;

        Ok(())
    }
}

fn validate_compare_selector(
    table_mode: TableMode,
    selected_tables: &[String],
    table_mappings: &[TableMapping],
    preview_limit: usize,
) -> Result<(), String> {
    if matches!(table_mode, TableMode::Selected)
        && selected_tables.is_empty()
        && table_mappings.is_empty()
    {
        return Err("table_mode=selected 时必须提供 selected_tables 或 table_mappings".to_string());
    }

    if preview_limit == 0 {
        return Err("preview_limit 必须大于 0".to_string());
    }

    for mapping in table_mappings {
        if mapping.source_table.trim().is_empty() || mapping.target_table.trim().is_empty() {
            return Err("table_mappings 中 source_table/target_table 不能为空".to_string());
        }
    }

    Ok(())
}

#[derive(Debug, Deserialize, Clone)]
pub struct TableSqlSelection {
    pub source_table: String,
    pub target_table: String,
    #[serde(default = "default_true")]
    pub table_enabled: bool,
    #[serde(default = "default_true")]
    pub insert_enabled: bool,
    #[serde(default = "default_true")]
    pub update_enabled: bool,
    #[serde(default = "default_true")]
    pub delete_enabled: bool,
    #[serde(default)]
    pub excluded_insert_signatures: Vec<String>,
    #[serde(default)]
    pub excluded_update_signatures: Vec<String>,
    #[serde(default)]
    pub excluded_delete_signatures: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DownloadSqlRequest {
    #[serde(default)]
    pub compare_id: Option<String>,
    pub compare_request: CompareRequest,
    #[serde(default)]
    pub table_selections: Vec<TableSqlSelection>,
    pub file_name: Option<String>,
}

impl DownloadSqlRequest {
    pub fn validate(&self) -> Result<(), String> {
        self.compare_request.validate()?;

        for selection in &self.table_selections {
            if selection.source_table.trim().is_empty() || selection.target_table.trim().is_empty()
            {
                return Err("table_selections 中 source_table/target_table 不能为空".to_string());
            }
        }

        Ok(())
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct ExportSqlFileRequest {
    #[serde(default)]
    pub compare_id: Option<String>,
    pub compare_request: CompareRequest,
    #[serde(default)]
    pub table_selections: Vec<TableSqlSelection>,
    pub file_path: String,
}

impl ExportSqlFileRequest {
    pub fn validate(&self) -> Result<(), String> {
        self.compare_request.validate()?;

        if self.file_path.trim().is_empty() {
            return Err("file_path 不能为空".to_string());
        }

        for selection in &self.table_selections {
            if selection.source_table.trim().is_empty() || selection.target_table.trim().is_empty()
            {
                return Err("table_selections 中 source_table/target_table 不能为空".to_string());
            }
        }

        Ok(())
    }
}

#[derive(Debug, Serialize)]
pub struct ExportSqlFileResponse {
    pub file_path: String,
    pub insert_count: usize,
    pub update_count: usize,
    pub delete_count: usize,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompareDetailType {
    Insert,
    Update,
    Delete,
}

#[derive(Debug, Deserialize, Clone)]
pub struct CompareDetailPageRequest {
    #[serde(default)]
    pub compare_id: Option<String>,
    pub compare_request: CompareRequest,
    pub source_table: String,
    pub target_table: String,
    pub detail_type: CompareDetailType,
    pub expected_total: usize,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_detail_page_limit")]
    pub limit: usize,
}

impl CompareDetailPageRequest {
    pub fn validate(&self) -> Result<(), String> {
        self.compare_request.validate()?;

        if self.source_table.trim().is_empty() || self.target_table.trim().is_empty() {
            return Err("source_table/target_table 不能为空".to_string());
        }

        if self.limit == 0 {
            return Err("limit 必须大于 0".to_string());
        }

        if self.expected_total == 0 {
            return Err("expected_total 必须大于 0".to_string());
        }

        Ok(())
    }
}

#[derive(Debug, Serialize)]
pub struct RowTableItem {
    pub signature: String,
    pub values: Vec<JsonValue>,
}

#[derive(Debug, Serialize)]
pub struct CompareDetailPageResponse {
    pub source_table: String,
    pub target_table: String,
    pub detail_type: CompareDetailType,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub has_more: bool,
    pub row_columns: Vec<String>,
    pub row_items: Vec<RowTableItem>,
    pub update_items: Vec<UpdateSample>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CompareSummary {
    pub total_tables: usize,
    pub compared_tables: usize,
    pub skipped_tables: usize,
    pub total_insert_count: usize,
    pub total_update_count: usize,
    pub total_delete_count: usize,
    pub total_sql_statements: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct SkippedTable {
    pub source_table: String,
    pub target_table: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct UpdateSample {
    pub signature: String,
    pub key: JsonValue,
    pub source_row: JsonValue,
    pub target_row: JsonValue,
    pub diff_columns: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct RowSample {
    pub signature: String,
    pub row: JsonValue,
}

#[derive(Debug, Serialize, Clone)]
pub struct TableCompareResult {
    pub source_table: String,
    pub target_table: String,
    pub key_columns: Vec<String>,
    pub compared_columns: Vec<String>,
    pub compare_mode: String,
    pub insert_count: usize,
    pub update_count: usize,
    pub delete_count: usize,
    pub warnings: Vec<String>,
    pub sample_inserts: Vec<RowSample>,
    pub sample_updates: Vec<UpdateSample>,
    pub sample_deletes: Vec<RowSample>,
}

impl TableCompareResult {
    pub fn new(source_table: String, target_table: String) -> Self {
        Self {
            source_table,
            target_table,
            key_columns: Vec::new(),
            compared_columns: Vec::new(),
            compare_mode: "keyed".to_string(),
            insert_count: 0,
            update_count: 0,
            delete_count: 0,
            warnings: Vec::new(),
            sample_inserts: Vec::new(),
            sample_updates: Vec::new(),
            sample_deletes: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompareTaskStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Canceled,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompareTaskPhase {
    Pending,
    DiscoverTables,
    PrepareTable,
    TableChecksum,
    KeyedHashScan,
    ChunkHashScan,
    SourceStageLoad,
    TargetStageLoad,
    FinalizeCache,
    Completed,
}

#[derive(Debug, Serialize, Clone)]
pub struct CompareTaskPhaseProgress {
    pub current: usize,
    pub total: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct CompareTaskStartResponse {
    pub compare_id: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct CompareTaskProgressResponse {
    pub compare_id: String,
    pub status: CompareTaskStatus,
    pub total_tables: usize,
    pub completed_tables: usize,
    pub current_table: Option<String>,
    pub current_phase: Option<CompareTaskPhase>,
    pub current_phase_progress: Option<CompareTaskPhaseProgress>,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CompareTaskResultResponse {
    pub compare_id: String,
    pub status: CompareTaskStatus,
    pub result: Option<CompareResponse>,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CompareTaskCancelResponse {
    pub compare_id: String,
    pub accepted: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct CompareResponse {
    pub compare_id: Option<String>,
    pub summary: CompareSummary,
    pub skipped_tables: Vec<SkippedTable>,
    pub table_results: Vec<TableCompareResult>,
    pub sql_script: String,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct StructureCompareOptions {
    #[serde(default)]
    pub detail_concurrency: Option<usize>,
    #[serde(default = "default_structure_preload_details")]
    pub preload_details: bool,
}

#[derive(Debug, Deserialize, Clone)]
pub struct StructureCompareRequest {
    pub source: DbConnectionConfig,
    pub target: DbConnectionConfig,
    #[serde(default)]
    pub options: StructureCompareOptions,
}

impl StructureCompareRequest {
    pub fn validate(&self) -> Result<(), String> {
        self.source.validate("source")?;
        self.target.validate("target")?;
        Ok(())
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct StructureTableItem {
    pub table_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_sql: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_sql: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_sql: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_changed_lines: Vec<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub target_changed_lines: Vec<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct StructureCompareSummary {
    pub source_table_count: usize,
    pub target_table_count: usize,
    pub added_table_count: usize,
    pub modified_table_count: usize,
    pub deleted_table_count: usize,
}

#[derive(Debug, Serialize)]
pub struct StructureCompareResponse {
    pub summary: StructureCompareSummary,
    pub added_tables: Vec<StructureTableItem>,
    pub modified_tables: Vec<StructureTableItem>,
    pub deleted_tables: Vec<StructureTableItem>,
    pub performance: CompareHistoryPerformance,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StructureDetailCategory {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Deserialize, Clone)]
pub struct StructureCompareDetailRequest {
    pub compare_request: StructureCompareRequest,
    pub category: StructureDetailCategory,
    pub table_name: String,
}

impl StructureCompareDetailRequest {
    pub fn validate(&self) -> Result<(), String> {
        self.compare_request.validate()?;
        if self.table_name.trim().is_empty() {
            return Err("table_name 不能为空".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Serialize)]
pub struct StructureCompareDetailResponse {
    pub category: StructureDetailCategory,
    pub table_name: String,
    pub detail: StructureTableItem,
    pub performance: CompareHistoryPerformance,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct StructureSqlSelection {
    #[serde(default)]
    pub added_tables: Vec<String>,
    #[serde(default)]
    pub modified_tables: Vec<String>,
    #[serde(default)]
    pub deleted_tables: Vec<String>,
}

impl StructureSqlSelection {
    pub fn validate(&self) -> Result<(), String> {
        for table_name in self
            .added_tables
            .iter()
            .chain(self.modified_tables.iter())
            .chain(self.deleted_tables.iter())
        {
            if table_name.trim().is_empty() {
                return Err("structure_sql_selection 中 table_name 不能为空".to_string());
            }
        }

        Ok(())
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct StructureExportSqlFileRequest {
    pub compare_request: StructureCompareRequest,
    #[serde(default)]
    pub selection: StructureSqlSelection,
    pub file_path: String,
}

impl StructureExportSqlFileRequest {
    pub fn validate(&self) -> Result<(), String> {
        self.compare_request.validate()?;

        if self.file_path.trim().is_empty() {
            return Err("file_path 不能为空".to_string());
        }

        self.selection.validate()
    }
}

#[derive(Debug, Serialize)]
pub struct StructureExportSqlFileResponse {
    pub file_path: String,
    pub added_count: usize,
    pub modified_count: usize,
    pub deleted_count: usize,
}

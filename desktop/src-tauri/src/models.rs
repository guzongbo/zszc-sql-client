use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::BTreeMap;

pub type JsonRecord = BTreeMap<String, JsonValue>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AppBootstrap {
    pub app_name: String,
    pub storage_engine: String,
    pub app_data_dir: String,
    pub connection_profiles: Vec<ConnectionProfile>,
    pub data_source_groups: Vec<DataSourceGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConnectionProfile {
    pub id: String,
    pub group_name: Option<String>,
    pub data_source_name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SaveConnectionProfilePayload {
    pub id: Option<String>,
    pub group_name: Option<String>,
    pub data_source_name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataSourceGroup {
    pub id: String,
    pub group_name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CreateDataSourceGroupPayload {
    pub group_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RenameDataSourceGroupPayload {
    pub group_id: String,
    pub group_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RenameDataSourceGroupResult {
    pub group_id: String,
    pub previous_group_name: String,
    pub group_name: String,
    pub affected_profile_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DeleteDataSourceGroupResult {
    pub group_id: String,
    pub group_name: String,
    pub affected_profile_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DatabaseEntry {
    pub name: String,
    pub table_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CreateDatabasePayload {
    pub profile_id: String,
    pub database_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TableEntry {
    pub name: String,
    pub table_rows: Option<u64>,
    pub column_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct LoadSqlAutocompletePayload {
    pub profile_id: String,
    pub database_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SqlAutocompleteColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
    pub auto_increment: bool,
    pub comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SqlAutocompleteTable {
    pub name: String,
    pub columns: Vec<SqlAutocompleteColumn>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SqlAutocompleteSchema {
    pub profile_id: String,
    pub database_name: String,
    pub tables: Vec<SqlAutocompleteTable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TableColumnSummary {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct TableColumn {
    pub name: String,
    pub data_type: String,
    pub full_data_type: String,
    pub length: Option<u32>,
    pub scale: Option<u32>,
    pub nullable: bool,
    pub primary_key: bool,
    pub auto_increment: bool,
    pub default_value: Option<String>,
    pub comment: String,
    pub ordinal_position: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TableDesign {
    pub profile_id: String,
    pub database_name: String,
    pub table_name: String,
    pub columns: Vec<TableColumn>,
    pub ddl: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TableIdentity {
    pub profile_id: String,
    pub database_name: String,
    pub table_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TableDesignMutationPayload {
    pub profile_id: String,
    pub database_name: String,
    pub table_name: String,
    pub columns: Vec<TableColumn>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CreateTablePayload {
    pub profile_id: String,
    pub database_name: String,
    pub table_name: String,
    pub columns: Vec<TableColumn>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SqlPreview {
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TableDataColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
    pub auto_increment: bool,
    pub default_value: Option<String>,
    pub comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TableDataRow {
    pub row_key: Option<JsonRecord>,
    pub values: JsonRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TableDataPage {
    pub profile_id: String,
    pub database_name: String,
    pub table_name: String,
    pub columns: Vec<TableDataColumn>,
    pub rows: Vec<TableDataRow>,
    pub primary_keys: Vec<String>,
    pub offset: u64,
    pub limit: u64,
    pub total_rows: u64,
    pub row_count_exact: bool,
    pub editable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ExecuteSqlPayload {
    pub profile_id: String,
    pub database_name: Option<String>,
    pub sql: String,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SqlConsoleResult {
    pub profile_id: String,
    pub database_name: Option<String>,
    pub executed_sql: String,
    pub result_kind: String,
    pub columns: Vec<TableDataColumn>,
    pub rows: Vec<TableDataRow>,
    pub affected_rows: u64,
    pub offset: u64,
    pub limit: u64,
    pub total_rows: u64,
    pub row_count_exact: bool,
    pub truncated: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct LoadTableDataPayload {
    pub profile_id: String,
    pub database_name: String,
    pub table_name: String,
    pub where_clause: Option<String>,
    pub order_by_clause: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct InsertedRowPayload {
    pub values: JsonRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct UpdatedRowPayload {
    pub row_key: JsonRecord,
    pub values: JsonRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DeletedRowPayload {
    pub row_key: JsonRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ApplyTableDataChangesPayload {
    pub profile_id: String,
    pub database_name: String,
    pub table_name: String,
    pub transaction_mode: String,
    pub inserted_rows: Vec<InsertedRowPayload>,
    pub updated_rows: Vec<UpdatedRowPayload>,
    pub deleted_rows: Vec<DeletedRowPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MutationResult {
    pub affected_rows: u64,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TableDdl {
    pub ddl: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConnectionTestResult {
    pub server_version: String,
    pub current_database: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ImportedConnectionProfileItem {
    pub id: String,
    pub data_source_name: String,
    pub password_resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SkippedImportItem {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ImportConnectionProfilesResult {
    pub canceled: bool,
    pub file_path: Option<String>,
    pub total_count: usize,
    pub created_count: usize,
    pub updated_count: usize,
    pub unresolved_password_count: usize,
    pub skipped_count: usize,
    pub imported_items: Vec<ImportedConnectionProfileItem>,
    pub skipped_items: Vec<SkippedImportItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CompareTableDiscoveryRequest {
    pub source_profile_id: String,
    pub source_database_name: String,
    pub target_profile_id: String,
    pub target_database_name: String,
}

impl CompareTableDiscoveryRequest {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            !self.source_profile_id.trim().is_empty(),
            "源端数据源不能为空"
        );
        ensure!(
            !self.source_database_name.trim().is_empty(),
            "源端数据库不能为空"
        );
        ensure!(
            !self.target_profile_id.trim().is_empty(),
            "目标端数据源不能为空"
        );
        ensure!(
            !self.target_database_name.trim().is_empty(),
            "目标端数据库不能为空"
        );
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CompareTableDiscoveryResponse {
    pub source_tables: Vec<String>,
    pub target_tables: Vec<String>,
    pub common_tables: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataCompareRequest {
    pub source_profile_id: String,
    pub source_database_name: String,
    pub target_profile_id: String,
    pub target_database_name: String,
    pub table_mode: String,
    pub selected_tables: Vec<String>,
    pub preview_limit: Option<usize>,
}

impl DataCompareRequest {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            !self.source_profile_id.trim().is_empty(),
            "源端数据源不能为空"
        );
        ensure!(
            !self.source_database_name.trim().is_empty(),
            "源端数据库不能为空"
        );
        ensure!(
            !self.target_profile_id.trim().is_empty(),
            "目标端数据源不能为空"
        );
        ensure!(
            !self.target_database_name.trim().is_empty(),
            "目标端数据库不能为空"
        );
        ensure!(
            matches!(self.table_mode.as_str(), "all" | "selected"),
            "table_mode 仅支持 all 或 selected"
        );
        if self.table_mode == "selected" {
            ensure!(
                !self.selected_tables.is_empty(),
                "selected 模式至少需要选择一张表"
            );
        }
        if let Some(preview_limit) = self.preview_limit {
            ensure!(preview_limit > 0, "preview_limit 必须大于 0");
        }
        Ok(())
    }

    pub fn normalized_preview_limit(&self) -> usize {
        self.preview_limit.unwrap_or(20).clamp(1, 100)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RowSample {
    pub signature: String,
    pub row: JsonRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct UpdateSample {
    pub signature: String,
    pub key: JsonRecord,
    pub source_row: JsonRecord,
    pub target_row: JsonRecord,
    pub diff_columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SkippedTable {
    pub source_table: String,
    pub target_table: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CompareSummary {
    pub total_tables: usize,
    pub compared_tables: usize,
    pub skipped_tables: usize,
    pub total_insert_count: usize,
    pub total_update_count: usize,
    pub total_delete_count: usize,
    pub total_sql_statements: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataCompareResponse {
    pub compare_id: Option<String>,
    pub summary: CompareSummary,
    pub skipped_tables: Vec<SkippedTable>,
    pub table_results: Vec<TableCompareResult>,
    pub performance: CompareHistoryPerformance,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompareDetailType {
    Insert,
    Update,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CompareDetailPageRequest {
    pub compare_id: Option<String>,
    pub compare_request: DataCompareRequest,
    pub source_table: String,
    pub target_table: String,
    pub detail_type: CompareDetailType,
    pub expected_total: Option<usize>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

impl CompareDetailPageRequest {
    pub fn validate(&self) -> Result<()> {
        self.compare_request.validate()?;
        ensure!(
            !self.source_table.trim().is_empty(),
            "source_table 不能为空"
        );
        ensure!(
            !self.target_table.trim().is_empty(),
            "target_table 不能为空"
        );
        if let Some(limit) = self.limit {
            ensure!(limit > 0, "limit 必须大于 0");
        }
        Ok(())
    }

    pub fn normalized_limit(&self) -> usize {
        self.limit.unwrap_or(50).clamp(1, 500)
    }

    pub fn normalized_offset(&self) -> usize {
        self.offset.unwrap_or(0)
    }

    pub fn normalized_expected_total(&self) -> usize {
        self.expected_total.unwrap_or(0)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CompareDetailPageResponse {
    pub source_table: String,
    pub target_table: String,
    pub detail_type: CompareDetailType,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub has_more: bool,
    pub row_columns: Vec<String>,
    pub row_items: Vec<RowSample>,
    pub update_items: Vec<UpdateSample>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompareTaskStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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
    CompareTable,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CompareTaskPhaseProgress {
    pub current: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CompareTaskStartResponse {
    pub compare_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CompareTaskResultResponse {
    pub compare_id: String,
    pub status: CompareTaskStatus,
    pub result: Option<DataCompareResponse>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CompareTaskCancelResponse {
    pub compare_id: String,
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StructureCompareRequest {
    pub source_profile_id: String,
    pub source_database_name: String,
    pub target_profile_id: String,
    pub target_database_name: String,
    pub detail_concurrency: Option<usize>,
    pub preload_details: Option<bool>,
}

impl StructureCompareRequest {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            !self.source_profile_id.trim().is_empty(),
            "源端数据源不能为空"
        );
        ensure!(
            !self.source_database_name.trim().is_empty(),
            "源端数据库不能为空"
        );
        ensure!(
            !self.target_profile_id.trim().is_empty(),
            "目标端数据源不能为空"
        );
        ensure!(
            !self.target_database_name.trim().is_empty(),
            "目标端数据库不能为空"
        );
        if let Some(detail_concurrency) = self.detail_concurrency {
            ensure!(detail_concurrency > 0, "detail_concurrency 必须大于 0");
        }
        Ok(())
    }

    pub fn normalized_preload_details(&self) -> bool {
        self.preload_details.unwrap_or(false)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StructureCompareSummary {
    pub source_table_count: usize,
    pub target_table_count: usize,
    pub added_table_count: usize,
    pub modified_table_count: usize,
    pub deleted_table_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CompareHistoryPerformanceStage {
    pub key: String,
    pub label: String,
    pub elapsed_ms: u64,
    pub item_count: Option<usize>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct CompareHistoryPerformance {
    pub total_elapsed_ms: u64,
    pub stages: Vec<CompareHistoryPerformanceStage>,
    pub max_parallelism: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StructureTableItem {
    pub table_name: String,
    pub preview_sql: Option<String>,
    pub source_sql: Option<String>,
    pub target_sql: Option<String>,
    pub source_changed_lines: Vec<usize>,
    pub target_changed_lines: Vec<usize>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StructureCompareResponse {
    pub summary: StructureCompareSummary,
    pub added_tables: Vec<StructureTableItem>,
    pub modified_tables: Vec<StructureTableItem>,
    pub deleted_tables: Vec<StructureTableItem>,
    pub performance: CompareHistoryPerformance,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StructureDetailCategory {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StructureCompareDetailRequest {
    pub compare_request: StructureCompareRequest,
    pub category: StructureDetailCategory,
    pub table_name: String,
}

impl StructureCompareDetailRequest {
    pub fn validate(&self) -> Result<()> {
        self.compare_request.validate()?;
        ensure!(!self.table_name.trim().is_empty(), "table_name 不能为空");
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StructureCompareDetailResponse {
    pub category: StructureDetailCategory,
    pub table_name: String,
    pub detail: StructureTableItem,
    pub performance: CompareHistoryPerformance,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TableSqlSelection {
    pub source_table: String,
    pub target_table: String,
    pub table_enabled: bool,
    pub insert_enabled: bool,
    pub update_enabled: bool,
    pub delete_enabled: bool,
    pub excluded_insert_signatures: Vec<String>,
    pub excluded_update_signatures: Vec<String>,
    pub excluded_delete_signatures: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ExportSqlFileRequest {
    pub compare_id: Option<String>,
    pub compare_request: DataCompareRequest,
    pub table_selections: Vec<TableSqlSelection>,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ExportSqlFileResponse {
    pub file_path: String,
    pub insert_count: usize,
    pub update_count: usize,
    pub delete_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct StructureSqlSelection {
    pub added_tables: Vec<String>,
    pub modified_tables: Vec<String>,
    pub deleted_tables: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StructureExportSqlFileRequest {
    pub compare_request: StructureCompareRequest,
    pub selection: StructureSqlSelection,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StructureExportSqlFileResponse {
    pub file_path: String,
    pub added_count: usize,
    pub modified_count: usize,
    pub deleted_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SaveFileDialogResult {
    pub canceled: bool,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ChooseFilePayload {
    pub default_file_name: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CompareHistoryType {
    #[default]
    Data,
    Structure,
}

impl CompareHistoryType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Data => "data",
            Self::Structure => "structure",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct CompareHistoryTablePair {
    pub source_table: String,
    pub target_table: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct CompareHistoryTableDetail {
    pub data_tables: Vec<CompareHistoryTablePair>,
    pub added_tables: Vec<String>,
    pub modified_tables: Vec<String>,
    pub deleted_tables: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CompareHistoryItem {
    pub id: i64,
    pub history_type: CompareHistoryType,
    pub source_profile_id: Option<String>,
    pub source_data_source_name: String,
    pub source_database: String,
    pub target_profile_id: Option<String>,
    pub target_data_source_name: String,
    pub target_database: String,
    pub table_mode: String,
    pub selected_tables: Vec<String>,
    pub table_detail: CompareHistoryTableDetail,
    pub performance: CompareHistoryPerformance,
    pub source_table_count: usize,
    pub target_table_count: usize,
    pub total_tables: usize,
    pub compared_tables: usize,
    pub insert_count: usize,
    pub update_count: usize,
    pub delete_count: usize,
    pub structure_added_count: usize,
    pub structure_modified_count: usize,
    pub structure_deleted_count: usize,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CompareHistoryInput {
    pub history_type: CompareHistoryType,
    pub source_profile_id: Option<String>,
    pub source_data_source_name: String,
    pub source_database: String,
    pub target_profile_id: Option<String>,
    pub target_data_source_name: String,
    pub target_database: String,
    pub table_mode: String,
    pub selected_tables: Vec<String>,
    pub table_detail: CompareHistoryTableDetail,
    pub performance: CompareHistoryPerformance,
    pub source_table_count: usize,
    pub target_table_count: usize,
    pub total_tables: usize,
    pub compared_tables: usize,
    pub insert_count: usize,
    pub update_count: usize,
    pub delete_count: usize,
    pub structure_added_count: usize,
    pub structure_modified_count: usize,
    pub structure_deleted_count: usize,
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
    pub is_packaged: bool,
    pub data_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RuntimeSummary {
    pub cpu_percent: f32,
    pub memory_mb: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessMetric {
    pub label: String,
    pub pid: u32,
    pub cpu_percent: f32,
    pub memory_mb: f64,
    pub available: bool,
    pub service_name: String,
    #[serde(rename = "type")]
    pub process_type: String,
}

impl ProcessMetric {
    pub fn unavailable(label: &str, service_name: &str, process_type: &str) -> Self {
        Self {
            label: label.to_string(),
            pid: 0,
            cpu_percent: 0.0,
            memory_mb: 0.0,
            available: false,
            service_name: service_name.to_string(),
            process_type: process_type.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeMetrics {
    pub total_cpu_percent: f32,
    pub total_memory_mb: f64,
    pub client_total: RuntimeSummary,
    pub backend: ProcessMetric,
    pub processes: Vec<ProcessMetric>,
    pub sampled_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataSource {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub remark: Option<String>,
    pub last_connected_at: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataSourceInput {
    pub id: Option<i64>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub remark: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareConfig {
    pub id: i64,
    pub name: String,
    pub source_data_source_id: i64,
    pub source_database: String,
    pub target_data_source_id: i64,
    pub target_database: String,
    pub table_mode: String,
    pub selected_tables: Vec<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareConfigInput {
    pub id: Option<i64>,
    pub name: String,
    pub source_data_source_id: i64,
    pub source_database: String,
    pub target_data_source_id: i64,
    pub target_database: String,
    pub table_mode: String,
    pub selected_tables: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CompareHistoryType {
    #[default]
    Data,
    Structure,
}

impl CompareHistoryType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Data => "data",
            Self::Structure => "structure",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CompareHistoryTablePair {
    pub source_table: String,
    pub target_table: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CompareHistoryTableDetail {
    #[serde(default)]
    pub data_tables: Vec<CompareHistoryTablePair>,
    #[serde(default)]
    pub added_tables: Vec<String>,
    #[serde(default)]
    pub modified_tables: Vec<String>,
    #[serde(default)]
    pub deleted_tables: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CompareHistoryPerformanceStage {
    pub key: String,
    pub label: String,
    pub elapsed_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CompareHistoryPerformance {
    pub total_elapsed_ms: u64,
    #[serde(default)]
    pub stages: Vec<CompareHistoryPerformanceStage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_parallelism: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareHistoryItem {
    pub id: i64,
    pub history_type: CompareHistoryType,
    pub source_data_source_id: Option<i64>,
    pub source_data_source_name: String,
    pub source_database: String,
    pub target_data_source_id: Option<i64>,
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
pub struct CompareHistoryInput {
    pub history_type: CompareHistoryType,
    pub source_data_source_id: Option<i64>,
    pub source_data_source_name: String,
    pub source_database: String,
    pub target_data_source_id: Option<i64>,
    pub target_data_source_name: String,
    pub target_database: String,
    pub table_mode: String,
    pub selected_tables: Vec<String>,
    #[serde(default)]
    pub table_detail: CompareHistoryTableDetail,
    #[serde(default)]
    pub performance: CompareHistoryPerformance,
    #[serde(default)]
    pub source_table_count: usize,
    #[serde(default)]
    pub target_table_count: usize,
    pub total_tables: usize,
    pub compared_tables: usize,
    pub insert_count: usize,
    pub update_count: usize,
    pub delete_count: usize,
    #[serde(default)]
    pub structure_added_count: usize,
    #[serde(default)]
    pub structure_modified_count: usize,
    #[serde(default)]
    pub structure_deleted_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedDataSourceItem {
    pub id: i64,
    pub name: String,
    pub password_resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkippedImportItem {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportDataSourcesResult {
    pub canceled: bool,
    pub file_path: Option<String>,
    pub total_count: usize,
    pub created_count: usize,
    pub updated_count: usize,
    pub unresolved_password_count: usize,
    pub skipped_count: usize,
    pub imported_items: Vec<ImportedDataSourceItem>,
    pub skipped_items: Vec<SkippedImportItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveFileDialogResult {
    pub canceled: bool,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChooseFilePayload {
    pub default_file_name: Option<String>,
}

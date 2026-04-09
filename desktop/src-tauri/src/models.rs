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

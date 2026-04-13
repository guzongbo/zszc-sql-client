use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RpcRequest {
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: JsonValue,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RpcResponse {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<JsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RpcError {
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct AppBootstrapResponse {
    pub configs: Vec<DingtalkConfig>,
    pub history: HistoryListResponse,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct DingtalkConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub app_id: String,
    pub app_secret: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_test_result: Option<ConnectionTestResult>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct ConnectionTestResult {
    pub tested_at: String,
    pub success: bool,
    pub message: String,
    pub permissions: Vec<PermissionStatus>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct PermissionStatus {
    pub key: String,
    pub label: String,
    pub status: PermissionCheckStatus,
    pub detail: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionCheckStatus {
    Enabled,
    Disabled,
    Skipped,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct QueryRecordSummary {
    pub id: String,
    pub config_id: String,
    pub config_name: String,
    pub queried_at: String,
    pub status: QueryStatus,
    pub total_count: i64,
    pub added_count: i64,
    pub removed_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_record_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_queried_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_total_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compare_rate: Option<f64>,
    pub compare_rate_label: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QueryStatus {
    Success,
    Failed,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct QueryDetailResponse {
    pub record: QueryRecordSummary,
    pub selected_tab: QueryUserTab,
    pub keyword: String,
    pub page: u32,
    pub page_size: u32,
    pub total_items: i64,
    pub total_pages: u32,
    pub users: Vec<QueryUserItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct QueryUserItem {
    pub user_id: String,
    pub user_name: String,
    pub change_type: ChangeType,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChangeType {
    None,
    Added,
    Removed,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum QueryUserTab {
    #[default]
    All,
    Added,
    Removed,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct HistoryListResponse {
    pub items: Vec<QueryRecordSummary>,
    pub page: u32,
    pub page_size: u32,
    pub total_items: i64,
    pub total_pages: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConfigSaveParams {
    pub id: Option<String>,
    #[serde(default)]
    pub name: String,
    pub base_url: String,
    pub app_id: String,
    pub app_secret: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConfigDeleteParams {
    pub config_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConnectionTestParams {
    pub config_id: Option<String>,
    pub base_url: String,
    pub app_id: String,
    pub app_secret: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct QueryRunParams {
    pub config_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct QueryLatestParams {
    pub config_id: String,
    #[serde(default)]
    pub tab: QueryUserTab,
    #[serde(default)]
    pub keyword: String,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_page_size")]
    pub page_size: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct QueryDetailParams {
    pub query_id: String,
    #[serde(default)]
    pub tab: QueryUserTab,
    #[serde(default)]
    pub keyword: String,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_page_size")]
    pub page_size: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct HistoryListParams {
    #[serde(default)]
    pub config_id: String,
    #[serde(default)]
    pub start_date: String,
    #[serde(default)]
    pub end_date: String,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_history_page_size")]
    pub page_size: u32,
}

pub fn default_page() -> u32 {
    1
}

pub fn default_page_size() -> u32 {
    10
}

pub fn default_history_page_size() -> u32 {
    8
}

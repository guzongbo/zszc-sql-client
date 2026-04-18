use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferLocalNode {
    pub alias: String,
    pub fingerprint: String,
    pub port: u16,
    pub protocol: String,
    pub registration_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferNode {
    pub id: String,
    pub alias: String,
    pub fingerprint: String,
    pub device_model: Option<String>,
    pub device_type: String,
    pub ip: String,
    pub port: u16,
    pub protocol: String,
    pub favorite: bool,
    pub source: String,
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferFavoriteNode {
    pub fingerprint: String,
    pub alias: String,
    pub device_model: Option<String>,
    pub device_type: String,
    pub last_known_ip: Option<String>,
    pub last_known_port: Option<u16>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferPublishedFile {
    pub id: String,
    pub file_name: String,
    pub relative_path: Option<String>,
    pub size: u64,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferPublishedShare {
    pub id: String,
    pub title: String,
    pub scope: String,
    pub file_count: u64,
    pub total_bytes: u64,
    pub created_at: String,
    pub updated_at: String,
    pub files: Vec<DataTransferPublishedFile>,
    pub allowed_fingerprints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferTaskFile {
    pub id: String,
    pub file_name: String,
    pub size: u64,
    pub transferred_bytes: u64,
    pub status: String,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferTask {
    pub id: String,
    pub kind: String,
    pub direction: String,
    pub peer_alias: String,
    pub peer_fingerprint: String,
    pub status: String,
    pub status_message: Option<String>,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub progress_percent: f64,
    pub current_file_name: Option<String>,
    pub started_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
    pub files: Vec<DataTransferTaskFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferSnapshot {
    pub local_node: DataTransferLocalNode,
    pub default_download_dir: String,
    pub nodes: Vec<DataTransferNode>,
    pub favorite_nodes: Vec<DataTransferFavoriteNode>,
    pub published_shares: Vec<DataTransferPublishedShare>,
    pub tasks: Vec<DataTransferTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferRemoteFile {
    pub id: String,
    pub file_name: String,
    pub relative_path: Option<String>,
    pub size: u64,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferRemoteShare {
    pub id: String,
    pub owner_alias: String,
    pub owner_fingerprint: String,
    pub title: String,
    pub file_count: u64,
    pub total_bytes: u64,
    pub created_at: String,
    pub files: Vec<DataTransferRemoteFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferRemoteShareResponse {
    pub node_id: String,
    pub shares: Vec<DataTransferRemoteShare>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferTaskStartResponse {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferTaskCancelResponse {
    pub task_id: String,
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferRegistrationPayload {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferFavoritePayload {
    pub fingerprint: String,
    pub alias: String,
    pub device_model: Option<String>,
    pub device_type: String,
    pub last_known_ip: Option<String>,
    pub last_known_port: Option<u16>,
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferDirectSendPayload {
    pub node_id: String,
    pub file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferAcceptIncomingTaskPayload {
    pub task_id: String,
    pub destination_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferRejectIncomingTaskPayload {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferPublishPayload {
    pub file_paths: Vec<String>,
    pub scope: String,
    pub allowed_fingerprints: Vec<String>,
    #[serde(default)]
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferDownloadSharePayload {
    pub node_id: String,
    pub share_id: String,
    pub file_ids: Vec<String>,
    pub destination_dir: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferRemoveSharePayload {
    pub share_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferLoadRemoteSharesPayload {
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferChooseFilesResult {
    pub canceled: bool,
    pub file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferChooseFolderResult {
    pub canceled: bool,
    pub directory_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferSelectedFile {
    pub file_path: String,
    pub file_name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DataTransferResolveSelectedFilesPayload {
    pub file_paths: Vec<String>,
}

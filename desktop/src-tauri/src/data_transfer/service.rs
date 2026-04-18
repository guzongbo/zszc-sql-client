use super::models::{
    DataTransferDirectSendPayload, DataTransferDownloadSharePayload, DataTransferFavoriteNode,
    DataTransferFavoritePayload, DataTransferLoadRemoteSharesPayload, DataTransferLocalNode,
    DataTransferNode, DataTransferPublishPayload, DataTransferPublishedFile,
    DataTransferPublishedShare, DataTransferRemoteFile, DataTransferRemoteShare,
    DataTransferRemoteShareResponse, DataTransferSnapshot, DataTransferTask,
    DataTransferTaskCancelResponse, DataTransferTaskFile, DataTransferTaskStartResponse,
};
use crate::local_store::{
    DataTransferPartialRecord, DataTransferPublishedFileRecord, DataTransferPublishedShareRecord,
    LocalStore,
};
use actix_web::http::header::{
    self, ContentDisposition, DispositionParam, DispositionType, HeaderValue,
};
use actix_web::{App, Error as ActixError, HttpRequest, HttpResponse, HttpServer, Responder, web};
use anyhow::{Context, Result, anyhow, ensure};
use chrono::Utc;
use futures::{StreamExt, stream::FuturesUnordered};
use if_addrs::{IfAddr, get_if_addrs};
use regex::Regex;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use socket2::{Domain, Protocol, Socket, Type};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use sysinfo::System;
use tokio::fs::{self, File, OpenOptions};
use tokio::io::{AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::net::UdpSocket;
use tokio::sync::{Mutex, RwLock, Semaphore, watch};
use tokio_util::io::ReaderStream;
use tracing::{error, info, warn};
use uuid::Uuid;

const DATA_TRANSFER_PORT: u16 = 53317;
const MULTICAST_ADDR: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 167);
const NODE_TTL: Duration = Duration::from_secs(45);
const ANNOUNCE_INTERVAL: Duration = Duration::from_secs(6);

#[derive(Clone)]
pub struct DataTransferService {
    app_data_dir: PathBuf,
    default_download_dir: PathBuf,
    http_client: reqwest::Client,
    local_store: Arc<LocalStore>,
    server_handle: Arc<Mutex<Option<actix_web::dev::ServerHandle>>>,
    shutdown_tx: watch::Sender<bool>,
    state: Arc<RwLock<ServiceState>>,
}

#[derive(Default)]
struct ServiceState {
    favorite_nodes: HashMap<String, DataTransferFavoriteNode>,
    incoming_sessions: HashMap<String, IncomingSession>,
    nodes: HashMap<String, NodeRuntime>,
    published_shares: HashMap<String, LocalShareRuntime>,
    registration_enabled: bool,
    tasks: HashMap<String, TaskRuntime>,
}

#[derive(Clone)]
struct NodeRuntime {
    alias: String,
    device_model: Option<String>,
    device_type: String,
    fingerprint: String,
    ip: String,
    last_seen_at: String,
    last_seen_instant: Instant,
    port: u16,
    protocol: String,
    source: String,
}

#[derive(Clone)]
struct IncomingSession {
    peer_alias: String,
    peer_fingerprint: String,
    peer_ip: String,
    status: IncomingSessionStatus,
    task_id: String,
    files: HashMap<String, IncomingSessionFile>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum IncomingSessionStatus {
    Pending,
    Accepted,
    Rejected,
}

impl IncomingSessionStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
        }
    }
}

#[derive(Clone)]
struct IncomingSessionFile {
    file_id: String,
    file_name: String,
    size: u64,
    final_path: PathBuf,
    resource_id: String,
    temp_path: PathBuf,
    token: String,
}

#[derive(Clone)]
struct LocalShareRuntime {
    allowed_fingerprints: Vec<String>,
    created_at: String,
    files: Vec<LocalShareFileRuntime>,
    id: String,
    password_hash: String,
    scope: String,
    title: String,
    total_bytes: u64,
    updated_at: String,
}

#[derive(Clone)]
struct LocalShareFileRuntime {
    file_id: String,
    file_name: String,
    local_path: PathBuf,
    mime_type: String,
    relative_path: Option<String>,
    size: u64,
}

struct TaskRuntime {
    cancel_flag: Arc<AtomicBool>,
    finished_at: Option<Instant>,
    snapshot: DataTransferTask,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireMulticastMessage {
    alias: String,
    version: String,
    device_model: Option<String>,
    device_type: Option<String>,
    fingerprint: String,
    port: u16,
    protocol: String,
    #[serde(default)]
    download: bool,
    announce: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireRegisterDto {
    alias: String,
    version: String,
    device_model: Option<String>,
    device_type: Option<String>,
    fingerprint: String,
    port: u16,
    protocol: String,
    #[serde(default)]
    download: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireFileMetadata {
    modified: Option<String>,
    accessed: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireFileDto {
    id: String,
    file_name: String,
    size: u64,
    file_type: String,
    sha256: Option<String>,
    preview: Option<String>,
    metadata: Option<WireFileMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WirePrepareUploadRequest {
    info: WireRegisterDto,
    files: HashMap<String, WireFileDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WirePrepareUploadResponse {
    session_id: String,
    status: String,
    files: HashMap<String, String>,
    #[serde(default)]
    offsets: HashMap<String, u64>,
    message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadQuery {
    session_id: String,
    file_id: String,
    token: String,
    offset: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelQuery {
    session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadSessionStatusQuery {
    session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct RemoteSharesQuery {
    requester_fingerprint: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct RemoteDownloadQuery {
    share_id: String,
    file_id: String,
    requester_fingerprint: String,
    #[serde(default)]
    password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct RemoteShareIndexResponse {
    owner_alias: String,
    owner_fingerprint: String,
    shares: Vec<RemoteShareWire>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct RemoteShareWire {
    id: String,
    title: String,
    file_count: u64,
    total_bytes: u64,
    created_at: String,
    files: Vec<RemoteShareFileWire>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct RemoteShareFileWire {
    id: String,
    file_name: String,
    relative_path: Option<String>,
    size: u64,
    mime_type: String,
}

impl DataTransferService {
    pub fn new(
        app_name: &str,
        app_data_dir: PathBuf,
        local_store: Arc<LocalStore>,
    ) -> Result<Arc<Self>> {
        let registration_enabled = local_store.data_transfer_registration_enabled()?;
        let fingerprint = local_store.get_or_create_data_transfer_fingerprint()?;
        let favorite_nodes = local_store
            .list_data_transfer_favorites()?
            .into_iter()
            .map(|item| (item.fingerprint.clone(), item))
            .collect::<HashMap<_, _>>();
        let published_shares = local_store
            .list_data_transfer_published_shares()?
            .into_iter()
            .map(|item| (item.id.clone(), LocalShareRuntime::from_record(item)))
            .collect::<HashMap<_, _>>();
        let tasks = local_store
            .list_data_transfer_tasks(500)?
            .into_iter()
            .filter(|task| !task.id.is_empty())
            .map(|task| {
                (
                    task.id.clone(),
                    TaskRuntime {
                        cancel_flag: Arc::new(AtomicBool::new(false)),
                        finished_at: None,
                        snapshot: task,
                    },
                )
            })
            .collect::<HashMap<_, _>>();
        let default_download_dir = resolve_default_download_dir(&app_data_dir);

        let state = ServiceState {
            favorite_nodes,
            incoming_sessions: HashMap::new(),
            nodes: HashMap::new(),
            published_shares,
            registration_enabled,
            tasks,
        };
        let (shutdown_tx, _) = watch::channel(false);

        let service = Arc::new(Self {
            app_data_dir,
            default_download_dir,
            http_client: reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .context("初始化数据传输 HTTP 客户端失败")?,
            local_store,
            server_handle: Arc::new(Mutex::new(None)),
            shutdown_tx,
            state: Arc::new(RwLock::new(state)),
        });

        service.ensure_runtime_directories()?;
        service.start(app_name.to_string(), fingerprint);
        Ok(service)
    }

    pub fn snapshot(&self) -> DataTransferSnapshot {
        let mut state = self.state.blocking_write();
        prune_runtime(&mut state);

        DataTransferSnapshot {
            local_node: DataTransferLocalNode {
                alias: self.local_alias(),
                fingerprint: self.local_fingerprint(),
                port: DATA_TRANSFER_PORT,
                protocol: "http".to_string(),
                registration_enabled: state.registration_enabled,
            },
            default_download_dir: self.default_download_dir.display().to_string(),
            nodes: state
                .nodes
                .values()
                .map(|node| DataTransferNode {
                    id: node.fingerprint.clone(),
                    alias: node.alias.clone(),
                    fingerprint: node.fingerprint.clone(),
                    device_model: node.device_model.clone(),
                    device_type: node.device_type.clone(),
                    ip: node.ip.clone(),
                    port: node.port,
                    protocol: node.protocol.clone(),
                    favorite: state.favorite_nodes.contains_key(&node.fingerprint),
                    source: node.source.clone(),
                    last_seen_at: node.last_seen_at.clone(),
                })
                .collect(),
            favorite_nodes: state.favorite_nodes.values().cloned().collect(),
            published_shares: state
                .published_shares
                .values()
                .map(|share| share.to_snapshot())
                .collect(),
            tasks: state
                .tasks
                .values()
                .map(|task| task.snapshot.clone())
                .collect(),
        }
    }

    pub async fn set_registration_enabled(&self, enabled: bool) -> Result<DataTransferSnapshot> {
        self.local_store
            .set_data_transfer_registration_enabled(enabled)?;

        let mut state = self.state.write().await;
        state.registration_enabled = enabled;
        drop(state);

        if enabled {
            self.refresh_discovery().await?;
        }

        Ok(self.snapshot())
    }

    pub async fn refresh_discovery(&self) -> Result<()> {
        if !self.state.read().await.registration_enabled {
            return Ok(());
        }

        let service = self.clone();
        tokio::spawn(async move {
            if let Err(error) = service.send_multicast_announcement().await {
                warn!(error = %error, "failed to send multicast announcement");
            }
            if let Err(error) = service.scan_favorites().await {
                warn!(error = %error, "failed to scan favorite nodes");
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
            if service.state.read().await.nodes.is_empty()
                && let Err(error) = service.scan_local_subnets().await
            {
                warn!(error = %error, "failed to scan local subnets");
            }
        });

        Ok(())
    }

    pub async fn update_favorite(
        &self,
        payload: DataTransferFavoritePayload,
    ) -> Result<DataTransferSnapshot> {
        if payload.favorite {
            let now = Utc::now().to_rfc3339();
            let favorite = DataTransferFavoriteNode {
                fingerprint: payload.fingerprint.clone(),
                alias: payload.alias.clone(),
                device_model: payload.device_model.clone(),
                device_type: payload.device_type.clone(),
                last_known_ip: payload.last_known_ip.clone(),
                last_known_port: payload.last_known_port,
                created_at: now.clone(),
                updated_at: now,
            };
            self.local_store
                .upsert_data_transfer_favorite(favorite.clone())?;
            self.state
                .write()
                .await
                .favorite_nodes
                .insert(payload.fingerprint, favorite);
        } else {
            self.local_store
                .delete_data_transfer_favorite(&payload.fingerprint)?;
            self.state
                .write()
                .await
                .favorite_nodes
                .remove(&payload.fingerprint);
        }

        Ok(self.snapshot())
    }

    pub async fn publish_files(
        &self,
        payload: DataTransferPublishPayload,
    ) -> Result<DataTransferPublishedShare> {
        ensure!(!payload.file_paths.is_empty(), "请选择至少一个文件");
        validate_share_scope(&payload.scope)?;
        if payload.scope == "password_protected" {
            ensure!(!payload.password.trim().is_empty(), "请设置共享访问密码");
        }

        let share_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let files = collect_publish_files(&payload.file_paths)?;
        let total_bytes = files.iter().map(|item| item.size).sum();
        let title = default_share_title(&files);
        let scope = payload.scope.clone();
        let password_hash = if scope == "password_protected" {
            hash_share_password(&payload.password)
        } else {
            String::new()
        };

        let share = DataTransferPublishedShareRecord {
            id: share_id.clone(),
            title: title.clone(),
            scope,
            file_count: files.len() as u64,
            total_bytes,
            created_at: now.clone(),
            updated_at: now,
            files: files
                .iter()
                .map(DataTransferPublishedFileRecord::from_runtime)
                .collect(),
            allowed_fingerprints: payload.allowed_fingerprints,
            password_hash,
        };

        self.local_store
            .save_data_transfer_published_share(&share)?;
        let runtime = LocalShareRuntime::from_record(share);
        let snapshot = runtime.to_snapshot();
        self.state
            .write()
            .await
            .published_shares
            .insert(snapshot.id.clone(), runtime);
        Ok(snapshot)
    }

    pub async fn remove_published_share(&self, share_id: &str) -> Result<DataTransferSnapshot> {
        self.local_store
            .delete_data_transfer_published_share(share_id)?;
        self.state.write().await.published_shares.remove(share_id);
        Ok(self.snapshot())
    }

    pub async fn load_remote_shares(
        &self,
        payload: DataTransferLoadRemoteSharesPayload,
    ) -> Result<DataTransferRemoteShareResponse> {
        let node = self
            .state
            .read()
            .await
            .nodes
            .get(&payload.node_id)
            .cloned()
            .context("目标节点不存在或已离线")?;

        let response = self
            .http_client
            .get(format!(
                "http://{}:{}/api/zszc-transfer/v1/shares",
                node.ip, node.port
            ))
            .query(&[("requester_fingerprint", self.local_fingerprint())])
            .send()
            .await
            .context("读取远端共享文件失败")?;

        ensure!(
            response.status() == StatusCode::OK,
            "远端共享列表请求失败: {}",
            response.status()
        );

        let payload = response
            .json::<RemoteShareIndexResponse>()
            .await
            .context("解析远端共享文件失败")?;

        Ok(DataTransferRemoteShareResponse {
            node_id: node.fingerprint.clone(),
            shares: payload
                .shares
                .into_iter()
                .map(|share| DataTransferRemoteShare {
                    id: share.id,
                    owner_alias: payload.owner_alias.clone(),
                    owner_fingerprint: payload.owner_fingerprint.clone(),
                    title: share.title,
                    file_count: share.file_count,
                    total_bytes: share.total_bytes,
                    created_at: share.created_at,
                    files: share
                        .files
                        .into_iter()
                        .map(|file| DataTransferRemoteFile {
                            id: file.id,
                            file_name: file.file_name,
                            relative_path: file.relative_path,
                            size: file.size,
                            mime_type: file.mime_type,
                        })
                        .collect(),
                })
                .collect(),
        })
    }

    pub async fn start_direct_send(
        &self,
        payload: DataTransferDirectSendPayload,
    ) -> Result<DataTransferTaskStartResponse> {
        ensure!(!payload.file_paths.is_empty(), "请选择至少一个文件");
        let node = self
            .state
            .read()
            .await
            .nodes
            .get(&payload.node_id)
            .cloned()
            .context("目标节点不存在或已离线")?;
        let files = collect_send_files(&payload.file_paths)?;

        let task_id = Uuid::new_v4().to_string();
        self.create_task(
            task_id.clone(),
            "direct_send",
            "outgoing",
            node.alias.clone(),
            node.fingerprint.clone(),
            "pending",
            Some("已发起发送请求，等待对方确认接收".to_string()),
            files
                .iter()
                .map(|file| (file.id.clone(), file.file_name.clone(), file.size, 0)),
        )
        .await;

        let service = self.clone();
        let task_id_for_task = task_id.clone();
        tokio::spawn(async move {
            if let Err(error) = service
                .run_direct_send_task(task_id_for_task.clone(), node, files)
                .await
            {
                service
                    .finish_task_failure(&task_id_for_task, error.to_string())
                    .await;
            }
        });

        Ok(DataTransferTaskStartResponse { task_id })
    }

    pub async fn download_share(
        &self,
        payload: DataTransferDownloadSharePayload,
    ) -> Result<DataTransferTaskStartResponse> {
        let node = self
            .state
            .read()
            .await
            .nodes
            .get(&payload.node_id)
            .cloned()
            .context("目标节点不存在或已离线")?;
        let remote = self
            .load_remote_shares(DataTransferLoadRemoteSharesPayload {
                node_id: payload.node_id.clone(),
            })
            .await?;
        let share = remote
            .shares
            .iter()
            .find(|item| item.id == payload.share_id)
            .cloned()
            .context("目标共享不存在")?;

        let selected_files = share
            .files
            .into_iter()
            .filter(|file| payload.file_ids.is_empty() || payload.file_ids.contains(&file.id))
            .collect::<Vec<_>>();
        ensure!(!selected_files.is_empty(), "请选择至少一个共享文件");

        let task_id = Uuid::new_v4().to_string();
        self.create_task(
            task_id.clone(),
            "shared_download",
            "incoming",
            node.alias.clone(),
            node.fingerprint.clone(),
            "running",
            None,
            selected_files
                .iter()
                .map(|file| (file.id.clone(), file.file_name.clone(), file.size, 0)),
        )
        .await;

        let destination_dir = payload
            .destination_dir
            .map(PathBuf::from)
            .unwrap_or_else(|| self.default_download_dir.clone());
        let service = self.clone();
        let task_id_for_task = task_id.clone();
        tokio::spawn(async move {
            if let Err(error) = service
                .run_download_share_task(
                    task_id_for_task.clone(),
                    node,
                    share.id,
                    selected_files,
                    destination_dir,
                    payload.password,
                )
                .await
            {
                service
                    .finish_task_failure(&task_id_for_task, error.to_string())
                    .await;
            }
        });

        Ok(DataTransferTaskStartResponse { task_id })
    }

    pub async fn cancel_task(&self, task_id: &str) -> Result<DataTransferTaskCancelResponse> {
        let accepted = self.cancel_task_runtime(task_id, "任务已取消").await;

        Ok(DataTransferTaskCancelResponse {
            task_id: task_id.to_string(),
            accepted,
        })
    }

    pub async fn accept_incoming_task(
        &self,
        task_id: &str,
        destination_dir: Option<String>,
    ) -> Result<DataTransferSnapshot> {
        let destination_dir = destination_dir
            .map(PathBuf::from)
            .unwrap_or_else(|| self.default_download_dir.clone());
        ensure_directory(&destination_dir).await?;

        let (session_id, peer_fingerprint, files) = {
            let state = self.state.read().await;
            let (session_id, session) = state
                .incoming_sessions
                .iter()
                .find(|(_, session)| session.task_id == task_id)
                .context("待接收任务不存在")?;
            ensure!(
                session.status == IncomingSessionStatus::Pending,
                "当前任务已处理"
            );
            (
                session_id.clone(),
                session.peer_fingerprint.clone(),
                session.files.values().cloned().collect::<Vec<_>>(),
            )
        };

        let mut refreshed_files = HashMap::new();
        for file in files {
            let final_path = unique_download_path(&destination_dir, &file.file_name).await?;
            self.local_store
                .upsert_data_transfer_partial(DataTransferPartialRecord {
                    transfer_kind: "incoming_upload".to_string(),
                    peer_fingerprint: peer_fingerprint.clone(),
                    resource_id: file.resource_id.clone(),
                    file_name: file.file_name.clone(),
                    temp_path: file.temp_path.display().to_string(),
                    final_path: final_path.display().to_string(),
                    total_bytes: file.size,
                    created_at: Utc::now().to_rfc3339(),
                    updated_at: Utc::now().to_rfc3339(),
                })?;

            refreshed_files.insert(
                file.file_id.clone(),
                IncomingSessionFile { final_path, ..file },
            );
        }

        let snapshot = {
            let mut state = self.state.write().await;
            let session = state
                .incoming_sessions
                .get_mut(&session_id)
                .context("待接收会话不存在")?;
            ensure!(
                session.status == IncomingSessionStatus::Pending,
                "当前任务已处理"
            );
            session.status = IncomingSessionStatus::Accepted;
            session.files = refreshed_files;
            let task = state.tasks.get_mut(task_id).context("待接收任务不存在")?;
            task.snapshot.status = "pending".to_string();
            task.snapshot.status_message = Some("已确认接收，等待发送方开始传输".to_string());
            task.snapshot.updated_at = Utc::now().to_rfc3339();
            task.snapshot.clone()
        };
        self.persist_task_snapshot(&snapshot);
        Ok(self.snapshot())
    }

    pub async fn reject_incoming_task(&self, task_id: &str) -> Result<DataTransferSnapshot> {
        let session_id = {
            let state = self.state.read().await;
            let (session_id, session) = state
                .incoming_sessions
                .iter()
                .find(|(_, session)| session.task_id == task_id)
                .context("待接收任务不存在")?;
            ensure!(
                session.status == IncomingSessionStatus::Pending,
                "当前任务已处理"
            );
            session_id.clone()
        };

        {
            let mut state = self.state.write().await;
            let session = state
                .incoming_sessions
                .get_mut(&session_id)
                .context("待接收会话不存在")?;
            session.status = IncomingSessionStatus::Rejected;
        }

        self.finish_task_canceled(task_id, "已拒绝接收该文件".to_string())
            .await;
        Ok(self.snapshot())
    }

    pub async fn shutdown(&self) {
        let _ = self.shutdown_tx.send(true);
        if let Some(handle) = self.server_handle.lock().await.take() {
            handle.stop(true).await;
        }
    }

    fn start(self: &Arc<Self>, app_name: String, fingerprint: String) {
        let http_service = self.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = http_service.start_http_server().await {
                error!(error = %error, "failed to start data transfer http server");
            }
        });

        let announce_service = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut stop_rx = announce_service.shutdown_tx.subscribe();
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            break;
                        }
                    }
                    _ = tokio::time::sleep(ANNOUNCE_INTERVAL) => {
                        if announce_service.state.read().await.registration_enabled
                            && let Err(error) = announce_service.send_multicast_announcement().await
                        {
                            warn!(error = %error, "failed to announce data transfer node");
                        }
                    }
                }
            }
        });

        let listener_service = self.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = listener_service.listen_multicast().await {
                warn!(error = %error, "multicast listener stopped unexpectedly");
            }
        });

        let prune_service = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut stop_rx = prune_service.shutdown_tx.subscribe();
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            break;
                        }
                    }
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {
                        prune_service.prune_stale_nodes().await;
                    }
                }
            }
        });

        let startup_service = self.clone();
        tauri::async_runtime::spawn(async move {
            info!(alias = %startup_service.local_alias(), fingerprint = %fingerprint, app_name = %app_name, "data transfer service initialized");
            if let Err(error) = startup_service.refresh_discovery().await {
                warn!(error = %error, "failed to perform initial node discovery");
            }
        });
    }

    async fn start_http_server(self: Arc<Self>) -> Result<()> {
        let service = self.clone();
        let server = HttpServer::new(move || {
            App::new()
                .app_data(web::Data::new(service.clone()))
                .route(
                    "/api/localsend/v2/register",
                    web::post().to(http_register_handler),
                )
                .route(
                    "/api/localsend/v2/prepare-upload",
                    web::post().to(http_prepare_upload_handler),
                )
                .route(
                    "/api/localsend/v2/upload",
                    web::post().to(http_upload_handler),
                )
                .route(
                    "/api/localsend/v2/cancel",
                    web::post().to(http_cancel_handler),
                )
                .route(
                    "/api/zszc-transfer/v1/shares",
                    web::get().to(http_list_remote_shares_handler),
                )
                .route(
                    "/api/zszc-transfer/v1/upload-session-status",
                    web::get().to(http_upload_session_status_handler),
                )
                .route(
                    "/api/zszc-transfer/v1/share-file",
                    web::get().to(http_download_share_file_handler),
                )
        })
        .workers(2)
        .disable_signals()
        .bind(("0.0.0.0", DATA_TRANSFER_PORT))
        .context("绑定数据传输 HTTP 端口失败")?
        .run();

        *self.server_handle.lock().await = Some(server.handle());
        server.await.context("数据传输 HTTP 服务运行失败")
    }

    async fn run_direct_send_task(
        &self,
        task_id: String,
        node: NodeRuntime,
        files: Vec<SendFileRuntime>,
    ) -> Result<()> {
        let prepare_payload = WirePrepareUploadRequest {
            info: self.local_register_dto(),
            files: files
                .iter()
                .map(|item| (item.id.clone(), item.to_wire()))
                .collect(),
        };

        let response = self
            .http_client
            .post(format!(
                "http://{}:{}/api/localsend/v2/prepare-upload",
                node.ip, node.port
            ))
            .json(&prepare_payload)
            .send()
            .await
            .context("创建直传会话失败")?;

        ensure!(
            response.status() == StatusCode::OK,
            "创建直传会话失败: {}",
            response.status()
        );

        let mut response = response
            .json::<WirePrepareUploadResponse>()
            .await
            .context("解析直传会话响应失败")?;
        let remote_session_id = response.session_id;
        let task_cancel = self.task_cancel_flag(&task_id).await;

        while response.status == "pending" {
            if task_cancel.load(Ordering::SeqCst) {
                let _ = self.cancel_remote_session(&node, &remote_session_id).await;
                return Err(anyhow!("任务已取消"));
            }

            self.update_task_status_message(&task_id, Some("等待对方确认接收".to_string()), None)
                .await;

            tokio::time::sleep(Duration::from_millis(900)).await;
            response = self
                .load_upload_session_status(&node, &remote_session_id)
                .await?;
        }

        if response.status == "rejected" {
            return Err(anyhow!(
                "{}",
                response
                    .message
                    .unwrap_or_else(|| "接收方已拒绝此次传输".to_string())
            ));
        }

        ensure!(
            response.status == "accepted",
            "传输会话状态异常: {}",
            response.status
        );
        self.mark_task_running(
            &task_id,
            Some("对方已确认接收，正在建立传输通道".to_string()),
        )
        .await;

        for file in files {
            let token = match response.files.get(&file.id) {
                Some(token) => token.clone(),
                None => {
                    self.finish_task_file(&task_id, &file.id, "skipped", None)
                        .await;
                    continue;
                }
            };
            let offset = response.offsets.get(&file.id).copied().unwrap_or(0);
            self.update_task_file_progress(&task_id, &file.id, offset)
                .await;

            let url = format!("http://{}:{}/api/localsend/v2/upload", node.ip, node.port);
            let file_id = file.id.clone();
            let task_id_for_stream = task_id.clone();
            let path = file.path.clone();
            let task_cancel_for_stream = task_cancel.clone();
            let mut source = File::open(&path)
                .await
                .with_context(|| format!("打开待发送文件失败: {}", path.display()))?;
            source.seek(SeekFrom::Start(offset)).await?;
            let progress = Arc::new(Mutex::new(offset));
            let service = self.clone();
            let stream = ReaderStream::with_capacity(source, 64 * 1024).map(move |item| {
                if task_cancel_for_stream.load(Ordering::SeqCst) {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Interrupted,
                        "task canceled",
                    ));
                }

                match item {
                    Ok(chunk) => {
                        let progress = progress.clone();
                        let service = service.clone();
                        let task_id = task_id_for_stream.clone();
                        let file_id = file_id.clone();
                        let chunk_len = chunk.len() as u64;
                        tokio::spawn(async move {
                            let mut guard = progress.lock().await;
                            *guard += chunk_len;
                            service
                                .update_task_file_progress(&task_id, &file_id, *guard)
                                .await;
                        });
                        Ok(chunk)
                    }
                    Err(error) => Err(error),
                }
            });

            let response = self
                .http_client
                .post(&url)
                .query(&[
                    ("sessionId", remote_session_id.as_str()),
                    ("fileId", file.id.as_str()),
                    ("token", token.as_str()),
                    ("offset", &offset.to_string()),
                ])
                .header("content-type", "application/octet-stream")
                .body(reqwest::Body::wrap_stream(stream))
                .send()
                .await
                .with_context(|| format!("发送文件失败: {}", file.file_name))?;

            ensure!(
                response.status() == StatusCode::OK,
                "发送文件失败: {}",
                response.status()
            );
            self.finish_task_file(&task_id, &file.id, "completed", None)
                .await;
        }

        self.finish_task_success(&task_id).await;
        Ok(())
    }

    async fn run_download_share_task(
        &self,
        task_id: String,
        node: NodeRuntime,
        share_id: String,
        files: Vec<DataTransferRemoteFile>,
        destination_dir: PathBuf,
        password: Option<String>,
    ) -> Result<()> {
        ensure_directory(&destination_dir).await?;

        for file in files {
            let resource_id = format!("{share_id}:{}", file.id);
            let partial = self.local_store.load_data_transfer_partial(
                "shared_download",
                &node.fingerprint,
                &resource_id,
            )?;
            let (temp_path, final_path, offset) = self
                .resolve_partial_paths(
                    partial,
                    &node.fingerprint,
                    &resource_id,
                    &file.file_name,
                    &destination_dir,
                )
                .await?;
            self.local_store
                .upsert_data_transfer_partial(DataTransferPartialRecord {
                    transfer_kind: "shared_download".to_string(),
                    peer_fingerprint: node.fingerprint.clone(),
                    resource_id: resource_id.clone(),
                    file_name: file.file_name.clone(),
                    temp_path: temp_path.display().to_string(),
                    final_path: final_path.display().to_string(),
                    total_bytes: file.size,
                    created_at: Utc::now().to_rfc3339(),
                    updated_at: Utc::now().to_rfc3339(),
                })?;

            self.update_task_file_progress(&task_id, &file.id, offset)
                .await;

            let request = self
                .http_client
                .get(format!(
                    "http://{}:{}/api/zszc-transfer/v1/share-file",
                    node.ip, node.port
                ))
                .query(&[
                    ("share_id", share_id.as_str()),
                    ("file_id", file.id.as_str()),
                    ("requester_fingerprint", self.local_fingerprint().as_str()),
                    ("password", password.as_deref().unwrap_or("")),
                ]);
            let request = if offset > 0 {
                request.header("range", format!("bytes={offset}-"))
            } else {
                request
            };
            let response = request.send().await.context("下载共享文件失败")?;
            ensure!(
                response.status() == StatusCode::OK
                    || response.status() == StatusCode::PARTIAL_CONTENT,
                "下载共享文件失败: {}",
                response.status()
            );

            let mut writer = OpenOptions::new()
                .create(true)
                .append(offset > 0)
                .write(true)
                .open(&temp_path)
                .await
                .with_context(|| format!("打开共享文件缓存失败: {}", temp_path.display()))?;
            if offset == 0 {
                writer.set_len(0).await?;
            }

            let mut stream = response.bytes_stream();
            let mut transferred = offset;
            let cancel_flag = self.task_cancel_flag(&task_id).await;
            while let Some(chunk) = stream.next().await {
                if cancel_flag.load(Ordering::SeqCst) {
                    return Err(anyhow!("任务已取消"));
                }
                let chunk = chunk.context("接收共享文件分片失败")?;
                writer.write_all(&chunk).await?;
                transferred += chunk.len() as u64;
                self.update_task_file_progress(&task_id, &file.id, transferred)
                    .await;
            }
            writer.flush().await?;
            fs::rename(&temp_path, &final_path).await?;
            self.local_store.delete_data_transfer_partial(
                "shared_download",
                &node.fingerprint,
                &resource_id,
            )?;
            self.finish_task_file(&task_id, &file.id, "completed", None)
                .await;
        }

        self.finish_task_success(&task_id).await;
        Ok(())
    }

    async fn load_upload_session_status(
        &self,
        node: &NodeRuntime,
        session_id: &str,
    ) -> Result<WirePrepareUploadResponse> {
        let response = self
            .http_client
            .get(format!(
                "http://{}:{}/api/zszc-transfer/v1/upload-session-status",
                node.ip, node.port
            ))
            .query(&[("sessionId", session_id)])
            .send()
            .await
            .context("读取接收确认状态失败")?;

        ensure!(
            response.status() == StatusCode::OK,
            "读取接收确认状态失败: {}",
            response.status()
        );

        response
            .json::<WirePrepareUploadResponse>()
            .await
            .context("解析接收确认状态失败")
    }

    async fn cancel_remote_session(&self, node: &NodeRuntime, session_id: &str) -> Result<()> {
        let response = self
            .http_client
            .post(format!(
                "http://{}:{}/api/localsend/v2/cancel",
                node.ip, node.port
            ))
            .query(&[("sessionId", session_id)])
            .send()
            .await
            .context("取消远端接收会话失败")?;

        ensure!(
            response.status() == StatusCode::OK,
            "取消远端接收会话失败: {}",
            response.status()
        );
        Ok(())
    }

    async fn handle_register(&self, payload: WireRegisterDto, peer_ip: IpAddr) -> HttpResponse {
        if !self.state.read().await.registration_enabled {
            return HttpResponse::NotFound().finish();
        }

        self.register_node(
            payload.fingerprint.clone(),
            payload.alias.clone(),
            payload.device_model.clone(),
            payload
                .device_type
                .clone()
                .unwrap_or_else(|| "desktop".to_string()),
            peer_ip.to_string(),
            payload.port,
            payload.protocol.clone(),
            "http_register".to_string(),
        )
        .await;

        HttpResponse::Ok().json(self.local_register_dto())
    }

    async fn handle_prepare_upload(
        &self,
        payload: WirePrepareUploadRequest,
        peer_ip: IpAddr,
    ) -> Result<HttpResponse> {
        let session_id = Uuid::new_v4().to_string();
        let task_id = Uuid::new_v4().to_string();
        let peer_alias = payload.info.alias.clone();
        let peer_fingerprint = payload.info.fingerprint.clone();

        let mut session_files = HashMap::new();
        let mut task_files = Vec::new();
        for file in payload.files.values() {
            let resource_id = file.id.clone();
            let partial = self.local_store.load_data_transfer_partial(
                "incoming_upload",
                &peer_fingerprint,
                &resource_id,
            )?;
            let (temp_path, final_path, offset) = self
                .resolve_partial_paths(
                    partial,
                    &peer_fingerprint,
                    &resource_id,
                    &file.file_name,
                    &self.default_download_dir,
                )
                .await?;
            self.local_store
                .upsert_data_transfer_partial(DataTransferPartialRecord {
                    transfer_kind: "incoming_upload".to_string(),
                    peer_fingerprint: peer_fingerprint.clone(),
                    resource_id: resource_id.clone(),
                    file_name: file.file_name.clone(),
                    temp_path: temp_path.display().to_string(),
                    final_path: final_path.display().to_string(),
                    total_bytes: file.size,
                    created_at: Utc::now().to_rfc3339(),
                    updated_at: Utc::now().to_rfc3339(),
                })?;

            let token = Uuid::new_v4().to_string();
            task_files.push((file.id.clone(), file.file_name.clone(), file.size, offset));
            session_files.insert(
                file.id.clone(),
                IncomingSessionFile {
                    file_id: file.id.clone(),
                    file_name: file.file_name.clone(),
                    size: file.size,
                    final_path,
                    resource_id,
                    temp_path,
                    token,
                },
            );
        }

        self.create_task(
            task_id.clone(),
            "direct_receive",
            "incoming",
            peer_alias.clone(),
            peer_fingerprint.clone(),
            "pending",
            Some("等待你确认接收并选择保存位置".to_string()),
            task_files,
        )
        .await;

        self.state.write().await.incoming_sessions.insert(
            session_id.clone(),
            IncomingSession {
                peer_alias,
                peer_fingerprint,
                peer_ip: peer_ip.to_string(),
                status: IncomingSessionStatus::Pending,
                task_id,
                files: session_files,
            },
        );

        Ok(HttpResponse::Ok().json(WirePrepareUploadResponse {
            session_id,
            status: "pending".to_string(),
            files: HashMap::new(),
            offsets: HashMap::new(),
            message: Some("等待接收方确认".to_string()),
        }))
    }

    async fn handle_upload(
        &self,
        peer_ip: IpAddr,
        query: UploadQuery,
        mut payload: web::Payload,
    ) -> Result<HttpResponse> {
        let (peer_fingerprint, task_id, file_state) = {
            let state = self.state.read().await;
            let session = state
                .incoming_sessions
                .get(&query.session_id)
                .context("传输会话不存在")?;
            ensure!(
                session.peer_ip == peer_ip.to_string(),
                "上传来源 IP 与会话不匹配"
            );
            ensure!(
                session.status == IncomingSessionStatus::Accepted,
                "接收方尚未确认接收"
            );
            let file = session
                .files
                .get(&query.file_id)
                .cloned()
                .context("目标文件不存在")?;
            ensure!(file.token == query.token, "文件令牌无效");
            (
                session.peer_fingerprint.clone(),
                session.task_id.clone(),
                file,
            )
        };

        let expected_offset = existing_file_length(&file_state.temp_path).await?;
        let offset = query.offset.unwrap_or(0);
        ensure!(expected_offset == offset, "上传偏移不匹配");

        let mut writer = OpenOptions::new()
            .create(true)
            .append(offset > 0)
            .write(true)
            .open(&file_state.temp_path)
            .await
            .with_context(|| format!("打开接收缓存失败: {}", file_state.temp_path.display()))?;
        if offset == 0 {
            writer.set_len(0).await?;
        }

        let mut transferred = offset;
        while let Some(chunk) = payload.next().await {
            let chunk = chunk.context("读取上传数据失败")?;
            writer.write_all(&chunk).await?;
            transferred += chunk.len() as u64;
            self.update_task_file_progress(&task_id, &file_state.file_id, transferred)
                .await;
        }
        writer.flush().await?;
        fs::rename(&file_state.temp_path, &file_state.final_path).await?;
        self.local_store.delete_data_transfer_partial(
            "incoming_upload",
            &peer_fingerprint,
            &file_state.resource_id,
        )?;
        self.finish_task_file(&task_id, &file_state.file_id, "completed", None)
            .await;

        let should_finish = {
            let mut state = self.state.write().await;
            let Some(session) = state.incoming_sessions.get_mut(&query.session_id) else {
                return Ok(HttpResponse::InternalServerError().finish());
            };
            session.files.remove(&query.file_id);
            session.files.is_empty()
        };
        if should_finish {
            self.state
                .write()
                .await
                .incoming_sessions
                .remove(&query.session_id);
            self.finish_task_success(&task_id).await;
        }

        Ok(HttpResponse::Ok().finish())
    }

    async fn handle_cancel(&self, query: CancelQuery, peer_ip: IpAddr) -> Result<HttpResponse> {
        let task_id = {
            let state = self.state.read().await;
            let session = state
                .incoming_sessions
                .get(&query.session_id)
                .context("传输会话不存在")?;
            ensure!(session.peer_ip == peer_ip.to_string(), "取消来源不匹配");
            session.task_id.clone()
        };
        self.finish_task_canceled(&task_id, "发送方已取消传输".to_string())
            .await;
        self.state
            .write()
            .await
            .incoming_sessions
            .remove(&query.session_id);
        Ok(HttpResponse::Ok().finish())
    }

    async fn handle_upload_session_status(
        &self,
        query: UploadSessionStatusQuery,
        peer_ip: IpAddr,
    ) -> Result<HttpResponse> {
        let session = {
            let state = self.state.read().await;
            let session = state
                .incoming_sessions
                .get(&query.session_id)
                .cloned()
                .context("传输会话不存在")?;
            ensure!(session.peer_ip == peer_ip.to_string(), "查询来源不匹配");
            session
        };

        let mut files = HashMap::new();
        let mut offsets = HashMap::new();
        if session.status == IncomingSessionStatus::Accepted {
            for file in session.files.values() {
                files.insert(file.file_id.clone(), file.token.clone());
                offsets.insert(
                    file.file_id.clone(),
                    existing_file_length(&file.temp_path).await?,
                );
            }
        }

        if session.status == IncomingSessionStatus::Rejected {
            self.state
                .write()
                .await
                .incoming_sessions
                .remove(&query.session_id);
        }

        Ok(HttpResponse::Ok().json(WirePrepareUploadResponse {
            session_id: query.session_id,
            status: session.status.as_str().to_string(),
            files,
            offsets,
            message: match session.status {
                IncomingSessionStatus::Pending => Some("等待接收方确认".to_string()),
                IncomingSessionStatus::Accepted => {
                    Some(format!("{} 已确认接收", session.peer_alias))
                }
                IncomingSessionStatus::Rejected => Some("接收方已拒绝此次传输".to_string()),
            },
        }))
    }

    async fn handle_list_remote_shares(
        &self,
        requester_fingerprint: String,
    ) -> Result<HttpResponse> {
        let state = self.state.read().await;
        let shares = state
            .published_shares
            .values()
            .filter(|share| share.can_list(&requester_fingerprint, &state.favorite_nodes))
            .map(|share| RemoteShareWire {
                id: share.id.clone(),
                title: share.title.clone(),
                file_count: share.files.len() as u64,
                total_bytes: share.total_bytes,
                created_at: share.created_at.clone(),
                files: share
                    .files
                    .iter()
                    .map(|file| RemoteShareFileWire {
                        id: file.file_id.clone(),
                        file_name: file.file_name.clone(),
                        relative_path: file.relative_path.clone(),
                        size: file.size,
                        mime_type: file.mime_type.clone(),
                    })
                    .collect(),
            })
            .collect::<Vec<_>>();

        Ok(HttpResponse::Ok().json(RemoteShareIndexResponse {
            owner_alias: self.local_alias(),
            owner_fingerprint: self.local_fingerprint(),
            shares,
        }))
    }

    async fn handle_download_share_file(
        &self,
        request: HttpRequest,
        query: RemoteDownloadQuery,
    ) -> Result<HttpResponse> {
        let share = self
            .state
            .read()
            .await
            .published_shares
            .get(&query.share_id)
            .cloned()
            .context("目标共享不存在")?;
        ensure!(
            share.can_download(
                &query.requester_fingerprint,
                &self.state.read().await.favorite_nodes,
                query.password.as_deref(),
            ),
            "没有共享访问权限"
        );
        let file = share
            .files
            .iter()
            .find(|item| item.file_id == query.file_id)
            .cloned()
            .context("目标共享文件不存在")?;

        let file_size = fs::metadata(&file.local_path).await?.len();
        let (start, status) = parse_range_header(request.headers().get(header::RANGE), file_size)?;
        let mut source = File::open(&file.local_path).await?;
        source.seek(SeekFrom::Start(start)).await?;
        let stream = ReaderStream::new(source).map(|item| item.map_err(ActixError::from));
        let mut response = HttpResponse::build(status);
        response.insert_header((header::CONTENT_TYPE, file.mime_type.clone()));
        response.insert_header((
            header::CONTENT_DISPOSITION,
            ContentDisposition {
                disposition: DispositionType::Attachment,
                parameters: vec![DispositionParam::Filename(file.file_name.clone())],
            },
        ));
        response.insert_header((header::CONTENT_LENGTH, (file_size - start).to_string()));
        if status == actix_web::http::StatusCode::PARTIAL_CONTENT {
            response.insert_header((
                header::CONTENT_RANGE,
                format!(
                    "bytes {start}-{}{}",
                    file_size.saturating_sub(1),
                    format!("/{file_size}")
                ),
            ));
        }

        Ok(response.streaming(stream))
    }

    async fn send_multicast_announcement(&self) -> Result<()> {
        let message = serde_json::to_vec(&WireMulticastMessage {
            alias: self.local_alias(),
            version: "2.1".to_string(),
            device_model: Some("Tauri Desktop".to_string()),
            device_type: Some("desktop".to_string()),
            fingerprint: self.local_fingerprint(),
            port: DATA_TRANSFER_PORT,
            protocol: "http".to_string(),
            download: false,
            announce: true,
        })?;
        let socket = UdpSocket::bind(("0.0.0.0", 0)).await?;
        socket
            .send_to(
                &message,
                SocketAddr::new(IpAddr::V4(MULTICAST_ADDR), DATA_TRANSFER_PORT),
            )
            .await?;
        Ok(())
    }

    async fn listen_multicast(&self) -> Result<()> {
        let socket = create_multicast_socket()?;
        let socket = UdpSocket::from_std(socket.into())?;
        let mut buffer = vec![0_u8; 4096];
        let mut stop_rx = self.shutdown_tx.subscribe();

        loop {
            tokio::select! {
                _ = stop_rx.changed() => {
                    if *stop_rx.borrow() {
                        break;
                    }
                }
                result = socket.recv_from(&mut buffer) => {
                    let (size, sender) = result?;
                    let message = match serde_json::from_slice::<WireMulticastMessage>(&buffer[..size]) {
                        Ok(message) => message,
                        Err(error) => {
                            warn!(error = %error, "failed to decode multicast message");
                            continue;
                        }
                    };
                    if message.fingerprint == self.local_fingerprint() {
                        continue;
                    }
                    self.register_node(
                        message.fingerprint.clone(),
                        message.alias.clone(),
                        message.device_model.clone(),
                        message.device_type.clone().unwrap_or_else(|| "desktop".to_string()),
                        sender.ip().to_string(),
                        message.port,
                        message.protocol.clone(),
                        "multicast".to_string(),
                    )
                    .await;
                    if message.announce && self.state.read().await.registration_enabled {
                        let _ = self.try_http_register(sender.ip().to_string(), message.port).await;
                    }
                }
            }
        }

        Ok(())
    }

    async fn scan_favorites(&self) -> Result<()> {
        let favorites = self
            .state
            .read()
            .await
            .favorite_nodes
            .values()
            .filter_map(|item| {
                item.last_known_ip
                    .as_ref()
                    .zip(item.last_known_port)
                    .map(|(ip, port)| (ip.clone(), port))
            })
            .collect::<Vec<_>>();

        let tasks = favorites.into_iter().map(|(ip, port)| {
            let service = self.clone();
            tokio::spawn(async move {
                let _ = service.try_http_register(ip, port).await;
            })
        });
        futures::future::join_all(tasks).await;
        Ok(())
    }

    async fn scan_local_subnets(&self) -> Result<()> {
        let interfaces = private_ipv4_addresses()?;
        let semaphore = Arc::new(Semaphore::new(48));
        let mut tasks = FuturesUnordered::new();
        for ip in interfaces.into_iter().take(3) {
            let octets = ip.octets();
            for host in 1..=254_u8 {
                if host == octets[3] {
                    continue;
                }
                let target = format!("{}.{}.{}.{}", octets[0], octets[1], octets[2], host);
                let permit = semaphore.clone().acquire_owned().await?;
                let service = self.clone();
                tasks.push(tokio::spawn(async move {
                    let _permit = permit;
                    let _ = service.try_http_register(target, DATA_TRANSFER_PORT).await;
                }));
            }
        }

        while tasks.next().await.is_some() {}
        Ok(())
    }

    async fn try_http_register(&self, ip: String, port: u16) -> Result<()> {
        let response = self
            .http_client
            .post(format!("http://{ip}:{port}/api/localsend/v2/register"))
            .json(&self.local_register_dto())
            .send()
            .await
            .with_context(|| format!("向节点 {ip}:{port} 发起注册失败"))?;
        ensure!(response.status() == StatusCode::OK, "节点未响应注册请求");
        let payload = response.json::<WireRegisterDto>().await?;
        self.register_node(
            payload.fingerprint.clone(),
            payload.alias,
            payload.device_model,
            payload.device_type.unwrap_or_else(|| "desktop".to_string()),
            ip,
            port,
            payload.protocol,
            "http_register".to_string(),
        )
        .await;
        Ok(())
    }

    async fn register_node(
        &self,
        fingerprint: String,
        alias: String,
        device_model: Option<String>,
        device_type: String,
        ip: String,
        port: u16,
        protocol: String,
        source: String,
    ) {
        let last_seen_at = Utc::now().to_rfc3339();
        let mut state = self.state.write().await;
        if let Some(favorite) = state.favorite_nodes.get_mut(&fingerprint) {
            favorite.last_known_ip = Some(ip.clone());
            favorite.last_known_port = Some(port);
            favorite.updated_at = last_seen_at.clone();
            let _ = self
                .local_store
                .upsert_data_transfer_favorite(favorite.clone());
        }
        state.nodes.insert(
            fingerprint.clone(),
            NodeRuntime {
                alias,
                device_model,
                device_type,
                fingerprint,
                ip,
                last_seen_at,
                last_seen_instant: Instant::now(),
                port,
                protocol,
                source,
            },
        );
    }

    async fn prune_stale_nodes(&self) {
        let mut state = self.state.write().await;
        state
            .nodes
            .retain(|_, item| item.last_seen_instant.elapsed() <= NODE_TTL);
    }

    async fn create_task<I>(
        &self,
        task_id: String,
        kind: &str,
        direction: &str,
        peer_alias: String,
        peer_fingerprint: String,
        status: &str,
        status_message: Option<String>,
        files: I,
    ) where
        I: IntoIterator<Item = (String, String, u64, u64)>,
    {
        let started_at = Utc::now().to_rfc3339();
        let files = files
            .into_iter()
            .map(|(id, file_name, size, transferred)| DataTransferTaskFile {
                id,
                file_name,
                size,
                transferred_bytes: transferred,
                status: "pending".to_string(),
                error_message: None,
            })
            .collect::<Vec<_>>();
        let total_bytes = files.iter().map(|item| item.size).sum();
        let transferred_bytes = files.iter().map(|item| item.transferred_bytes).sum::<u64>();
        let snapshot = DataTransferTask {
            id: task_id.clone(),
            kind: kind.to_string(),
            direction: direction.to_string(),
            peer_alias,
            peer_fingerprint,
            status: status.to_string(),
            status_message,
            total_bytes,
            transferred_bytes,
            progress_percent: if total_bytes == 0 {
                100.0
            } else {
                (transferred_bytes as f64 / total_bytes as f64) * 100.0
            },
            current_file_name: None,
            started_at: started_at.clone(),
            updated_at: started_at,
            completed_at: None,
            error_message: None,
            files,
        };

        self.state.write().await.tasks.insert(
            task_id,
            TaskRuntime {
                cancel_flag: Arc::new(AtomicBool::new(false)),
                finished_at: None,
                snapshot: snapshot.clone(),
            },
        );
        self.persist_task_snapshot(&snapshot);
    }

    async fn update_task_file_progress(&self, task_id: &str, file_id: &str, transferred: u64) {
        let snapshot = {
            let mut state = self.state.write().await;
            let Some(task) = state.tasks.get_mut(task_id) else {
                return;
            };
            let Some(file) = task
                .snapshot
                .files
                .iter_mut()
                .find(|item| item.id == file_id)
            else {
                return;
            };
            file.transferred_bytes = transferred.min(file.size);
            file.status = "running".to_string();
            task.snapshot.status = "running".to_string();
            task.snapshot.status_message = None;
            task.snapshot.current_file_name = Some(file.file_name.clone());
            task.snapshot.transferred_bytes = task
                .snapshot
                .files
                .iter()
                .map(|item| item.transferred_bytes)
                .sum();
            task.snapshot.progress_percent = if task.snapshot.total_bytes == 0 {
                100.0
            } else {
                (task.snapshot.transferred_bytes as f64 / task.snapshot.total_bytes as f64) * 100.0
            };
            task.snapshot.updated_at = Utc::now().to_rfc3339();
            task.snapshot.clone()
        };
        self.persist_task_snapshot(&snapshot);
    }

    async fn finish_task_file(
        &self,
        task_id: &str,
        file_id: &str,
        status: &str,
        error_message: Option<String>,
    ) {
        let snapshot = {
            let mut state = self.state.write().await;
            let Some(task) = state.tasks.get_mut(task_id) else {
                return;
            };
            if let Some(file) = task
                .snapshot
                .files
                .iter_mut()
                .find(|item| item.id == file_id)
            {
                file.status = status.to_string();
                file.error_message = error_message;
                if status == "completed" {
                    file.transferred_bytes = file.size;
                }
            }
            task.snapshot.transferred_bytes = task
                .snapshot
                .files
                .iter()
                .map(|item| item.transferred_bytes)
                .sum();
            task.snapshot.progress_percent = if task.snapshot.total_bytes == 0 {
                100.0
            } else {
                (task.snapshot.transferred_bytes as f64 / task.snapshot.total_bytes as f64) * 100.0
            };
            task.snapshot.updated_at = Utc::now().to_rfc3339();
            task.snapshot.clone()
        };
        self.persist_task_snapshot(&snapshot);
    }

    async fn finish_task_success(&self, task_id: &str) {
        let snapshot = {
            let mut state = self.state.write().await;
            let Some(task) = state.tasks.get_mut(task_id) else {
                return;
            };
            task.snapshot.status = "completed".to_string();
            task.snapshot.status_message = None;
            task.snapshot.current_file_name = None;
            task.snapshot.completed_at = Some(Utc::now().to_rfc3339());
            task.snapshot.error_message = None;
            task.snapshot.updated_at = Utc::now().to_rfc3339();
            task.snapshot.progress_percent = 100.0;
            task.finished_at = Some(Instant::now());
            task.snapshot.clone()
        };
        self.persist_task_snapshot(&snapshot);
    }

    async fn finish_task_failure(&self, task_id: &str, message: String) {
        let snapshot = {
            let mut state = self.state.write().await;
            let Some(task) = state.tasks.get_mut(task_id) else {
                return;
            };
            task.snapshot.status = if task.cancel_flag.load(Ordering::SeqCst) {
                "canceled".to_string()
            } else {
                "failed".to_string()
            };
            task.snapshot.status_message = None;
            task.snapshot.error_message = Some(message);
            task.snapshot.current_file_name = None;
            task.snapshot.completed_at = Some(Utc::now().to_rfc3339());
            task.snapshot.updated_at = Utc::now().to_rfc3339();
            task.finished_at = Some(Instant::now());
            task.snapshot.clone()
        };
        self.persist_task_snapshot(&snapshot);
    }

    async fn finish_task_canceled(&self, task_id: &str, message: String) {
        let snapshot = {
            let mut state = self.state.write().await;
            let Some(task) = state.tasks.get_mut(task_id) else {
                return;
            };
            task.cancel_flag.store(true, Ordering::SeqCst);
            task.snapshot.status = "canceled".to_string();
            task.snapshot.status_message = None;
            task.snapshot.error_message = Some(message);
            task.snapshot.current_file_name = None;
            task.snapshot.completed_at = Some(Utc::now().to_rfc3339());
            task.snapshot.updated_at = Utc::now().to_rfc3339();
            task.finished_at = Some(Instant::now());
            task.snapshot.clone()
        };
        self.persist_task_snapshot(&snapshot);
    }

    async fn update_task_status_message(
        &self,
        task_id: &str,
        status_message: Option<String>,
        status: Option<&str>,
    ) {
        let snapshot = {
            let mut state = self.state.write().await;
            let Some(task) = state.tasks.get_mut(task_id) else {
                return;
            };
            if let Some(status) = status {
                task.snapshot.status = status.to_string();
            }
            task.snapshot.status_message = status_message;
            task.snapshot.updated_at = Utc::now().to_rfc3339();
            task.snapshot.clone()
        };
        self.persist_task_snapshot(&snapshot);
    }

    async fn mark_task_running(&self, task_id: &str, status_message: Option<String>) {
        self.update_task_status_message(task_id, status_message, Some("running"))
            .await;
    }

    async fn cancel_task_runtime(&self, task_id: &str, message: &str) -> bool {
        let task_exists = self.state.read().await.tasks.contains_key(task_id);
        if !task_exists {
            return false;
        }
        self.finish_task_canceled(task_id, message.to_string())
            .await;
        true
    }

    async fn task_cancel_flag(&self, task_id: &str) -> Arc<AtomicBool> {
        self.state
            .read()
            .await
            .tasks
            .get(task_id)
            .map(|item| item.cancel_flag.clone())
            .unwrap_or_else(|| Arc::new(AtomicBool::new(false)))
    }

    fn persist_task_snapshot(&self, snapshot: &DataTransferTask) {
        if let Err(error) = self.local_store.upsert_data_transfer_task(snapshot) {
            warn!(error = %error, task_id = %snapshot.id, "failed to persist data transfer task");
        }
    }

    async fn resolve_partial_paths(
        &self,
        partial: Option<DataTransferPartialRecord>,
        peer_fingerprint: &str,
        resource_id: &str,
        file_name: &str,
        base_dir: &Path,
    ) -> Result<(PathBuf, PathBuf, u64)> {
        ensure_directory(base_dir).await?;
        if let Some(partial) = partial {
            let temp_path = PathBuf::from(partial.temp_path);
            let final_path = PathBuf::from(partial.final_path);
            if temp_path.exists() {
                return Ok((
                    temp_path.clone(),
                    final_path,
                    existing_file_length(&temp_path).await?,
                ));
            }
        }

        let final_path = unique_download_path(base_dir, file_name).await?;
        let temp_dir = self.app_data_dir.join("data-transfer").join("partials");
        ensure_directory(&temp_dir).await?;
        let temp_path = temp_dir.join(format!(
            "{}-{}.part",
            sanitize_file_stem(peer_fingerprint),
            sanitize_file_stem(resource_id),
        ));
        Ok((temp_path, final_path, 0))
    }

    fn local_alias(&self) -> String {
        System::host_name()
            .filter(|item| !item.trim().is_empty())
            .unwrap_or_else(|| "数据传输工作站".to_string())
    }

    fn local_fingerprint(&self) -> String {
        self.local_store
            .get_or_create_data_transfer_fingerprint()
            .unwrap_or_else(|_| "unknown-node".to_string())
    }

    fn local_register_dto(&self) -> WireRegisterDto {
        WireRegisterDto {
            alias: self.local_alias(),
            version: "2.1".to_string(),
            device_model: Some("Tauri Desktop".to_string()),
            device_type: Some("desktop".to_string()),
            fingerprint: self.local_fingerprint(),
            port: DATA_TRANSFER_PORT,
            protocol: "http".to_string(),
            download: false,
        }
    }

    fn ensure_runtime_directories(&self) -> Result<()> {
        std::fs::create_dir_all(self.app_data_dir.join("data-transfer").join("partials"))?;
        std::fs::create_dir_all(&self.default_download_dir)?;
        Ok(())
    }
}

async fn http_register_handler(
    service: web::Data<Arc<DataTransferService>>,
    request: HttpRequest,
    payload: web::Json<WireRegisterDto>,
) -> impl Responder {
    service
        .handle_register(payload.into_inner(), peer_ip(&request))
        .await
}

async fn http_prepare_upload_handler(
    service: web::Data<Arc<DataTransferService>>,
    request: HttpRequest,
    payload: web::Json<WirePrepareUploadRequest>,
) -> impl Responder {
    match service
        .handle_prepare_upload(payload.into_inner(), peer_ip(&request))
        .await
    {
        Ok(response) => response,
        Err(error) => HttpResponse::BadRequest().body(error.to_string()),
    }
}

async fn http_upload_handler(
    service: web::Data<Arc<DataTransferService>>,
    request: HttpRequest,
    query: web::Query<UploadQuery>,
    payload: web::Payload,
) -> impl Responder {
    match service
        .handle_upload(peer_ip(&request), query.into_inner(), payload)
        .await
    {
        Ok(response) => response,
        Err(error) => HttpResponse::BadRequest().body(error.to_string()),
    }
}

async fn http_cancel_handler(
    service: web::Data<Arc<DataTransferService>>,
    request: HttpRequest,
    query: web::Query<CancelQuery>,
) -> impl Responder {
    match service
        .handle_cancel(query.into_inner(), peer_ip(&request))
        .await
    {
        Ok(response) => response,
        Err(error) => HttpResponse::BadRequest().body(error.to_string()),
    }
}

async fn http_list_remote_shares_handler(
    service: web::Data<Arc<DataTransferService>>,
    query: web::Query<RemoteSharesQuery>,
) -> impl Responder {
    match service
        .handle_list_remote_shares(query.requester_fingerprint.clone())
        .await
    {
        Ok(response) => response,
        Err(error) => HttpResponse::Forbidden().body(error.to_string()),
    }
}

async fn http_upload_session_status_handler(
    service: web::Data<Arc<DataTransferService>>,
    request: HttpRequest,
    query: web::Query<UploadSessionStatusQuery>,
) -> impl Responder {
    match service
        .handle_upload_session_status(query.into_inner(), peer_ip(&request))
        .await
    {
        Ok(response) => response,
        Err(error) => HttpResponse::Forbidden().body(error.to_string()),
    }
}

async fn http_download_share_file_handler(
    service: web::Data<Arc<DataTransferService>>,
    request: HttpRequest,
    query: web::Query<RemoteDownloadQuery>,
) -> impl Responder {
    match service
        .handle_download_share_file(request, query.into_inner())
        .await
    {
        Ok(response) => response,
        Err(error) => HttpResponse::Forbidden().body(error.to_string()),
    }
}

#[derive(Clone)]
struct SendFileRuntime {
    id: String,
    file_name: String,
    mime_type: String,
    modified: Option<String>,
    path: PathBuf,
    size: u64,
}

impl SendFileRuntime {
    fn to_wire(&self) -> WireFileDto {
        WireFileDto {
            id: self.id.clone(),
            file_name: self.file_name.clone(),
            size: self.size,
            file_type: self.mime_type.clone(),
            sha256: None,
            preview: None,
            metadata: Some(WireFileMetadata {
                modified: self.modified.clone(),
                accessed: None,
            }),
        }
    }
}

impl DataTransferPublishedFileRecord {
    fn from_runtime(file: &SendFileRuntime) -> Self {
        Self {
            id: file.id.clone(),
            file_name: file.file_name.clone(),
            relative_path: None,
            size: file.size,
            mime_type: file.mime_type.clone(),
            local_path: file.path.display().to_string(),
        }
    }
}

impl LocalShareRuntime {
    fn from_record(record: DataTransferPublishedShareRecord) -> Self {
        Self {
            allowed_fingerprints: record.allowed_fingerprints,
            created_at: record.created_at,
            files: record
                .files
                .into_iter()
                .map(|item| LocalShareFileRuntime {
                    file_id: item.id,
                    file_name: item.file_name,
                    local_path: PathBuf::from(item.local_path),
                    mime_type: item.mime_type,
                    relative_path: item.relative_path,
                    size: item.size,
                })
                .collect(),
            id: record.id,
            password_hash: record.password_hash,
            scope: record.scope,
            title: record.title,
            total_bytes: record.total_bytes,
            updated_at: record.updated_at,
        }
    }

    fn to_snapshot(&self) -> DataTransferPublishedShare {
        DataTransferPublishedShare {
            id: self.id.clone(),
            title: self.title.clone(),
            scope: self.scope.clone(),
            file_count: self.files.len() as u64,
            total_bytes: self.total_bytes,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            files: self
                .files
                .iter()
                .map(|file| DataTransferPublishedFile {
                    id: file.file_id.clone(),
                    file_name: file.file_name.clone(),
                    relative_path: file.relative_path.clone(),
                    size: file.size,
                    mime_type: file.mime_type.clone(),
                })
                .collect(),
            allowed_fingerprints: self.allowed_fingerprints.clone(),
        }
    }

    fn can_list(
        &self,
        requester_fingerprint: &str,
        favorite_nodes: &HashMap<String, DataTransferFavoriteNode>,
    ) -> bool {
        match self.scope.as_str() {
            "all" => true,
            "favorite_only" => favorite_nodes.contains_key(requester_fingerprint),
            "password_protected" => true,
            "selected_nodes" => self
                .allowed_fingerprints
                .iter()
                .any(|item| item == requester_fingerprint),
            _ => false,
        }
    }

    fn can_download(
        &self,
        requester_fingerprint: &str,
        favorite_nodes: &HashMap<String, DataTransferFavoriteNode>,
        password: Option<&str>,
    ) -> bool {
        match self.scope.as_str() {
            "all" => true,
            "favorite_only" => favorite_nodes.contains_key(requester_fingerprint),
            "password_protected" => password
                .map(hash_share_password)
                .is_some_and(|hash| hash == self.password_hash),
            "selected_nodes" => self
                .allowed_fingerprints
                .iter()
                .any(|item| item == requester_fingerprint),
            _ => false,
        }
    }
}

fn prune_runtime(state: &mut ServiceState) {
    let _ = state;
}

fn create_multicast_socket() -> Result<std::net::UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    socket.bind(&SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), DATA_TRANSFER_PORT).into())?;
    socket.join_multicast_v4(&MULTICAST_ADDR, &Ipv4Addr::UNSPECIFIED)?;
    socket.set_nonblocking(true)?;
    Ok(socket.into())
}

fn peer_ip(request: &HttpRequest) -> IpAddr {
    request
        .peer_addr()
        .map(|item| item.ip())
        .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))
}

fn resolve_default_download_dir(app_data_dir: &Path) -> PathBuf {
    dirs::download_dir()
        .unwrap_or_else(|| app_data_dir.join("downloads"))
        .join("zszc-data-transfer")
}

fn private_ipv4_addresses() -> Result<Vec<Ipv4Addr>> {
    let mut result = Vec::new();
    for iface in get_if_addrs()? {
        let IfAddr::V4(addr) = iface.addr else {
            continue;
        };
        if addr.ip.is_loopback() || !addr.ip.is_private() {
            continue;
        }
        result.push(addr.ip);
    }
    Ok(result)
}

fn validate_share_scope(scope: &str) -> Result<()> {
    ensure!(
        matches!(
            scope,
            "all" | "favorite_only" | "password_protected" | "selected_nodes"
        ),
        "共享范围不支持: {scope}"
    );
    Ok(())
}

fn hash_share_password(password: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(password.trim().as_bytes());
    hex::encode(hasher.finalize())
}

fn default_share_title(files: &[SendFileRuntime]) -> String {
    if files.len() == 1 {
        files[0].file_name.clone()
    } else {
        format!("{} 个文件", files.len())
    }
}

fn collect_publish_files(paths: &[String]) -> Result<Vec<SendFileRuntime>> {
    collect_send_files(paths)
}

fn collect_send_files(paths: &[String]) -> Result<Vec<SendFileRuntime>> {
    let mut files = Vec::new();
    for path in paths {
        let file_path = PathBuf::from(path);
        let metadata = std::fs::metadata(&file_path)
            .with_context(|| format!("读取文件信息失败: {}", file_path.display()))?;
        ensure!(
            metadata.is_file(),
            "仅支持发送普通文件: {}",
            file_path.display()
        );
        let file_name = file_path
            .file_name()
            .and_then(|item| item.to_str())
            .map(str::to_string)
            .context("文件名无效")?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|item| item.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|item| item.as_secs().to_string());
        files.push(SendFileRuntime {
            id: stable_file_id(
                &file_name,
                metadata.len(),
                modified.as_deref().unwrap_or_default(),
            ),
            file_name,
            mime_type: mime_guess::from_path(&file_path)
                .first_or_octet_stream()
                .essence_str()
                .to_string(),
            modified,
            path: file_path,
            size: metadata.len(),
        });
    }
    Ok(files)
}

fn stable_file_id(file_name: &str, size: u64, modified: &str) -> String {
    let mut hasher = sha1::Sha1::new();
    use sha1::Digest;
    hasher.update(file_name.as_bytes());
    hasher.update(size.to_string().as_bytes());
    hasher.update(modified.as_bytes());
    hex::encode(hasher.finalize())
}

async fn ensure_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path)
        .await
        .with_context(|| format!("创建目录失败: {}", path.display()))?;
    Ok(())
}

async fn existing_file_length(path: &Path) -> Result<u64> {
    match fs::metadata(path).await {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error).with_context(|| format!("读取文件长度失败: {}", path.display())),
    }
}

async fn unique_download_path(base_dir: &Path, file_name: &str) -> Result<PathBuf> {
    let sanitized = sanitize_file_name(file_name);
    let candidate = base_dir.join(&sanitized);
    if !candidate.exists() {
        return Ok(candidate);
    }

    let stem = Path::new(&sanitized)
        .file_stem()
        .and_then(|item| item.to_str())
        .unwrap_or("file");
    let extension = Path::new(&sanitized)
        .extension()
        .and_then(|item| item.to_str())
        .map(|item| format!(".{item}"))
        .unwrap_or_default();

    for index in 1..=9999_u32 {
        let candidate = base_dir.join(format!("{stem} ({index}){extension}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(anyhow!("无法生成可用的保存文件名"))
}

fn sanitize_file_name(file_name: &str) -> String {
    let invalid = Regex::new(r#"[\\/:*?"<>|\r\n]+"#).expect("invalid filename regex");
    let sanitized = invalid.replace_all(file_name.trim(), "_");
    if sanitized.is_empty() {
        "unnamed.file".to_string()
    } else {
        sanitized.to_string()
    }
}

fn sanitize_file_stem(value: &str) -> String {
    value
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() {
                item
            } else {
                '_'
            }
        })
        .collect()
}

fn parse_range_header(
    value: Option<&HeaderValue>,
    file_size: u64,
) -> Result<(u64, actix_web::http::StatusCode)> {
    let Some(value) = value else {
        return Ok((0, actix_web::http::StatusCode::OK));
    };
    let raw = value.to_str().context("Range 头格式无效")?;
    let Some(offset_text) = raw
        .strip_prefix("bytes=")
        .and_then(|item| item.strip_suffix('-'))
    else {
        return Ok((0, actix_web::http::StatusCode::OK));
    };
    let start = offset_text.parse::<u64>().context("Range 起始位置无效")?;
    ensure!(start < file_size, "Range 超出文件范围");
    Ok((start, actix_web::http::StatusCode::PARTIAL_CONTENT))
}

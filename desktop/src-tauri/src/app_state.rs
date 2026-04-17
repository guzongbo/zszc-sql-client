use crate::compare_service::CompareService;
use crate::compare_task_manager::{DataCompareTaskManager, StructureCompareTaskManager};
use crate::data_transfer::DataTransferService;
use crate::local_store::LocalStore;
use crate::mysql_service::MysqlService;
use crate::plugin_host::PluginHost;
use crate::redis_service::RedisService;
use crate::runtime_metrics::RuntimeMetricsService;
use crate::structure_compare_service::StructureCompareService;
use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub app_name: String,
    pub app_data_dir: PathBuf,
    pub local_store: Arc<LocalStore>,
    pub mysql_service: Arc<MysqlService>,
    pub redis_service: Arc<RedisService>,
    pub compare_service: Arc<CompareService>,
    pub structure_compare_service: Arc<StructureCompareService>,
    pub compare_tasks: DataCompareTaskManager,
    pub structure_compare_tasks: StructureCompareTaskManager,
    pub plugin_host: Arc<PluginHost>,
    pub runtime_metrics_service: Arc<RuntimeMetricsService>,
    pub data_transfer_service: Arc<DataTransferService>,
}

impl AppState {
    pub fn new(
        app_name: impl Into<String>,
        app_data_dir: PathBuf,
        local_store: LocalStore,
    ) -> Result<Self> {
        let app_name = app_name.into();
        let local_store = Arc::new(local_store);

        Ok(Self {
            app_name: app_name.clone(),
            app_data_dir: app_data_dir.clone(),
            local_store: local_store.clone(),
            mysql_service: Arc::new(MysqlService::default()),
            redis_service: Arc::new(RedisService),
            compare_service: Arc::new(CompareService::default()),
            structure_compare_service: Arc::new(StructureCompareService::default()),
            compare_tasks: DataCompareTaskManager::default(),
            structure_compare_tasks: StructureCompareTaskManager::default(),
            plugin_host: Arc::new(PluginHost::new(app_data_dir.clone())?),
            runtime_metrics_service: Arc::new(RuntimeMetricsService::new()?),
            data_transfer_service: DataTransferService::new(&app_name, app_data_dir, local_store)?,
        })
    }
}

use crate::compare_service::CompareService;
use crate::compare_task_manager::CompareTaskManager;
use crate::local_store::LocalStore;
use crate::mysql_service::MysqlService;
use crate::plugin_host::PluginHost;
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
    pub compare_service: Arc<CompareService>,
    pub structure_compare_service: Arc<StructureCompareService>,
    pub compare_tasks: CompareTaskManager,
    pub plugin_host: Arc<PluginHost>,
}

impl AppState {
    pub fn new(
        app_name: impl Into<String>,
        app_data_dir: PathBuf,
        local_store: LocalStore,
    ) -> Result<Self> {
        Ok(Self {
            app_name: app_name.into(),
            app_data_dir: app_data_dir.clone(),
            local_store: Arc::new(local_store),
            mysql_service: Arc::new(MysqlService::default()),
            compare_service: Arc::new(CompareService::default()),
            structure_compare_service: Arc::new(StructureCompareService::default()),
            compare_tasks: CompareTaskManager::default(),
            plugin_host: Arc::new(PluginHost::new(app_data_dir.clone())?),
        })
    }
}

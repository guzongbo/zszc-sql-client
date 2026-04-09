use crate::local_store::LocalStore;
use crate::mysql_service::MysqlService;
use anyhow::Result;
use std::path::PathBuf;

#[derive(Debug)]
pub struct AppState {
    pub app_name: String,
    pub app_data_dir: PathBuf,
    pub local_store: LocalStore,
    pub mysql_service: MysqlService,
}

impl AppState {
    pub fn new(
        app_name: impl Into<String>,
        app_data_dir: PathBuf,
        local_store: LocalStore,
    ) -> Result<Self> {
        Ok(Self {
            app_name: app_name.into(),
            app_data_dir,
            local_store,
            mysql_service: MysqlService::default(),
        })
    }
}

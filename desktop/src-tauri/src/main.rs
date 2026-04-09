mod app_state;
mod commands;
mod local_store;
mod models;
mod mysql_service;

use crate::app_state::AppState;
use crate::local_store::LocalStore;
use anyhow::Context;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tracing::info;
use tracing_subscriber::EnvFilter;

fn init_tracing() -> anyhow::Result<()> {
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_target(false)
        .compact()
        .try_init()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;

    Ok(())
}

fn ensure_app_data_dir(app_handle: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .context("无法解析桌面端数据目录")?;

    fs::create_dir_all(&app_data_dir).context("无法创建桌面端数据目录")?;

    Ok(app_data_dir)
}

fn main() {
    if let Err(error) = init_tracing() {
        eprintln!("failed to initialize tracing: {error}");
    }

    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = ensure_app_data_dir(app.handle())?;
            let local_store = LocalStore::new(app_data_dir.join("zszc-sql-client.db"))?;
            let app_state = AppState::new("ZSZC SQL Client", app_data_dir.clone(), local_store)?;

            info!(
                app_data_dir = %app_data_dir.display(),
                database_path = %app_state.local_store.database_path().display(),
                "desktop shell initialized"
            );

            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_bootstrap,
            commands::save_connection_profile,
            commands::delete_connection_profile,
            commands::test_connection_profile,
            commands::disconnect_connection_profile,
            commands::list_profile_databases,
            commands::create_database,
            commands::list_database_tables,
            commands::list_table_columns,
            commands::load_table_design,
            commands::preview_table_design_sql,
            commands::preview_create_table_sql,
            commands::apply_table_design_changes,
            commands::create_table,
            commands::get_table_ddl,
            commands::load_table_data,
            commands::preview_table_data_changes,
            commands::apply_table_data_changes,
            commands::execute_sql,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start tauri application");
}

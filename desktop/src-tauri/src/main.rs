mod app_state;
mod commands;
mod compare_core;
mod compare_service;
mod compare_task_manager;
mod local_store;
mod models;
mod mysql_service;
mod navicat;
mod structure_compare_service;

use crate::app_state::AppState;
use crate::local_store::LocalStore;
use anyhow::Context;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, RunEvent};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

const LOCAL_STORE_FILE_NAME: &str = "zszc-sql-client.db";

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
    let base_app_data_dir = app_handle
        .path()
        .app_data_dir()
        .context("无法解析桌面端数据目录")?;

    if cfg!(debug_assertions) {
        let debug_app_data_dir = base_app_data_dir.join("dev");
        fs::create_dir_all(&debug_app_data_dir).context("无法创建开发环境数据目录")?;
        migrate_legacy_debug_store(&base_app_data_dir, &debug_app_data_dir)?;
        return Ok(debug_app_data_dir);
    }

    fs::create_dir_all(&base_app_data_dir).context("无法创建桌面端数据目录")?;
    Ok(base_app_data_dir)
}

fn migrate_legacy_debug_store(base_dir: &Path, debug_dir: &Path) -> anyhow::Result<()> {
    let base_database = base_dir.join(LOCAL_STORE_FILE_NAME);
    let debug_database = debug_dir.join(LOCAL_STORE_FILE_NAME);

    if !base_database.exists() || debug_database.exists() {
        return Ok(());
    }

    // 旧版本开发态与正式包共用同一目录，这里在首次启动新开发版时把遗留库搬到 dev 目录。
    for file_name in [
        LOCAL_STORE_FILE_NAME.to_string(),
        format!("{LOCAL_STORE_FILE_NAME}-wal"),
        format!("{LOCAL_STORE_FILE_NAME}-shm"),
    ] {
        let source = base_dir.join(&file_name);
        if !source.exists() {
            continue;
        }

        let target = debug_dir.join(&file_name);
        fs::rename(&source, &target).with_context(|| {
            format!(
                "无法迁移旧开发环境数据文件: {} -> {}",
                source.display(),
                target.display()
            )
        })?;
    }

    Ok(())
}

fn main() {
    if let Err(error) = init_tracing() {
        eprintln!("failed to initialize tracing: {error}");
    }

    let app = tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = ensure_app_data_dir(app.handle())?;
            let local_store = LocalStore::new(app_data_dir.join(LOCAL_STORE_FILE_NAME))?;
            let app_state = AppState::new("ZSZC SQL Client", app_data_dir.clone(), local_store)?;

            info!(
                app_data_dir = %app_data_dir.display(),
                data_profile = if cfg!(debug_assertions) { "dev" } else { "release" },
                database_path = %app_state.local_store.database_path().display(),
                "desktop shell initialized"
            );

            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_bootstrap,
            commands::create_data_source_group,
            commands::rename_data_source_group,
            commands::delete_data_source_group,
            commands::save_connection_profile,
            commands::import_navicat_connection_profiles,
            commands::delete_connection_profile,
            commands::test_connection_profile,
            commands::disconnect_connection_profile,
            commands::list_profile_databases,
            commands::create_database,
            commands::list_database_tables,
            commands::load_sql_autocomplete,
            commands::compare_discover_tables,
            commands::compare_run,
            commands::compare_start,
            commands::compare_progress,
            commands::compare_result,
            commands::compare_cancel,
            commands::files_choose_sql_path,
            commands::files_choose_export_path,
            commands::compare_detail_page,
            commands::compare_export_sql_file,
            commands::structure_compare_run,
            commands::structure_compare_detail,
            commands::structure_compare_export_sql_file,
            commands::compare_history_list,
            commands::compare_history_add,
            commands::list_table_columns,
            commands::load_table_design,
            commands::preview_table_design_sql,
            commands::preview_create_table_sql,
            commands::apply_table_design_changes,
            commands::create_table,
            commands::get_table_ddl,
            commands::load_table_data,
            commands::export_table_data_file,
            commands::export_table_data_sql_text,
            commands::preview_table_data_changes,
            commands::apply_table_data_changes,
            commands::execute_sql,
            commands::export_query_result_file,
            commands::export_query_result_sql_text,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                if let Err(error) = state.mysql_service.disconnect_all() {
                    warn!(error = %error, "failed to disconnect mysql pools before exit");
                }
            }
        }
    });
}

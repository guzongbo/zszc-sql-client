use anyhow::Context;
use rusqlite::Connection;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct AppOverview {
    app_name: String,
    storage_engine: String,
    app_data_dir: String,
    default_database: String,
}

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

fn initialize_local_database(app_data_dir: &Path) -> anyhow::Result<PathBuf> {
    let database_path = app_data_dir.join("zszc-sql-client.db");
    let connection = Connection::open(&database_path).context("无法初始化本地 sqlite 数据库")?;

    // 预先创建元数据表，保证后续连接管理和查询历史可直接复用同一个本地库。
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        INSERT OR IGNORE INTO app_meta (key, value)
        VALUES ('bootstrap', 'ready');
        ",
    )?;

    Ok(database_path)
}

#[tauri::command]
fn app_overview(app_handle: tauri::AppHandle) -> Result<AppOverview, String> {
    let app_data_dir = ensure_app_data_dir(&app_handle).map_err(|error| error.to_string())?;
    let database_path =
        initialize_local_database(&app_data_dir).map_err(|error| error.to_string())?;

    Ok(AppOverview {
        app_name: "ZSZC SQL Client".to_string(),
        storage_engine: "sqlite".to_string(),
        app_data_dir: app_data_dir.display().to_string(),
        default_database: database_path.display().to_string(),
    })
}

fn main() {
    if let Err(error) = init_tracing() {
        eprintln!("failed to initialize tracing: {error}");
    }

    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = ensure_app_data_dir(app.handle())?;
            let database_path = initialize_local_database(&app_data_dir)?;

            info!(
                app_data_dir = %app_data_dir.display(),
                database_path = %database_path.display(),
                "desktop shell initialized"
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_overview])
        .run(tauri::generate_context!())
        .expect("failed to start tauri application");
}

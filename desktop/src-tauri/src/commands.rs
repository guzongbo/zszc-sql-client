use crate::app_state::AppState;
use crate::models::{
    AppBootstrap, ApplyTableDataChangesPayload, ConnectionProfile, ConnectionTestResult,
    CreateDatabasePayload, CreateTablePayload, DatabaseEntry, ExecuteSqlPayload,
    LoadTableDataPayload, MutationResult, SaveConnectionProfilePayload, SqlConsoleResult,
    SqlPreview, TableColumnSummary, TableDataPage, TableDdl, TableDesign,
    TableDesignMutationPayload, TableEntry, TableIdentity,
};
use anyhow::Result;
use tauri::State;

#[tauri::command]
pub fn get_app_bootstrap(state: State<'_, AppState>) -> Result<AppBootstrap, String> {
    let profiles = state
        .local_store
        .list_connection_profiles()
        .map_err(to_error_message)?;

    Ok(AppBootstrap {
        app_name: state.app_name.clone(),
        storage_engine: "sqlite".to_string(),
        app_data_dir: state.app_data_dir.display().to_string(),
        connection_profiles: profiles,
    })
}

#[tauri::command]
pub fn save_connection_profile(
    state: State<'_, AppState>,
    payload: SaveConnectionProfilePayload,
) -> Result<ConnectionProfile, String> {
    let profile = state
        .local_store
        .save_connection_profile(payload)
        .map_err(to_error_message)?;

    state
        .mysql_service
        .disconnect(&profile.id)
        .map_err(to_error_message)?;

    Ok(profile)
}

#[tauri::command]
pub fn delete_connection_profile(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), String> {
    state
        .local_store
        .delete_connection_profile(&profile_id)
        .map_err(to_error_message)?;

    state
        .mysql_service
        .disconnect(&profile_id)
        .map_err(to_error_message)?;

    Ok(())
}

#[tauri::command]
pub fn test_connection_profile(
    state: State<'_, AppState>,
    payload: SaveConnectionProfilePayload,
) -> Result<ConnectionTestResult, String> {
    let profile = payload_to_profile(payload);
    state
        .mysql_service
        .test_connection(&profile)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn disconnect_connection_profile(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), String> {
    state
        .mysql_service
        .disconnect(&profile_id)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn list_profile_databases(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<DatabaseEntry>, String> {
    let profile = load_profile(&state, &profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .list_databases(&profile)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn create_database(
    state: State<'_, AppState>,
    payload: CreateDatabasePayload,
) -> Result<MutationResult, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .create_database(&profile, &payload.database_name)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn list_database_tables(
    state: State<'_, AppState>,
    profile_id: String,
    database_name: String,
) -> Result<Vec<TableEntry>, String> {
    let profile = load_profile(&state, &profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .list_tables(&profile, &database_name)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn list_table_columns(
    state: State<'_, AppState>,
    payload: TableIdentity,
) -> Result<Vec<TableColumnSummary>, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .list_table_columns(&profile, &payload.database_name, &payload.table_name)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn load_table_design(
    state: State<'_, AppState>,
    payload: TableIdentity,
) -> Result<TableDesign, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .load_table_design(&profile, &payload.database_name, &payload.table_name)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn preview_table_design_sql(
    state: State<'_, AppState>,
    payload: TableDesignMutationPayload,
) -> Result<SqlPreview, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .preview_table_design_sql(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn preview_create_table_sql(
    state: State<'_, AppState>,
    payload: CreateTablePayload,
) -> Result<SqlPreview, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .preview_create_table_sql(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn apply_table_design_changes(
    state: State<'_, AppState>,
    payload: TableDesignMutationPayload,
) -> Result<MutationResult, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .apply_table_design_changes(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn create_table(
    state: State<'_, AppState>,
    payload: CreateTablePayload,
) -> Result<MutationResult, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .create_table(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn get_table_ddl(
    state: State<'_, AppState>,
    payload: TableIdentity,
) -> Result<TableDdl, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .get_table_ddl(&profile, &payload.database_name, &payload.table_name)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn load_table_data(
    state: State<'_, AppState>,
    payload: LoadTableDataPayload,
) -> Result<TableDataPage, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .load_table_data(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn apply_table_data_changes(
    state: State<'_, AppState>,
    payload: ApplyTableDataChangesPayload,
) -> Result<MutationResult, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .apply_table_data_changes(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn preview_table_data_changes(
    state: State<'_, AppState>,
    payload: ApplyTableDataChangesPayload,
) -> Result<SqlPreview, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .preview_table_data_changes(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn execute_sql(
    state: State<'_, AppState>,
    payload: ExecuteSqlPayload,
) -> Result<SqlConsoleResult, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .execute_sql(&profile, &payload)
        .map_err(to_error_message)
}

fn load_profile(state: &State<'_, AppState>, profile_id: &str) -> Result<ConnectionProfile> {
    state.local_store.load_connection_profile(profile_id)
}

fn payload_to_profile(payload: SaveConnectionProfilePayload) -> ConnectionProfile {
    ConnectionProfile {
        id: payload.id.unwrap_or_else(|| "__temporary__".to_string()),
        group_name: payload.group_name,
        data_source_name: payload.data_source_name,
        host: payload.host,
        port: payload.port,
        username: payload.username,
        password: payload.password,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

fn to_error_message(error: anyhow::Error) -> String {
    error.to_string()
}

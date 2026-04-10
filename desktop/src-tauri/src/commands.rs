use crate::app_state::AppState;
use crate::compare_service::{CompareExecutionControl, CompareExecutionUpdate};
use crate::models::{
    AppBootstrap, ApplyTableDataChangesPayload, ChooseFilePayload, CompareDetailPageRequest,
    CompareDetailPageResponse, CompareHistoryInput, CompareHistoryItem,
    CompareTableDiscoveryRequest, CompareTableDiscoveryResponse, CompareTaskCancelResponse,
    CompareTaskProgressResponse, CompareTaskResultResponse, CompareTaskStartResponse,
    ConnectionProfile, ConnectionTestResult, CreateDataSourceGroupPayload, CreateDatabasePayload,
    CreateTablePayload, DataCompareRequest, DataCompareResponse, DataSourceGroup, DatabaseEntry,
    DeleteDataSourceGroupResult, ExecuteSqlPayload, ExportDataFileResponse,
    ExportQueryResultFileRequest, ExportQueryResultSqlTextRequest, ExportSqlFileRequest,
    ExportSqlFileResponse, ExportSqlTextResponse, ExportTableDataFileRequest,
    ExportTableDataSqlTextRequest, ImportConnectionProfilesResult, LoadSqlAutocompletePayload,
    LoadTableDataPayload, MutationResult, RenameDataSourceGroupPayload,
    RenameDataSourceGroupResult, SaveConnectionProfilePayload, SaveFileDialogResult,
    SqlAutocompleteSchema, SqlConsoleResult, SqlPreview, StructureCompareDetailRequest,
    StructureCompareDetailResponse, StructureCompareRequest, StructureCompareResponse,
    StructureExportSqlFileRequest, StructureExportSqlFileResponse, TableColumnSummary,
    TableDataPage, TableDdl, TableDesign, TableDesignMutationPayload, TableEntry, TableIdentity,
};
use crate::navicat::parse_navicat_connections;
use anyhow::{Result, anyhow};
use arboard::Clipboard;
use rfd::FileDialog;
use std::fs;
use std::sync::atomic::Ordering;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn get_app_bootstrap(state: State<'_, AppState>) -> Result<AppBootstrap, String> {
    let profiles = state
        .local_store
        .list_connection_profiles()
        .map_err(to_error_message)?;
    let groups = state
        .local_store
        .list_data_source_groups()
        .map_err(to_error_message)?;

    Ok(AppBootstrap {
        app_name: state.app_name.clone(),
        storage_engine: "sqlite".to_string(),
        app_data_dir: state.app_data_dir.display().to_string(),
        connection_profiles: profiles,
        data_source_groups: groups,
    })
}

#[tauri::command]
pub fn create_data_source_group(
    state: State<'_, AppState>,
    payload: CreateDataSourceGroupPayload,
) -> Result<DataSourceGroup, String> {
    state
        .local_store
        .create_data_source_group(payload.group_name)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn rename_data_source_group(
    state: State<'_, AppState>,
    payload: RenameDataSourceGroupPayload,
) -> Result<RenameDataSourceGroupResult, String> {
    state
        .local_store
        .rename_data_source_group(&payload.group_id, payload.group_name)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn delete_data_source_group(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<DeleteDataSourceGroupResult, String> {
    state
        .local_store
        .delete_data_source_group(&group_id)
        .map_err(to_error_message)
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
pub fn import_navicat_connection_profiles(
    state: State<'_, AppState>,
) -> Result<ImportConnectionProfilesResult, String> {
    let Some(file_path) = FileDialog::new()
        .add_filter("Navicat Connections", &["ncx"])
        .pick_file()
    else {
        return Ok(ImportConnectionProfilesResult {
            canceled: true,
            file_path: None,
            total_count: 0,
            created_count: 0,
            updated_count: 0,
            unresolved_password_count: 0,
            skipped_count: 0,
            imported_items: vec![],
            skipped_items: vec![],
        });
    };

    let xml = fs::read_to_string(&file_path).map_err(|error| error.to_string())?;
    let parsed = parse_navicat_connections(&xml).map_err(to_error_message)?;
    state
        .local_store
        .import_connection_profiles(
            parsed.connections,
            parsed.skipped_items,
            Some(file_path.display().to_string()),
        )
        .map_err(to_error_message)
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
pub fn load_sql_autocomplete(
    state: State<'_, AppState>,
    payload: LoadSqlAutocompletePayload,
) -> Result<SqlAutocompleteSchema, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .load_sql_autocomplete(&profile, &payload.database_name)
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn compare_discover_tables(
    state: State<'_, AppState>,
    payload: CompareTableDiscoveryRequest,
) -> Result<CompareTableDiscoveryResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let source_profile =
        load_profile(&state, &payload.source_profile_id).map_err(to_error_message)?;
    let target_profile =
        load_profile(&state, &payload.target_profile_id).map_err(to_error_message)?;
    state
        .compare_service
        .discover_tables(&payload, &source_profile, &target_profile)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn compare_run(
    state: State<'_, AppState>,
    payload: DataCompareRequest,
) -> Result<DataCompareResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let source_profile =
        load_profile(&state, &payload.source_profile_id).map_err(to_error_message)?;
    let target_profile =
        load_profile(&state, &payload.target_profile_id).map_err(to_error_message)?;
    state
        .compare_service
        .compare(&payload, &source_profile, &target_profile)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn compare_start(
    state: State<'_, AppState>,
    payload: DataCompareRequest,
) -> Result<CompareTaskStartResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let source_profile =
        load_profile(&state, &payload.source_profile_id).map_err(to_error_message)?;
    let target_profile =
        load_profile(&state, &payload.target_profile_id).map_err(to_error_message)?;

    let compare_id = Uuid::new_v4().to_string();
    let compare_service = state.compare_service.clone();
    let compare_tasks = state.compare_tasks.clone();
    compare_tasks.register(compare_id.clone());

    let task_compare_id = compare_id.clone();
    tauri::async_runtime::spawn(async move {
        let Some(cancel_flag) = compare_tasks.cancel_flag(&task_compare_id) else {
            return;
        };

        let progress_compare_id = task_compare_id.clone();
        let progress_tasks = compare_tasks.clone();
        let payload_for_task = payload.clone();
        let source_profile_for_task = source_profile.clone();
        let target_profile_for_task = target_profile.clone();

        let report_progress = move |update: CompareExecutionUpdate| {
            progress_tasks.report_progress(
                &progress_compare_id,
                update.total_tables,
                update.completed_tables,
                update.current_table,
                update.current_phase,
                update.current_phase_progress,
            );
        };
        let is_cancelled = move || cancel_flag.load(Ordering::SeqCst);
        let control = CompareExecutionControl {
            compare_id: Some(task_compare_id.as_str()),
            on_progress: Some(&report_progress),
            is_cancelled: Some(&is_cancelled),
        };

        let outcome = compare_service
            .compare_with_control(
                &payload_for_task,
                &source_profile_for_task,
                &target_profile_for_task,
                Some(&control),
            )
            .await;

        match outcome {
            Ok(result) => compare_tasks.finish_success(&task_compare_id, result),
            Err(error) if error.to_string().contains("已取消") => {
                compare_tasks.finish_canceled(&task_compare_id, error.to_string())
            }
            Err(error) => compare_tasks.finish_failure(&task_compare_id, error.to_string()),
        }
    });

    Ok(CompareTaskStartResponse { compare_id })
}

#[tauri::command]
pub fn compare_progress(
    state: State<'_, AppState>,
    compare_id: String,
) -> Result<CompareTaskProgressResponse, String> {
    state
        .compare_tasks
        .progress(&compare_id)
        .ok_or_else(|| format!("未找到 compare_id={compare_id} 对应的数据对比任务"))
}

#[tauri::command]
pub fn compare_result(
    state: State<'_, AppState>,
    compare_id: String,
) -> Result<CompareTaskResultResponse, String> {
    state
        .compare_tasks
        .take_result(&compare_id)
        .ok_or_else(|| format!("未找到 compare_id={compare_id} 对应的数据对比任务"))
}

#[tauri::command]
pub fn compare_cancel(
    state: State<'_, AppState>,
    compare_id: String,
) -> Result<CompareTaskCancelResponse, String> {
    Ok(state.compare_tasks.request_cancel(&compare_id))
}

fn save_file_with_dialog(
    payload: Option<ChooseFilePayload>,
    default_filters: &[(&str, &[&str])],
) -> Result<SaveFileDialogResult, String> {
    let mut dialog = FileDialog::new();
    let mut applied_filter = false;

    if let Some(filters) = payload
        .as_ref()
        .and_then(|item| item.filters.as_ref())
        .filter(|items| !items.is_empty())
    {
        for filter in filters {
            let extensions = filter
                .extensions
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            if extensions.is_empty() {
                continue;
            }
            dialog = dialog.add_filter(&filter.name, &extensions);
            applied_filter = true;
        }
    }

    if !applied_filter {
        for (name, extensions) in default_filters {
            dialog = dialog.add_filter(*name, extensions);
        }
    }

    if let Some(default_file_name) = payload
        .and_then(|item| item.default_file_name)
        .filter(|item| !item.trim().is_empty())
    {
        dialog = dialog.set_file_name(&default_file_name);
    }

    let file_path = dialog.save_file();
    Ok(SaveFileDialogResult {
        canceled: file_path.is_none(),
        file_path: file_path.map(|item| item.display().to_string()),
    })
}

#[tauri::command]
pub fn files_choose_sql_path(
    payload: Option<ChooseFilePayload>,
) -> Result<SaveFileDialogResult, String> {
    save_file_with_dialog(payload, &[("SQL File", &["sql"])])
}

#[tauri::command]
pub fn files_choose_export_path(
    payload: Option<ChooseFilePayload>,
) -> Result<SaveFileDialogResult, String> {
    save_file_with_dialog(payload, &[("CSV File", &["csv"]), ("JSON File", &["json"])])
}

#[tauri::command]
pub fn clipboard_write_text(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(to_error_message)?;
    clipboard.set_text(text).map_err(to_error_message)
}

#[tauri::command]
pub async fn compare_detail_page(
    state: State<'_, AppState>,
    payload: CompareDetailPageRequest,
) -> Result<CompareDetailPageResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let source_profile = load_profile(&state, &payload.compare_request.source_profile_id)
        .map_err(to_error_message)?;
    let target_profile = load_profile(&state, &payload.compare_request.target_profile_id)
        .map_err(to_error_message)?;

    state
        .compare_service
        .load_detail_page(&payload, &source_profile, &target_profile)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn compare_export_sql_file(
    state: State<'_, AppState>,
    payload: ExportSqlFileRequest,
) -> Result<ExportSqlFileResponse, String> {
    payload
        .compare_request
        .validate()
        .map_err(to_error_message)?;
    if payload.file_path.trim().is_empty() {
        return Err("file_path 不能为空".to_string());
    }
    let source_profile = load_profile(&state, &payload.compare_request.source_profile_id)
        .map_err(to_error_message)?;
    let target_profile = load_profile(&state, &payload.compare_request.target_profile_id)
        .map_err(to_error_message)?;

    state
        .compare_service
        .export_sql_file(&payload, &source_profile, &target_profile)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn structure_compare_run(
    state: State<'_, AppState>,
    payload: StructureCompareRequest,
) -> Result<StructureCompareResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let source_profile =
        load_profile(&state, &payload.source_profile_id).map_err(to_error_message)?;
    let target_profile =
        load_profile(&state, &payload.target_profile_id).map_err(to_error_message)?;

    state
        .structure_compare_service
        .compare(&payload, &source_profile, &target_profile)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn structure_compare_detail(
    state: State<'_, AppState>,
    payload: StructureCompareDetailRequest,
) -> Result<StructureCompareDetailResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let source_profile = load_profile(&state, &payload.compare_request.source_profile_id)
        .map_err(to_error_message)?;
    let target_profile = load_profile(&state, &payload.compare_request.target_profile_id)
        .map_err(to_error_message)?;

    state
        .structure_compare_service
        .load_detail(&payload, &source_profile, &target_profile)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn structure_compare_export_sql_file(
    state: State<'_, AppState>,
    payload: StructureExportSqlFileRequest,
) -> Result<StructureExportSqlFileResponse, String> {
    payload
        .compare_request
        .validate()
        .map_err(to_error_message)?;
    if payload.file_path.trim().is_empty() {
        return Err("file_path 不能为空".to_string());
    }
    let source_profile = load_profile(&state, &payload.compare_request.source_profile_id)
        .map_err(to_error_message)?;
    let target_profile = load_profile(&state, &payload.compare_request.target_profile_id)
        .map_err(to_error_message)?;

    state
        .structure_compare_service
        .export_sql_file(&payload, &source_profile, &target_profile)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub fn compare_history_list(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<CompareHistoryItem>, String> {
    state
        .local_store
        .list_compare_history(limit.unwrap_or(100))
        .map_err(to_error_message)
}

#[tauri::command]
pub fn compare_history_add(
    state: State<'_, AppState>,
    payload: CompareHistoryInput,
) -> Result<CompareHistoryItem, String> {
    state
        .local_store
        .append_compare_history(payload)
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
pub fn export_table_data_file(
    state: State<'_, AppState>,
    payload: ExportTableDataFileRequest,
) -> Result<ExportDataFileResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let profile =
        load_profile(&state, &payload.load_payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .export_table_data_file(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn export_table_data_sql_text(
    state: State<'_, AppState>,
    payload: ExportTableDataSqlTextRequest,
) -> Result<ExportSqlTextResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let profile =
        load_profile(&state, &payload.load_payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .export_table_data_sql_text(&profile, &payload)
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

#[tauri::command]
pub fn export_query_result_file(
    state: State<'_, AppState>,
    payload: ExportQueryResultFileRequest,
) -> Result<ExportDataFileResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let profile =
        load_profile(&state, &payload.execute_payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .export_query_result_file(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn export_query_result_sql_text(
    state: State<'_, AppState>,
    payload: ExportQueryResultSqlTextRequest,
) -> Result<ExportSqlTextResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let profile =
        load_profile(&state, &payload.execute_payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .export_query_result_sql_text(&profile, &payload)
        .map_err(to_error_message)
}

fn load_profile(state: &State<'_, AppState>, profile_id: &str) -> Result<ConnectionProfile> {
    state
        .local_store
        .load_connection_profile(profile_id)
        .map_err(|error| anyhow!(error.to_string()))
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

fn to_error_message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

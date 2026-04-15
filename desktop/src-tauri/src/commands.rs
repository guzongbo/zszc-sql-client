use crate::app_state::AppState;
use crate::compare_service::{CompareExecutionControl, CompareExecutionUpdate};
use crate::models::{
    AppBootstrap, ApplyTableDataChangesPayload, AssignProfilesToDataSourceGroupPayload,
    AssignProfilesToDataSourceGroupResult, ChooseFilePayload, CompareDetailPageRequest,
    CompareDetailPageResponse, CompareHistoryInput, CompareHistoryItem, CompareHistorySummary,
    CompareTableDiscoveryRequest, CompareTableDiscoveryResponse, CompareTaskCancelResponse,
    CompareTaskProgressResponse, CompareTaskResultResponse, CompareTaskStartResponse,
    ConnectionProfile, ConnectionTestResult, CreateDataSourceGroupPayload, CreateDatabasePayload,
    CreateTablePayload, DataCompareRequest, DataCompareResponse, DataSourceGroup, DatabaseEntry,
    DeleteDataSourceGroupResult, ExecuteSqlPayload, ExportDataFileResponse,
    ExportQueryResultFileRequest, ExportQueryResultSqlTextRequest, ExportSqlFileRequest,
    ExportSqlFileResponse, ExportSqlTextResponse, ExportTableDataFileRequest,
    ExportTableDataSqlTextRequest, ImportConnectionProfilesResult, LoadSqlAutocompletePayload,
    LoadTableDataPayload, MutationResult, PluginBackendRpcRequest, PluginBackendRpcResponse,
    PluginFrontendDocument, PluginInstallDialogResult, PluginOperationResult,
    RedisConnectionProfile, RedisConnectionTestResult, RedisDeleteHashFieldPayload,
    RedisHashFieldPayload, RedisKeyDetail, RedisKeyDetailRequest, RedisKeyIdentity,
    RedisRenameKeyPayload, RedisScanKeysRequest, RedisScanKeysResponse, RedisSetKeyTtlPayload,
    RedisStringValuePayload, RenameDataSourceGroupPayload, RenameDataSourceGroupResult,
    RuntimeMetrics, SaveConnectionProfilePayload, SaveFileDialogResult, SaveRedisConnectionPayload,
    SqlAutocompleteSchema, SqlConsoleResult, SqlPreview, StructureCompareDetailRequest,
    StructureCompareDetailResponse, StructureCompareRequest, StructureCompareResponse,
    StructureCompareTaskResultResponse, StructureExportSqlFileRequest,
    StructureExportSqlFileResponse, TableColumnSummary, TableDataPage, TableDdl, TableDesign,
    TableDesignMutationPayload, TableEntry, TableIdentity,
};
use crate::navicat::parse_navicat_connections;
use crate::plugin_host::{PLUGIN_PACKAGE_EXTENSION, empty_install_dialog_result};
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
        .map_err(to_error_message)?
        .into_iter()
        .map(sanitize_connection_profile)
        .collect();
    let groups = state
        .local_store
        .list_data_source_groups()
        .map_err(to_error_message)?;
    let installed_plugins = state
        .plugin_host
        .list_installed_plugins()
        .map_err(to_error_message)?;

    Ok(AppBootstrap {
        app_name: state.app_name.clone(),
        storage_engine: "sqlite".to_string(),
        app_data_dir: state.app_data_dir.display().to_string(),
        current_platform: state.plugin_host.current_platform().to_string(),
        plugin_package_extension: PLUGIN_PACKAGE_EXTENSION.to_string(),
        installed_plugins,
        connection_profiles: profiles,
        data_source_groups: groups,
    })
}

#[tauri::command]
pub fn get_runtime_metrics(state: State<'_, AppState>) -> Result<RuntimeMetrics, String> {
    state
        .runtime_metrics_service
        .snapshot()
        .map_err(to_error_message)
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
pub fn assign_profiles_to_data_source_group(
    state: State<'_, AppState>,
    payload: AssignProfilesToDataSourceGroupPayload,
) -> Result<AssignProfilesToDataSourceGroupResult, String> {
    state
        .local_store
        .assign_profiles_to_data_source_group(&payload.group_id, payload.profile_ids)
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn save_connection_profile(
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
        .await
        .map_err(to_error_message)?;

    Ok(sanitize_connection_profile(profile))
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
pub async fn delete_connection_profile(
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
        .await
        .map_err(to_error_message)?;

    Ok(())
}

#[tauri::command]
pub async fn test_connection_profile(
    state: State<'_, AppState>,
    payload: SaveConnectionProfilePayload,
) -> Result<ConnectionTestResult, String> {
    let profile = resolve_connection_profile_payload(&state, payload).map_err(to_error_message)?;
    state
        .mysql_service
        .test_connection(&profile)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn disconnect_connection_profile(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), String> {
    state
        .mysql_service
        .disconnect(&profile_id)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn list_profile_databases(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<DatabaseEntry>, String> {
    let profile = load_profile(&state, &profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .list_databases(&profile)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn create_database(
    state: State<'_, AppState>,
    payload: CreateDatabasePayload,
) -> Result<MutationResult, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .create_database(&profile, &payload.database_name)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn list_database_tables(
    state: State<'_, AppState>,
    profile_id: String,
    database_name: String,
) -> Result<Vec<TableEntry>, String> {
    let profile = load_profile(&state, &profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .list_tables(&profile, &database_name)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn load_sql_autocomplete(
    state: State<'_, AppState>,
    payload: LoadSqlAutocompletePayload,
) -> Result<SqlAutocompleteSchema, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .load_sql_autocomplete(&profile, &payload.database_name)
        .await
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
            Ok(result) => {
                let total_tables = result.summary.total_tables;
                compare_tasks.finish_success(&task_compare_id, result, total_tables);
            }
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
        .map(|snapshot| CompareTaskResultResponse {
            compare_id: snapshot.compare_id,
            status: snapshot.status,
            result: snapshot.result,
            error_message: snapshot.error_message,
        })
        .ok_or_else(|| format!("未找到 compare_id={compare_id} 对应的数据对比任务"))
}

#[tauri::command]
pub fn compare_cancel(
    state: State<'_, AppState>,
    compare_id: String,
) -> Result<CompareTaskCancelResponse, String> {
    Ok(state.compare_tasks.request_cancel(&compare_id))
}

#[tauri::command]
pub fn compare_cleanup_cache(state: State<'_, AppState>, compare_id: String) -> Result<(), String> {
    state
        .compare_service
        .cleanup_compare_cache(&compare_id)
        .map_err(to_error_message)
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
pub fn plugins_list_installed(
    state: State<'_, AppState>,
) -> Result<Vec<crate::models::InstalledPlugin>, String> {
    state
        .plugin_host
        .list_installed_plugins()
        .map_err(to_error_message)
}

#[tauri::command]
pub fn plugins_install_from_disk(
    state: State<'_, AppState>,
) -> Result<PluginInstallDialogResult, String> {
    let Some(package_path) = FileDialog::new()
        .add_filter("ZSZC Plugin", &[PLUGIN_PACKAGE_EXTENSION])
        .pick_file()
    else {
        return Ok(empty_install_dialog_result());
    };

    let plugin = state
        .plugin_host
        .install_from_package(&package_path)
        .map_err(to_error_message)?;

    Ok(PluginInstallDialogResult {
        canceled: false,
        plugin: Some(plugin),
    })
}

#[tauri::command]
pub fn plugins_uninstall(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<PluginOperationResult, String> {
    state
        .plugin_host
        .uninstall(&plugin_id)
        .map_err(to_error_message)?;

    Ok(PluginOperationResult { plugin_id })
}

#[tauri::command]
pub fn plugins_read_frontend_entry(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<PluginFrontendDocument, String> {
    state
        .plugin_host
        .read_frontend_document(&plugin_id)
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn plugins_backend_rpc(
    state: State<'_, AppState>,
    payload: PluginBackendRpcRequest,
) -> Result<PluginBackendRpcResponse, String> {
    let result = state
        .plugin_host
        .backend_rpc(&payload.plugin_id, &payload.method, payload.params)
        .await
        .map_err(to_error_message)?;

    Ok(PluginBackendRpcResponse { result })
}

#[tauri::command]
pub fn redis_list_connections(
    state: State<'_, AppState>,
) -> Result<Vec<RedisConnectionProfile>, String> {
    state
        .local_store
        .list_redis_connection_profiles()
        .map(|profiles| {
            profiles
                .into_iter()
                .map(sanitize_redis_connection_profile)
                .collect()
        })
        .map_err(to_error_message)
}

#[tauri::command]
pub fn redis_save_connection(
    state: State<'_, AppState>,
    payload: SaveRedisConnectionPayload,
) -> Result<RedisConnectionProfile, String> {
    state
        .local_store
        .save_redis_connection_profile(payload)
        .map(sanitize_redis_connection_profile)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn redis_delete_connection(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), String> {
    state
        .local_store
        .delete_redis_connection_profile(&profile_id)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn redis_test_connection(
    state: State<'_, AppState>,
    payload: SaveRedisConnectionPayload,
) -> Result<RedisConnectionTestResult, String> {
    let profile = resolve_redis_connection_payload(&state, payload).map_err(to_error_message)?;
    state
        .redis_service
        .test_connection(&profile)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn redis_connect(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<RedisConnectionTestResult, String> {
    let profile = load_redis_profile(&state, &profile_id).map_err(to_error_message)?;
    state
        .redis_service
        .test_connection(&profile)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn redis_disconnect(_state: State<'_, AppState>, _profile_id: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn redis_scan_keys(
    state: State<'_, AppState>,
    payload: RedisScanKeysRequest,
) -> Result<RedisScanKeysResponse, String> {
    let profile = load_redis_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .redis_service
        .scan_keys(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn redis_get_key_detail(
    state: State<'_, AppState>,
    payload: RedisKeyDetailRequest,
) -> Result<RedisKeyDetail, String> {
    let profile = load_redis_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .redis_service
        .load_key_detail(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn redis_set_string_value(
    state: State<'_, AppState>,
    payload: RedisStringValuePayload,
) -> Result<MutationResult, String> {
    let profile = load_redis_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .redis_service
        .set_string_value(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn redis_set_hash_field(
    state: State<'_, AppState>,
    payload: RedisHashFieldPayload,
) -> Result<MutationResult, String> {
    let profile = load_redis_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .redis_service
        .set_hash_field(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn redis_delete_hash_field(
    state: State<'_, AppState>,
    payload: RedisDeleteHashFieldPayload,
) -> Result<MutationResult, String> {
    let profile = load_redis_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .redis_service
        .delete_hash_field(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn redis_delete_key(
    state: State<'_, AppState>,
    payload: RedisKeyIdentity,
) -> Result<MutationResult, String> {
    let profile = load_redis_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .redis_service
        .delete_key(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn redis_rename_key(
    state: State<'_, AppState>,
    payload: RedisRenameKeyPayload,
) -> Result<MutationResult, String> {
    let profile = load_redis_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .redis_service
        .rename_key(&profile, &payload)
        .map_err(to_error_message)
}

#[tauri::command]
pub fn redis_set_key_ttl(
    state: State<'_, AppState>,
    payload: RedisSetKeyTtlPayload,
) -> Result<MutationResult, String> {
    let profile = load_redis_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .redis_service
        .set_key_ttl(&profile, &payload)
        .map_err(to_error_message)
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
pub async fn structure_compare_start(
    state: State<'_, AppState>,
    payload: StructureCompareRequest,
) -> Result<CompareTaskStartResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let source_profile =
        load_profile(&state, &payload.source_profile_id).map_err(to_error_message)?;
    let target_profile =
        load_profile(&state, &payload.target_profile_id).map_err(to_error_message)?;

    let compare_id = Uuid::new_v4().to_string();
    let structure_compare_service = state.structure_compare_service.clone();
    let structure_compare_tasks = state.structure_compare_tasks.clone();
    structure_compare_tasks.register(compare_id.clone());

    let task_compare_id = compare_id.clone();
    tauri::async_runtime::spawn(async move {
        structure_compare_tasks.report_progress(
            &task_compare_id,
            0,
            0,
            None,
            crate::models::CompareTaskPhase::LoadStructureMetadata,
            None,
        );

        let Some(cancel_notifier) = structure_compare_tasks.cancel_notifier(&task_compare_id)
        else {
            return;
        };

        let outcome = tokio::select! {
            result = structure_compare_service.compare(&payload, &source_profile, &target_profile) => result,
            _ = cancel_notifier.notified() => Err(anyhow!("结构对比任务已取消")),
        };

        match outcome {
            Ok(result) => {
                let total_tables = result.summary.added_table_count
                    + result.summary.modified_table_count
                    + result.summary.deleted_table_count;
                structure_compare_tasks.finish_success(&task_compare_id, result, total_tables);
            }
            Err(error) if error.to_string().contains("已取消") => {
                structure_compare_tasks.finish_canceled(&task_compare_id, error.to_string())
            }
            Err(error) => {
                structure_compare_tasks.finish_failure(&task_compare_id, error.to_string())
            }
        }
    });

    Ok(CompareTaskStartResponse { compare_id })
}

#[tauri::command]
pub fn structure_compare_progress(
    state: State<'_, AppState>,
    compare_id: String,
) -> Result<CompareTaskProgressResponse, String> {
    state
        .structure_compare_tasks
        .progress(&compare_id)
        .ok_or_else(|| format!("未找到 compare_id={compare_id} 对应的结构对比任务"))
}

#[tauri::command]
pub fn structure_compare_result(
    state: State<'_, AppState>,
    compare_id: String,
) -> Result<StructureCompareTaskResultResponse, String> {
    state
        .structure_compare_tasks
        .take_result(&compare_id)
        .map(|snapshot| StructureCompareTaskResultResponse {
            compare_id: snapshot.compare_id,
            status: snapshot.status,
            result: snapshot.result,
            error_message: snapshot.error_message,
        })
        .ok_or_else(|| format!("未找到 compare_id={compare_id} 对应的结构对比任务"))
}

#[tauri::command]
pub fn structure_compare_cancel(
    state: State<'_, AppState>,
    compare_id: String,
) -> Result<CompareTaskCancelResponse, String> {
    Ok(state.structure_compare_tasks.request_cancel(&compare_id))
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
) -> Result<Vec<CompareHistorySummary>, String> {
    state
        .local_store
        .list_compare_history_summaries(limit.unwrap_or(100))
        .map_err(to_error_message)
}

#[tauri::command]
pub fn compare_history_detail(
    state: State<'_, AppState>,
    history_id: i64,
) -> Result<Option<CompareHistoryItem>, String> {
    state
        .local_store
        .load_compare_history_detail(history_id)
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
pub async fn list_table_columns(
    state: State<'_, AppState>,
    payload: TableIdentity,
) -> Result<Vec<TableColumnSummary>, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .list_table_columns(&profile, &payload.database_name, &payload.table_name)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn load_table_design(
    state: State<'_, AppState>,
    payload: TableIdentity,
) -> Result<TableDesign, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .load_table_design(&profile, &payload.database_name, &payload.table_name)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn preview_table_design_sql(
    state: State<'_, AppState>,
    payload: TableDesignMutationPayload,
) -> Result<SqlPreview, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .preview_table_design_sql(&profile, &payload)
        .await
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
pub async fn apply_table_design_changes(
    state: State<'_, AppState>,
    payload: TableDesignMutationPayload,
) -> Result<MutationResult, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .apply_table_design_changes(&profile, &payload)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn create_table(
    state: State<'_, AppState>,
    payload: CreateTablePayload,
) -> Result<MutationResult, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .create_table(&profile, &payload)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn get_table_ddl(
    state: State<'_, AppState>,
    payload: TableIdentity,
) -> Result<TableDdl, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .get_table_ddl(&profile, &payload.database_name, &payload.table_name)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn load_table_data(
    state: State<'_, AppState>,
    payload: LoadTableDataPayload,
) -> Result<TableDataPage, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .load_table_data(&profile, &payload)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn export_table_data_file(
    state: State<'_, AppState>,
    payload: ExportTableDataFileRequest,
) -> Result<ExportDataFileResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let profile =
        load_profile(&state, &payload.load_payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .export_table_data_file(&profile, &payload)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn export_table_data_sql_text(
    state: State<'_, AppState>,
    payload: ExportTableDataSqlTextRequest,
) -> Result<ExportSqlTextResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let profile =
        load_profile(&state, &payload.load_payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .export_table_data_sql_text(&profile, &payload)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn apply_table_data_changes(
    state: State<'_, AppState>,
    payload: ApplyTableDataChangesPayload,
) -> Result<MutationResult, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .apply_table_data_changes(&profile, &payload)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn preview_table_data_changes(
    state: State<'_, AppState>,
    payload: ApplyTableDataChangesPayload,
) -> Result<SqlPreview, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .preview_table_data_changes(&profile, &payload)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn execute_sql(
    state: State<'_, AppState>,
    payload: ExecuteSqlPayload,
) -> Result<SqlConsoleResult, String> {
    let profile = load_profile(&state, &payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .execute_sql(&profile, &payload)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn export_query_result_file(
    state: State<'_, AppState>,
    payload: ExportQueryResultFileRequest,
) -> Result<ExportDataFileResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let profile =
        load_profile(&state, &payload.execute_payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .export_query_result_file(&profile, &payload)
        .await
        .map_err(to_error_message)
}

#[tauri::command]
pub async fn export_query_result_sql_text(
    state: State<'_, AppState>,
    payload: ExportQueryResultSqlTextRequest,
) -> Result<ExportSqlTextResponse, String> {
    payload.validate().map_err(to_error_message)?;
    let profile =
        load_profile(&state, &payload.execute_payload.profile_id).map_err(to_error_message)?;
    state
        .mysql_service
        .export_query_result_sql_text(&profile, &payload)
        .await
        .map_err(to_error_message)
}

fn load_profile(state: &State<'_, AppState>, profile_id: &str) -> Result<ConnectionProfile> {
    state
        .local_store
        .load_connection_profile(profile_id)
        .map_err(|error| anyhow!(error.to_string()))
}

fn load_redis_profile(
    state: &State<'_, AppState>,
    profile_id: &str,
) -> Result<RedisConnectionProfile> {
    state
        .local_store
        .load_redis_connection_profile(profile_id)
        .map_err(|error| anyhow!(error.to_string()))
}

fn payload_to_profile(
    payload: SaveConnectionProfilePayload,
    password: String,
) -> ConnectionProfile {
    ConnectionProfile {
        id: payload.id.unwrap_or_else(|| "__temporary__".to_string()),
        group_name: payload.group_name,
        data_source_name: payload.data_source_name,
        host: payload.host,
        port: payload.port,
        username: payload.username,
        password,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

fn redis_payload_to_profile(
    payload: SaveRedisConnectionPayload,
    password: String,
) -> RedisConnectionProfile {
    RedisConnectionProfile {
        id: payload.id.unwrap_or_else(|| "__temporary__".to_string()),
        group_name: payload.group_name,
        connection_name: payload.connection_name,
        host: payload.host,
        port: payload.port,
        username: payload.username,
        password,
        database_index: payload.database_index,
        connect_timeout_ms: payload.connect_timeout_ms,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

fn resolve_connection_profile_payload(
    state: &State<'_, AppState>,
    payload: SaveConnectionProfilePayload,
) -> Result<ConnectionProfile> {
    let password = resolve_connection_password(state, payload.id.as_deref(), &payload.password)?;
    anyhow::ensure!(!password.is_empty(), "密码不能为空");
    Ok(payload_to_profile(payload, password))
}

fn resolve_redis_connection_payload(
    state: &State<'_, AppState>,
    payload: SaveRedisConnectionPayload,
) -> Result<RedisConnectionProfile> {
    let password =
        resolve_redis_connection_password(state, payload.id.as_deref(), &payload.password)?;
    Ok(redis_payload_to_profile(payload, password))
}

fn resolve_connection_password(
    state: &State<'_, AppState>,
    profile_id: Option<&str>,
    raw_password: &str,
) -> Result<String> {
    if !raw_password.is_empty() {
        return Ok(raw_password.to_string());
    }

    if let Some(profile_id) = profile_id {
        return Ok(state
            .local_store
            .load_connection_profile(profile_id)?
            .password);
    }

    Ok(String::new())
}

fn resolve_redis_connection_password(
    state: &State<'_, AppState>,
    profile_id: Option<&str>,
    raw_password: &str,
) -> Result<String> {
    if !raw_password.is_empty() {
        return Ok(raw_password.to_string());
    }

    if let Some(profile_id) = profile_id {
        return Ok(state
            .local_store
            .load_redis_connection_profile(profile_id)?
            .password);
    }

    Ok(String::new())
}

fn sanitize_connection_profile(mut profile: ConnectionProfile) -> ConnectionProfile {
    profile.password.clear();
    profile
}

fn sanitize_redis_connection_profile(
    mut profile: RedisConnectionProfile,
) -> RedisConnectionProfile {
    profile.password.clear();
    profile
}

fn to_error_message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

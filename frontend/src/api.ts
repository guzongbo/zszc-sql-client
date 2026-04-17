import { mockApi } from './mockData'
import { dataTransferMockApi } from './features/data-transfer/mockApi'
import type {
  AssignProfilesToDataSourceGroupPayload,
  AssignProfilesToDataSourceGroupResult,
  AppBootstrap,
  ApplyTableDataChangesPayload,
  ChooseFilePayload,
  CompareDetailPageRequest,
  CompareDetailPageResponse,
  CompareHistoryInput,
  CompareHistoryItem,
  CompareHistorySummary,
  CompareTableDiscoveryRequest,
  CompareTableDiscoveryResponse,
  CompareTaskCancelResponse,
  CompareTaskProgressResponse,
  CompareTaskResultResponse,
  CompareTaskStartResponse,
  ConnectionProfile,
  ConnectionTestResult,
  CreateDataSourceGroupPayload,
  CreateDatabasePayload,
  CreateTablePayload,
  DataCompareRequest,
  DataCompareResponse,
  DataTransferChooseFilesResult,
  DataTransferChooseFolderResult,
  DataTransferDirectSendPayload,
  DataTransferDownloadSharePayload,
  DataTransferFavoritePayload,
  DataTransferPublishPayload,
  DataTransferResolveSelectedFilesPayload,
  DataTransferRemoteShareResponse,
  DataTransferSelectedFile,
  DataTransferSnapshot,
  DataTransferTaskCancelResponse,
  DataTransferTaskStartResponse,
  DatabaseEntry,
  DataSourceGroup,
  DeleteDataSourceGroupResult,
  ExecuteSqlPayload,
  ExportDataFileResponse,
  ExportQueryResultFileRequest,
  ExportQueryResultSqlTextRequest,
  ExportSqlFileRequest,
  ExportSqlFileResponse,
  ExportSqlTextResponse,
  ExportTableDataFileRequest,
  ExportTableDataSqlTextRequest,
  ImportConnectionProfilesResult,
  LoadSqlAutocompletePayload,
  LoadTableDataPayload,
  MutationResult,
  InstalledPlugin,
  PluginFrontendDocument,
  PluginInstallDialogResult,
  PluginOperationResult,
  RedisConnectionProfile,
  RedisConnectionTestResult,
  RedisDeleteHashFieldPayload,
  RedisHashFieldPayload,
  RedisKeyDetail,
  RedisKeyDetailRequest,
  RedisKeyIdentity,
  RedisRenameKeyPayload,
  RedisScanKeysRequest,
  RedisScanKeysResponse,
  RedisSetKeyTtlPayload,
  RedisStringValuePayload,
  RenameDataSourceGroupPayload,
  RenameDataSourceGroupResult,
  SaveConnectionProfilePayload,
  SaveRedisConnectionPayload,
  SaveFileDialogResult,
  RuntimeMetrics,
  SqlAutocompleteSchema,
  SqlConsoleResult,
  SqlPreview,
  StructureCompareDetailRequest,
  StructureCompareDetailResponse,
  StructureCompareRequest,
  StructureCompareResponse,
  StructureCompareTaskResultResponse,
  StructureExportSqlFileRequest,
  StructureExportSqlFileResponse,
  TableColumnSummary,
  TableDataPage,
  TableDesign,
  TableDesignMutationPayload,
  TableDdl,
  TableEntry,
  TableIdentity,
} from './types'

function isDesktopShell() {
  return '__TAURI_INTERNALS__' in window
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export async function writeClipboardText(text: string): Promise<void> {
  if (!isDesktopShell()) {
    throw new Error('当前不是桌面端环境')
  }
  await invokeCommand<void>('clipboard_write_text', { text })
}

export async function getAppBootstrap(): Promise<AppBootstrap> {
  if (!isDesktopShell()) {
    return mockApi.getAppBootstrap()
  }
  return invokeCommand<AppBootstrap>('get_app_bootstrap')
}

export async function getRuntimeMetrics(): Promise<RuntimeMetrics | null> {
  if (!isDesktopShell()) {
    return null
  }
  return invokeCommand<RuntimeMetrics>('get_runtime_metrics')
}

export async function getDataTransferSnapshot(): Promise<DataTransferSnapshot> {
  if (!isDesktopShell()) {
    return dataTransferMockApi.getSnapshot()
  }
  return invokeCommand<DataTransferSnapshot>('data_transfer_get_snapshot')
}

export async function setDataTransferRegistrationEnabled(
  enabled: boolean,
): Promise<DataTransferSnapshot> {
  if (!isDesktopShell()) {
    return dataTransferMockApi.setRegistrationEnabled({ enabled })
  }
  return invokeCommand<DataTransferSnapshot>('data_transfer_set_registration_enabled', {
    payload: { enabled },
  })
}

export async function refreshDataTransferDiscovery(): Promise<DataTransferSnapshot> {
  if (!isDesktopShell()) {
    return dataTransferMockApi.refreshDiscovery()
  }
  return invokeCommand<DataTransferSnapshot>('data_transfer_refresh_discovery')
}

export async function updateDataTransferFavorite(
  payload: DataTransferFavoritePayload,
): Promise<DataTransferSnapshot> {
  if (!isDesktopShell()) {
    return dataTransferMockApi.updateFavorite(payload)
  }
  return invokeCommand<DataTransferSnapshot>('data_transfer_update_favorite', { payload })
}

export async function chooseDataTransferFiles(): Promise<DataTransferChooseFilesResult> {
  if (!isDesktopShell()) {
    return dataTransferMockApi.chooseFiles()
  }
  return invokeCommand<DataTransferChooseFilesResult>('data_transfer_choose_files')
}

export async function chooseDataTransferFolder(): Promise<DataTransferChooseFolderResult> {
  if (!isDesktopShell()) {
    return dataTransferMockApi.chooseFolder()
  }
  return invokeCommand<DataTransferChooseFolderResult>('data_transfer_choose_folder')
}

export async function resolveDataTransferSelectedFiles(
  payload: DataTransferResolveSelectedFilesPayload,
): Promise<DataTransferSelectedFile[]> {
  if (!isDesktopShell()) {
    return dataTransferMockApi.resolveSelectedFiles(payload)
  }
  return invokeCommand<DataTransferSelectedFile[]>('data_transfer_resolve_selected_files', {
    payload,
  })
}

export async function startDataTransferDirectSend(
  payload: DataTransferDirectSendPayload,
): Promise<DataTransferTaskStartResponse> {
  if (!isDesktopShell()) {
    return dataTransferMockApi.startDirectSend(payload)
  }
  return invokeCommand<DataTransferTaskStartResponse>('data_transfer_start_direct_send', {
    payload,
  })
}

export async function publishDataTransferFiles(
  payload: DataTransferPublishPayload,
): Promise<DataTransferSnapshot> {
  if (!isDesktopShell()) {
    return dataTransferMockApi.publishFiles(payload)
  }
  return invokeCommand<DataTransferSnapshot>('data_transfer_publish_files', { payload })
}

export async function removeDataTransferPublishedShare(
  shareId: string,
): Promise<DataTransferSnapshot> {
  if (!isDesktopShell()) {
    return dataTransferMockApi.removePublishedShare({ share_id: shareId })
  }
  return invokeCommand<DataTransferSnapshot>('data_transfer_remove_published_share', {
    payload: { share_id: shareId },
  })
}

export async function loadDataTransferRemoteShares(
  nodeId: string,
): Promise<DataTransferRemoteShareResponse> {
  if (!isDesktopShell()) {
    return dataTransferMockApi.loadRemoteShares({ node_id: nodeId })
  }
  return invokeCommand<DataTransferRemoteShareResponse>('data_transfer_load_remote_shares', {
    payload: { node_id: nodeId },
  })
}

export async function downloadDataTransferShare(
  payload: DataTransferDownloadSharePayload,
): Promise<DataTransferTaskStartResponse> {
  if (!isDesktopShell()) {
    return dataTransferMockApi.downloadShare(payload)
  }
  return invokeCommand<DataTransferTaskStartResponse>('data_transfer_download_share', {
    payload,
  })
}

export async function cancelDataTransferTask(
  taskId: string,
): Promise<DataTransferTaskCancelResponse> {
  if (!isDesktopShell()) {
    return dataTransferMockApi.cancelTask(taskId)
  }
  return invokeCommand<DataTransferTaskCancelResponse>('data_transfer_cancel_task', {
    taskId,
  })
}

export async function createDataSourceGroup(
  payload: CreateDataSourceGroupPayload,
): Promise<DataSourceGroup> {
  if (!isDesktopShell()) {
    return mockApi.createDataSourceGroup(payload)
  }
  return invokeCommand<DataSourceGroup>('create_data_source_group', { payload })
}

export async function renameDataSourceGroup(
  payload: RenameDataSourceGroupPayload,
): Promise<RenameDataSourceGroupResult> {
  if (!isDesktopShell()) {
    return mockApi.renameDataSourceGroup(payload)
  }
  return invokeCommand<RenameDataSourceGroupResult>('rename_data_source_group', {
    payload,
  })
}

export async function deleteDataSourceGroup(
  groupId: string,
): Promise<DeleteDataSourceGroupResult> {
  if (!isDesktopShell()) {
    return mockApi.deleteDataSourceGroup(groupId)
  }
  return invokeCommand<DeleteDataSourceGroupResult>('delete_data_source_group', {
    groupId,
  })
}

export async function assignProfilesToDataSourceGroup(
  payload: AssignProfilesToDataSourceGroupPayload,
): Promise<AssignProfilesToDataSourceGroupResult> {
  if (!isDesktopShell()) {
    return mockApi.assignProfilesToDataSourceGroup(payload)
  }
  return invokeCommand<AssignProfilesToDataSourceGroupResult>(
    'assign_profiles_to_data_source_group',
    { payload },
  )
}

export async function importNavicatConnectionProfiles(): Promise<ImportConnectionProfilesResult> {
  if (!isDesktopShell()) {
    return mockApi.importNavicatConnectionProfiles()
  }
  return invokeCommand<ImportConnectionProfilesResult>(
    'import_navicat_connection_profiles',
  )
}

export async function saveConnectionProfile(
  payload: SaveConnectionProfilePayload,
): Promise<ConnectionProfile> {
  if (!isDesktopShell()) {
    return mockApi.saveConnectionProfile(payload)
  }
  return invokeCommand<ConnectionProfile>('save_connection_profile', { payload })
}

export async function deleteConnectionProfile(profileId: string) {
  if (!isDesktopShell()) {
    return mockApi.deleteConnectionProfile(profileId)
  }
  return invokeCommand<void>('delete_connection_profile', { profileId })
}

export async function testConnectionProfile(
  payload: SaveConnectionProfilePayload,
): Promise<ConnectionTestResult> {
  if (!isDesktopShell()) {
    return mockApi.testConnectionProfile()
  }
  return invokeCommand<ConnectionTestResult>('test_connection_profile', { payload })
}

export async function disconnectConnectionProfile(profileId: string) {
  if (!isDesktopShell()) {
    return mockApi.disconnectConnectionProfile()
  }
  return invokeCommand<void>('disconnect_connection_profile', { profileId })
}

export async function listProfileDatabases(
  profileId: string,
): Promise<DatabaseEntry[]> {
  if (!isDesktopShell()) {
    return mockApi.listProfileDatabases(profileId)
  }
  return invokeCommand<DatabaseEntry[]>('list_profile_databases', { profileId })
}

export async function createDatabase(
  payload: CreateDatabasePayload,
): Promise<MutationResult> {
  if (!isDesktopShell()) {
    return mockApi.createDatabase(payload)
  }
  return invokeCommand<MutationResult>('create_database', { payload })
}

export async function listDatabaseTables(
  profileId: string,
  databaseName: string,
): Promise<TableEntry[]> {
  if (!isDesktopShell()) {
    return mockApi.listDatabaseTables(profileId, databaseName)
  }
  return invokeCommand<TableEntry[]>('list_database_tables', {
    profileId,
    databaseName,
  })
}

export async function loadSqlAutocomplete(
  payload: LoadSqlAutocompletePayload,
): Promise<SqlAutocompleteSchema> {
  if (!isDesktopShell()) {
    return mockApi.loadSqlAutocomplete(payload)
  }
  return invokeCommand<SqlAutocompleteSchema>('load_sql_autocomplete', { payload })
}

export async function compareDiscoverTables(
  payload: CompareTableDiscoveryRequest,
): Promise<CompareTableDiscoveryResponse> {
  if (!isDesktopShell()) {
    return mockApi.compareDiscoverTables(payload)
  }
  return invokeCommand<CompareTableDiscoveryResponse>('compare_discover_tables', {
    payload,
  })
}

export async function runDataCompare(
  payload: DataCompareRequest,
): Promise<DataCompareResponse> {
  if (!isDesktopShell()) {
    return mockApi.runDataCompare(payload)
  }
  return invokeCommand<DataCompareResponse>('compare_run', { payload })
}

export async function startDataCompareTask(
  payload: DataCompareRequest,
): Promise<CompareTaskStartResponse> {
  if (!isDesktopShell()) {
    return mockApi.startDataCompareTask(payload)
  }
  return invokeCommand<CompareTaskStartResponse>('compare_start', { payload })
}

export async function getDataCompareTaskProgress(
  compareId: string,
): Promise<CompareTaskProgressResponse> {
  if (!isDesktopShell()) {
    return mockApi.getDataCompareTaskProgress(compareId)
  }
  return invokeCommand<CompareTaskProgressResponse>('compare_progress', { compareId })
}

export async function getDataCompareTaskResult(
  compareId: string,
): Promise<CompareTaskResultResponse> {
  if (!isDesktopShell()) {
    return mockApi.getDataCompareTaskResult(compareId)
  }
  return invokeCommand<CompareTaskResultResponse>('compare_result', { compareId })
}

export async function cancelDataCompareTask(
  compareId: string,
): Promise<CompareTaskCancelResponse> {
  if (!isDesktopShell()) {
    return mockApi.cancelDataCompareTask(compareId)
  }
  return invokeCommand<CompareTaskCancelResponse>('compare_cancel', { compareId })
}

export async function cleanupDataCompareCache(compareId: string): Promise<void> {
  if (!isDesktopShell()) {
    return mockApi.cleanupDataCompareCache(compareId)
  }
  return invokeCommand<void>('compare_cleanup_cache', { compareId })
}

export async function chooseSqlExportPath(
  payload?: ChooseFilePayload,
): Promise<SaveFileDialogResult> {
  if (!isDesktopShell()) {
    return mockApi.chooseSqlExportPath(payload)
  }
  return invokeCommand<SaveFileDialogResult>('files_choose_sql_path', { payload })
}

export async function chooseExportPath(
  payload?: ChooseFilePayload,
): Promise<SaveFileDialogResult> {
  if (!isDesktopShell()) {
    return mockApi.chooseExportPath(payload)
  }
  return invokeCommand<SaveFileDialogResult>('files_choose_export_path', { payload })
}

export async function loadDataCompareDetailPage(
  payload: CompareDetailPageRequest,
): Promise<CompareDetailPageResponse> {
  if (!isDesktopShell()) {
    return mockApi.loadDataCompareDetailPage(payload)
  }
  return invokeCommand<CompareDetailPageResponse>('compare_detail_page', {
    payload,
  })
}

export async function exportDataCompareSqlFile(
  payload: ExportSqlFileRequest,
): Promise<ExportSqlFileResponse> {
  if (!isDesktopShell()) {
    return mockApi.exportDataCompareSqlFile(payload)
  }
  return invokeCommand<ExportSqlFileResponse>('compare_export_sql_file', { payload })
}

export async function runStructureCompare(
  payload: StructureCompareRequest,
): Promise<StructureCompareResponse> {
  if (!isDesktopShell()) {
    return mockApi.runStructureCompare(payload)
  }
  return invokeCommand<StructureCompareResponse>('structure_compare_run', { payload })
}

export async function startStructureCompareTask(
  payload: StructureCompareRequest,
): Promise<CompareTaskStartResponse> {
  if (!isDesktopShell()) {
    return mockApi.startStructureCompareTask(payload)
  }
  return invokeCommand<CompareTaskStartResponse>('structure_compare_start', { payload })
}

export async function getStructureCompareTaskProgress(
  compareId: string,
): Promise<CompareTaskProgressResponse> {
  if (!isDesktopShell()) {
    return mockApi.getStructureCompareTaskProgress(compareId)
  }
  return invokeCommand<CompareTaskProgressResponse>('structure_compare_progress', {
    compareId,
  })
}

export async function getStructureCompareTaskResult(
  compareId: string,
): Promise<StructureCompareTaskResultResponse> {
  if (!isDesktopShell()) {
    return mockApi.getStructureCompareTaskResult(compareId)
  }
  return invokeCommand<StructureCompareTaskResultResponse>('structure_compare_result', {
    compareId,
  })
}

export async function cancelStructureCompareTask(
  compareId: string,
): Promise<CompareTaskCancelResponse> {
  if (!isDesktopShell()) {
    return mockApi.cancelStructureCompareTask(compareId)
  }
  return invokeCommand<CompareTaskCancelResponse>('structure_compare_cancel', { compareId })
}

export async function loadStructureCompareDetail(
  payload: StructureCompareDetailRequest,
): Promise<StructureCompareDetailResponse> {
  if (!isDesktopShell()) {
    return mockApi.loadStructureCompareDetail(payload)
  }
  return invokeCommand<StructureCompareDetailResponse>('structure_compare_detail', {
    payload,
  })
}

export async function exportStructureCompareSqlFile(
  payload: StructureExportSqlFileRequest,
): Promise<StructureExportSqlFileResponse> {
  if (!isDesktopShell()) {
    return mockApi.exportStructureCompareSqlFile(payload)
  }
  return invokeCommand<StructureExportSqlFileResponse>('structure_compare_export_sql_file', {
    payload,
  })
}

export async function listCompareHistory(limit?: number): Promise<CompareHistorySummary[]> {
  if (!isDesktopShell()) {
    return mockApi.listCompareHistory(limit)
  }
  return invokeCommand<CompareHistorySummary[]>('compare_history_list', { limit })
}

export async function getCompareHistoryDetail(
  historyId: number,
): Promise<CompareHistoryItem | null> {
  if (!isDesktopShell()) {
    return mockApi.getCompareHistoryDetail(historyId)
  }
  return invokeCommand<CompareHistoryItem | null>('compare_history_detail', { historyId })
}

export async function addCompareHistory(
  payload: CompareHistoryInput,
): Promise<CompareHistoryItem> {
  if (!isDesktopShell()) {
    return mockApi.addCompareHistory(payload)
  }
  return invokeCommand<CompareHistoryItem>('compare_history_add', { payload })
}

export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  if (!isDesktopShell()) {
    return []
  }
  return invokeCommand<InstalledPlugin[]>('plugins_list_installed')
}

export async function installPluginFromDisk(): Promise<PluginInstallDialogResult> {
  if (!isDesktopShell()) {
    throw new Error('当前不是桌面端环境')
  }
  return invokeCommand<PluginInstallDialogResult>('plugins_install_from_disk')
}

export async function uninstallPlugin(pluginId: string): Promise<PluginOperationResult> {
  if (!isDesktopShell()) {
    throw new Error('当前不是桌面端环境')
  }
  return invokeCommand<PluginOperationResult>('plugins_uninstall', { pluginId })
}

export async function readPluginFrontendEntry(
  pluginId: string,
): Promise<PluginFrontendDocument> {
  if (!isDesktopShell()) {
    throw new Error('当前不是桌面端环境')
  }
  return invokeCommand<PluginFrontendDocument>('plugins_read_frontend_entry', {
    pluginId,
  })
}

export async function invokePluginBackend<T>(
  pluginId: string,
  method: string,
  params: unknown = null,
): Promise<T> {
  if (!isDesktopShell()) {
    throw new Error('当前不是桌面端环境')
  }
  const response = await invokeCommand<{ result: T }>('plugins_backend_rpc', {
    payload: {
      plugin_id: pluginId,
      method,
      params,
    },
  })
  return response.result
}

export async function listRedisConnections(): Promise<RedisConnectionProfile[]> {
  if (!isDesktopShell()) {
    return mockApi.listRedisConnections()
  }
  return invokeCommand<RedisConnectionProfile[]>('redis_list_connections')
}

export async function saveRedisConnection(
  payload: SaveRedisConnectionPayload,
): Promise<RedisConnectionProfile> {
  if (!isDesktopShell()) {
    return mockApi.saveRedisConnection(payload)
  }
  return invokeCommand<RedisConnectionProfile>('redis_save_connection', { payload })
}

export async function deleteRedisConnection(profileId: string): Promise<void> {
  if (!isDesktopShell()) {
    return mockApi.deleteRedisConnection(profileId)
  }
  return invokeCommand<void>('redis_delete_connection', { profileId })
}

export async function testRedisConnection(
  payload: SaveRedisConnectionPayload,
): Promise<RedisConnectionTestResult> {
  if (!isDesktopShell()) {
    return mockApi.testRedisConnection(payload)
  }
  return invokeCommand<RedisConnectionTestResult>('redis_test_connection', { payload })
}

export async function connectRedis(
  profileId: string,
): Promise<RedisConnectionTestResult> {
  if (!isDesktopShell()) {
    return mockApi.connectRedis(profileId)
  }
  return invokeCommand<RedisConnectionTestResult>('redis_connect', { profileId })
}

export async function disconnectRedis(profileId: string): Promise<void> {
  if (!isDesktopShell()) {
    return mockApi.disconnectRedis(profileId)
  }
  return invokeCommand<void>('redis_disconnect', { profileId })
}

export async function scanRedisKeys(
  payload: RedisScanKeysRequest,
): Promise<RedisScanKeysResponse> {
  if (!isDesktopShell()) {
    return mockApi.scanRedisKeys(payload)
  }
  return invokeCommand<RedisScanKeysResponse>('redis_scan_keys', { payload })
}

export async function getRedisKeyDetail(
  payload: RedisKeyDetailRequest,
): Promise<RedisKeyDetail> {
  if (!isDesktopShell()) {
    return mockApi.getRedisKeyDetail(payload)
  }
  return invokeCommand<RedisKeyDetail>('redis_get_key_detail', { payload })
}

export async function setRedisStringValue(
  payload: RedisStringValuePayload,
): Promise<MutationResult> {
  if (!isDesktopShell()) {
    return mockApi.setRedisStringValue(payload)
  }
  return invokeCommand<MutationResult>('redis_set_string_value', { payload })
}

export async function setRedisHashField(
  payload: RedisHashFieldPayload,
): Promise<MutationResult> {
  if (!isDesktopShell()) {
    return mockApi.setRedisHashField(payload)
  }
  return invokeCommand<MutationResult>('redis_set_hash_field', { payload })
}

export async function deleteRedisHashField(
  payload: RedisDeleteHashFieldPayload,
): Promise<MutationResult> {
  if (!isDesktopShell()) {
    return mockApi.deleteRedisHashField(payload)
  }
  return invokeCommand<MutationResult>('redis_delete_hash_field', { payload })
}

export async function deleteRedisKey(payload: RedisKeyIdentity): Promise<MutationResult> {
  if (!isDesktopShell()) {
    return mockApi.deleteRedisKey(payload)
  }
  return invokeCommand<MutationResult>('redis_delete_key', { payload })
}

export async function renameRedisKey(
  payload: RedisRenameKeyPayload,
): Promise<MutationResult> {
  if (!isDesktopShell()) {
    return mockApi.renameRedisKey(payload)
  }
  return invokeCommand<MutationResult>('redis_rename_key', { payload })
}

export async function setRedisKeyTtl(
  payload: RedisSetKeyTtlPayload,
): Promise<MutationResult> {
  if (!isDesktopShell()) {
    return mockApi.setRedisKeyTtl(payload)
  }
  return invokeCommand<MutationResult>('redis_set_key_ttl', { payload })
}

export async function listTableColumns(
  payload: TableIdentity,
): Promise<TableColumnSummary[]> {
  if (!isDesktopShell()) {
    return mockApi.listTableColumns(payload)
  }
  return invokeCommand<TableColumnSummary[]>('list_table_columns', { payload })
}

export async function loadTableDesign(payload: TableIdentity): Promise<TableDesign> {
  if (!isDesktopShell()) {
    return mockApi.loadTableDesign(payload)
  }
  return invokeCommand<TableDesign>('load_table_design', { payload })
}

export async function previewTableDesignSql(
  payload: TableDesignMutationPayload,
): Promise<SqlPreview> {
  if (!isDesktopShell()) {
    return mockApi.previewTableDesignSql(payload)
  }
  return invokeCommand<SqlPreview>('preview_table_design_sql', { payload })
}

export async function previewCreateTableSql(
  payload: CreateTablePayload,
): Promise<SqlPreview> {
  if (!isDesktopShell()) {
    return mockApi.previewCreateTableSql(payload)
  }
  return invokeCommand<SqlPreview>('preview_create_table_sql', { payload })
}

export async function applyTableDesignChanges(
  payload: TableDesignMutationPayload,
): Promise<MutationResult> {
  if (!isDesktopShell()) {
    return mockApi.applyTableDesignChanges(payload)
  }
  return invokeCommand<MutationResult>('apply_table_design_changes', { payload })
}

export async function createTable(payload: CreateTablePayload): Promise<MutationResult> {
  if (!isDesktopShell()) {
    return mockApi.createTable(payload)
  }
  return invokeCommand<MutationResult>('create_table', { payload })
}

export async function getTableDdl(payload: TableIdentity): Promise<TableDdl> {
  if (!isDesktopShell()) {
    return mockApi.getTableDdl(payload)
  }
  return invokeCommand<TableDdl>('get_table_ddl', { payload })
}

export async function loadTableData(
  payload: LoadTableDataPayload,
): Promise<TableDataPage> {
  if (!isDesktopShell()) {
    return mockApi.loadTableData(payload)
  }
  return invokeCommand<TableDataPage>('load_table_data', { payload })
}

export async function exportTableDataFile(
  payload: ExportTableDataFileRequest,
): Promise<ExportDataFileResponse> {
  if (!isDesktopShell()) {
    return mockApi.exportTableDataFile(payload)
  }
  return invokeCommand<ExportDataFileResponse>('export_table_data_file', { payload })
}

export async function exportTableDataSqlText(
  payload: ExportTableDataSqlTextRequest,
): Promise<ExportSqlTextResponse> {
  if (!isDesktopShell()) {
    return mockApi.exportTableDataSqlText(payload)
  }
  return invokeCommand<ExportSqlTextResponse>('export_table_data_sql_text', { payload })
}

export async function previewTableDataChanges(
  payload: ApplyTableDataChangesPayload,
): Promise<SqlPreview> {
  if (!isDesktopShell()) {
    return mockApi.previewTableDataChanges(payload)
  }
  return invokeCommand<SqlPreview>('preview_table_data_changes', { payload })
}

export async function applyTableDataChanges(
  payload: ApplyTableDataChangesPayload,
): Promise<MutationResult> {
  if (!isDesktopShell()) {
    return mockApi.applyTableDataChanges(payload)
  }
  return invokeCommand<MutationResult>('apply_table_data_changes', { payload })
}

export async function executeSql(payload: ExecuteSqlPayload): Promise<SqlConsoleResult> {
  if (!isDesktopShell()) {
    return mockApi.executeSql(payload)
  }
  return invokeCommand<SqlConsoleResult>('execute_sql', { payload })
}

export async function exportQueryResultFile(
  payload: ExportQueryResultFileRequest,
): Promise<ExportDataFileResponse> {
  if (!isDesktopShell()) {
    return mockApi.exportQueryResultFile(payload)
  }
  return invokeCommand<ExportDataFileResponse>('export_query_result_file', { payload })
}

export async function exportQueryResultSqlText(
  payload: ExportQueryResultSqlTextRequest,
): Promise<ExportSqlTextResponse> {
  if (!isDesktopShell()) {
    return mockApi.exportQueryResultSqlText(payload)
  }
  return invokeCommand<ExportSqlTextResponse>('export_query_result_sql_text', { payload })
}

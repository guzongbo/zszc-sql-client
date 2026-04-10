import { mockApi } from './mockData'
import type {
  AppBootstrap,
  ApplyTableDataChangesPayload,
  ChooseFilePayload,
  CompareDetailPageRequest,
  CompareDetailPageResponse,
  CompareHistoryInput,
  CompareHistoryItem,
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
  RenameDataSourceGroupPayload,
  RenameDataSourceGroupResult,
  SaveConnectionProfilePayload,
  SaveFileDialogResult,
  SqlAutocompleteSchema,
  SqlConsoleResult,
  SqlPreview,
  StructureCompareDetailRequest,
  StructureCompareDetailResponse,
  StructureCompareRequest,
  StructureCompareResponse,
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

export async function getAppBootstrap(): Promise<AppBootstrap> {
  if (!isDesktopShell()) {
    return mockApi.getAppBootstrap()
  }
  return invokeCommand<AppBootstrap>('get_app_bootstrap')
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

export async function listCompareHistory(limit?: number): Promise<CompareHistoryItem[]> {
  if (!isDesktopShell()) {
    return mockApi.listCompareHistory(limit)
  }
  return invokeCommand<CompareHistoryItem[]>('compare_history_list', { limit })
}

export async function addCompareHistory(
  payload: CompareHistoryInput,
): Promise<CompareHistoryItem> {
  if (!isDesktopShell()) {
    return mockApi.addCompareHistory(payload)
  }
  return invokeCommand<CompareHistoryItem>('compare_history_add', { payload })
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

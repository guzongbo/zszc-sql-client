import { mockApi } from './mockData'
import type {
  AppBootstrap,
  ApplyTableDataChangesPayload,
  ConnectionProfile,
  ConnectionTestResult,
  CreateDatabasePayload,
  CreateTablePayload,
  DatabaseEntry,
  ExecuteSqlPayload,
  LoadTableDataPayload,
  MutationResult,
  SaveConnectionProfilePayload,
  SqlConsoleResult,
  SqlPreview,
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

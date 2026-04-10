export type CellValue = string | number | boolean | null

export type JsonRecord = Record<string, CellValue>

export type AppBootstrap = {
  app_name: string
  storage_engine: string
  app_data_dir: string
  connection_profiles: ConnectionProfile[]
  data_source_groups: DataSourceGroup[]
}

export type ConnectionProfile = {
  id: string
  group_name: string | null
  data_source_name: string
  host: string
  port: number
  username: string
  password: string
  created_at: string
  updated_at: string
}

export type SaveConnectionProfilePayload = {
  id?: string | null
  group_name?: string | null
  data_source_name: string
  host: string
  port: number
  username: string
  password: string
}

export type DataSourceGroup = {
  id: string
  group_name: string
  created_at: string
  updated_at: string
}

export type CreateDataSourceGroupPayload = {
  group_name: string
}

export type RenameDataSourceGroupPayload = {
  group_id: string
  group_name: string
}

export type RenameDataSourceGroupResult = {
  group_id: string
  previous_group_name: string
  group_name: string
  affected_profile_count: number
}

export type DeleteDataSourceGroupResult = {
  group_id: string
  group_name: string
  affected_profile_count: number
}

export type AssignProfilesToDataSourceGroupPayload = {
  group_id: string
  profile_ids: string[]
}

export type AssignProfilesToDataSourceGroupResult = {
  group_id: string
  group_name: string
  affected_profile_count: number
}

export type ConnectionTestResult = {
  server_version: string
  current_database: string | null
}

export type ImportedConnectionProfileItem = {
  id: string
  data_source_name: string
  password_resolved: boolean
}

export type SkippedImportItem = {
  name: string
  reason: string
}

export type ImportConnectionProfilesResult = {
  canceled: boolean
  file_path: string | null
  total_count: number
  created_count: number
  updated_count: number
  unresolved_password_count: number
  skipped_count: number
  imported_items: ImportedConnectionProfileItem[]
  skipped_items: SkippedImportItem[]
}

export type DatabaseEntry = {
  name: string
  table_count: number
}

export type CreateDatabasePayload = {
  profile_id: string
  database_name: string
}

export type CompareTableDiscoveryRequest = {
  source_profile_id: string
  source_database_name: string
  target_profile_id: string
  target_database_name: string
}

export type CompareTableDiscoveryResponse = {
  source_tables: string[]
  target_tables: string[]
  common_tables: string[]
}

export type DataCompareRequest = {
  source_profile_id: string
  source_database_name: string
  target_profile_id: string
  target_database_name: string
  table_mode: 'all' | 'selected'
  selected_tables: string[]
  preview_limit?: number | null
}

export type RowSample = {
  signature: string
  row: JsonRecord
}

export type UpdateSample = {
  signature: string
  key: JsonRecord
  source_row: JsonRecord
  target_row: JsonRecord
  diff_columns: string[]
}

export type SkippedTable = {
  source_table: string
  target_table: string
  reason: string
}

export type TableCompareResult = {
  source_table: string
  target_table: string
  key_columns: string[]
  compared_columns: string[]
  compare_mode: string
  insert_count: number
  update_count: number
  delete_count: number
  warnings: string[]
  sample_inserts: RowSample[]
  sample_updates: UpdateSample[]
  sample_deletes: RowSample[]
}

export type CompareSummary = {
  total_tables: number
  compared_tables: number
  skipped_tables: number
  total_insert_count: number
  total_update_count: number
  total_delete_count: number
  total_sql_statements: number
}

export type DataCompareResponse = {
  compare_id: string | null
  summary: CompareSummary
  skipped_tables: SkippedTable[]
  table_results: TableCompareResult[]
  performance: CompareHistoryPerformance
}

export type CompareDetailType = 'insert' | 'update' | 'delete'

export type CompareDetailPageRequest = {
  compare_id?: string | null
  compare_request: DataCompareRequest
  source_table: string
  target_table: string
  detail_type: CompareDetailType
  expected_total?: number | null
  offset?: number | null
  limit?: number | null
}

export type CompareDetailPageResponse = {
  source_table: string
  target_table: string
  detail_type: CompareDetailType
  total: number
  offset: number
  limit: number
  has_more: boolean
  row_columns: string[]
  row_items: RowSample[]
  update_items: UpdateSample[]
}

export type CompareTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'

export type CompareTaskPhase =
  | 'pending'
  | 'discover_tables'
  | 'prepare_table'
  | 'table_checksum'
  | 'keyed_hash_scan'
  | 'chunk_hash_scan'
  | 'source_stage_load'
  | 'target_stage_load'
  | 'finalize_cache'
  | 'compare_table'
  | 'completed'

export type CompareTaskStartResponse = {
  compare_id: string
}

export type CompareTaskPhaseProgress = {
  current: number
  total: number
}

export type CompareTaskProgressResponse = {
  compare_id: string
  status: CompareTaskStatus
  total_tables: number
  completed_tables: number
  current_table: string | null
  current_phase: CompareTaskPhase | null
  current_phase_progress: CompareTaskPhaseProgress | null
  error_message: string | null
}

export type CompareTaskResultResponse = {
  compare_id: string
  status: CompareTaskStatus
  result: DataCompareResponse | null
  error_message: string | null
}

export type CompareTaskCancelResponse = {
  compare_id: string
  accepted: boolean
}

export type StructureCompareRequest = {
  source_profile_id: string
  source_database_name: string
  target_profile_id: string
  target_database_name: string
  detail_concurrency?: number | null
  preload_details?: boolean | null
}

export type CompareHistoryPerformanceStage = {
  key: string
  label: string
  elapsed_ms: number
  item_count?: number | null
  note?: string | null
}

export type CompareHistoryPerformance = {
  total_elapsed_ms: number
  stages: CompareHistoryPerformanceStage[]
  max_parallelism?: number | null
}

export type StructureTableItem = {
  table_name: string
  preview_sql: string | null
  source_sql: string | null
  target_sql: string | null
  source_changed_lines: number[]
  target_changed_lines: number[]
  warnings: string[]
}

export type StructureCompareSummary = {
  source_table_count: number
  target_table_count: number
  added_table_count: number
  modified_table_count: number
  deleted_table_count: number
}

export type StructureCompareResponse = {
  summary: StructureCompareSummary
  added_tables: StructureTableItem[]
  modified_tables: StructureTableItem[]
  deleted_tables: StructureTableItem[]
  performance: CompareHistoryPerformance
}

export type StructureDetailCategory = 'added' | 'modified' | 'deleted'

export type StructureCompareDetailRequest = {
  compare_request: StructureCompareRequest
  category: StructureDetailCategory
  table_name: string
}

export type StructureCompareDetailResponse = {
  category: StructureDetailCategory
  table_name: string
  detail: StructureTableItem
  performance: CompareHistoryPerformance
}

export type TableSqlSelection = {
  source_table: string
  target_table: string
  table_enabled: boolean
  insert_enabled: boolean
  update_enabled: boolean
  delete_enabled: boolean
  excluded_insert_signatures: string[]
  excluded_update_signatures: string[]
  excluded_delete_signatures: string[]
}

export type ExportSqlFileRequest = {
  compare_id?: string | null
  compare_request: DataCompareRequest
  table_selections: TableSqlSelection[]
  file_path: string
}

export type ExportSqlFileResponse = {
  file_path: string
  insert_count: number
  update_count: number
  delete_count: number
}

export type StructureSqlSelection = {
  added_tables: string[]
  modified_tables: string[]
  deleted_tables: string[]
}

export type StructureExportSqlFileRequest = {
  compare_request: StructureCompareRequest
  selection: StructureSqlSelection
  file_path: string
}

export type StructureExportSqlFileResponse = {
  file_path: string
  added_count: number
  modified_count: number
  deleted_count: number
}

export type SaveFileDialogResult = {
  canceled: boolean
  file_path: string | null
}

export type ChooseFileFilter = {
  name: string
  extensions: string[]
}

export type ChooseFilePayload = {
  default_file_name?: string | null
  filters?: ChooseFileFilter[] | null
}

export type ExportFileFormat = 'csv' | 'json' | 'sql'

export type ExportScope = 'current_page' | 'all_rows' | 'selected_rows'

export type ExportDataFileResponse = {
  file_path: string
  row_count: number
  export_format: ExportFileFormat
  scope: ExportScope
}

export type ExportSqlTextResponse = {
  content: string
  row_count: number
  scope: ExportScope
}

export type CompareHistoryType = 'data' | 'structure'

export type CompareHistoryTablePair = {
  source_table: string
  target_table: string
}

export type CompareHistoryTableDetail = {
  data_tables: CompareHistoryTablePair[]
  added_tables: string[]
  modified_tables: string[]
  deleted_tables: string[]
}

export type CompareHistoryItem = {
  id: number
  history_type: CompareHistoryType
  source_profile_id: string | null
  source_data_source_name: string
  source_database: string
  target_profile_id: string | null
  target_data_source_name: string
  target_database: string
  table_mode: string
  selected_tables: string[]
  table_detail: CompareHistoryTableDetail
  performance: CompareHistoryPerformance
  source_table_count: number
  target_table_count: number
  total_tables: number
  compared_tables: number
  insert_count: number
  update_count: number
  delete_count: number
  structure_added_count: number
  structure_modified_count: number
  structure_deleted_count: number
  created_at: string
}

export type CompareHistoryInput = Omit<CompareHistoryItem, 'id' | 'created_at'>

export type TableEntry = {
  name: string
  table_rows: number | null
  column_count: number | null
}

export type LoadSqlAutocompletePayload = {
  profile_id: string
  database_name: string
}

export type SqlAutocompleteColumn = {
  name: string
  data_type: string
  nullable: boolean
  primary_key: boolean
  auto_increment: boolean
  comment: string
}

export type SqlAutocompleteTable = {
  name: string
  columns: SqlAutocompleteColumn[]
}

export type SqlAutocompleteSchema = {
  profile_id: string
  database_name: string
  tables: SqlAutocompleteTable[]
}

export type TableColumnSummary = {
  name: string
  data_type: string
}

export type TableColumn = {
  name: string
  data_type: string
  full_data_type: string
  length: number | null
  scale: number | null
  nullable: boolean
  primary_key: boolean
  auto_increment: boolean
  default_value: string | null
  comment: string
  ordinal_position: number
}

export type TableIdentity = {
  profile_id: string
  database_name: string
  table_name: string
}

export type TableDesign = TableIdentity & {
  columns: TableColumn[]
  ddl: string
}

export type TableDesignMutationPayload = TableIdentity & {
  columns: TableColumn[]
}

export type CreateTablePayload = TableIdentity & {
  columns: TableColumn[]
}

export type SqlPreview = {
  statements: string[]
}

export type TableDataColumn = {
  name: string
  data_type: string
  nullable: boolean
  primary_key: boolean
  auto_increment: boolean
  default_value: string | null
  comment: string
}

export type TableDataRow = {
  row_key: JsonRecord | null
  values: JsonRecord
}

export type TableDataPage = TableIdentity & {
  columns: TableDataColumn[]
  rows: TableDataRow[]
  primary_keys: string[]
  offset: number
  limit: number
  total_rows: number
  row_count_exact: boolean
  editable: boolean
}

export type ExecuteSqlPayload = {
  profile_id: string
  database_name?: string | null
  sql: string
  limit?: number | null
  offset?: number | null
}

export type SqlConsoleResult = {
  profile_id: string
  database_name: string | null
  executed_sql: string
  result_kind: string
  columns: TableDataColumn[]
  rows: TableDataRow[]
  affected_rows: number
  offset: number
  limit: number
  total_rows: number
  row_count_exact: boolean
  truncated: boolean
  message: string
}

export type LoadTableDataPayload = TableIdentity & {
  where_clause?: string | null
  order_by_clause?: string | null
  limit?: number | null
  offset?: number | null
}

export type ExportQueryResultFileRequest = {
  execute_payload: ExecuteSqlPayload
  file_path: string
  export_format: ExportFileFormat
  scope: ExportScope
  columns: TableDataColumn[]
  rows: TableDataRow[]
}

export type ExportQueryResultSqlTextRequest = {
  execute_payload: ExecuteSqlPayload
  scope: ExportScope
  columns: TableDataColumn[]
  rows: TableDataRow[]
}

export type ExportTableDataFileRequest = {
  load_payload: LoadTableDataPayload
  file_path: string
  export_format: ExportFileFormat
  scope: ExportScope
  columns: TableDataColumn[]
  rows: TableDataRow[]
}

export type ExportTableDataSqlTextRequest = {
  load_payload: LoadTableDataPayload
  scope: ExportScope
  columns: TableDataColumn[]
  rows: TableDataRow[]
}

export type InsertedRowPayload = {
  values: JsonRecord
}

export type UpdatedRowPayload = {
  row_key: JsonRecord
  values: JsonRecord
}

export type DeletedRowPayload = {
  row_key: JsonRecord
}

export type ApplyTableDataChangesPayload = TableIdentity & {
  transaction_mode: string
  inserted_rows: InsertedRowPayload[]
  updated_rows: UpdatedRowPayload[]
  deleted_rows: DeletedRowPayload[]
}

export type MutationResult = {
  affected_rows: number
  statements: string[]
}

export type TableDdl = {
  ddl: string
}

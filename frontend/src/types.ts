export type CellValue = string | number | boolean | null

export type JsonRecord = Record<string, CellValue>

export type AppBootstrap = {
  app_name: string
  storage_engine: string
  app_data_dir: string
  connection_profiles: ConnectionProfile[]
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

export type ConnectionTestResult = {
  server_version: string
  current_database: string | null
}

export type DatabaseEntry = {
  name: string
  table_count: number
}

export type CreateDatabasePayload = {
  profile_id: string
  database_name: string
}

export type TableEntry = {
  name: string
  table_rows: number | null
  column_count: number | null
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
  truncated: boolean
  message: string
}

export type LoadTableDataPayload = TableIdentity & {
  where_clause?: string | null
  order_by_clause?: string | null
  limit?: number | null
  offset?: number | null
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

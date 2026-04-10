import type { JsonRecord, TableDataColumn } from '../../types'

export type DataGridRow = {
  client_id: string
  selected: boolean
  state: 'clean' | 'new' | 'updated' | 'deleted'
  row_key: JsonRecord | null
  original_values: JsonRecord
  values: JsonRecord
}

type DataTabState = {
  loading: boolean
  error: string
  columns: TableDataColumn[]
  rows: DataGridRow[]
  primary_keys: string[]
  where_clause: string
  order_by_clause: string
  offset: number
  limit: number
  total_rows: number
  row_count_exact: boolean
  editable: boolean
  transaction_mode: 'auto' | 'manual'
}

type ConsoleTabState = {
  loading: boolean
  error: string
  sql: string
  message: string
  executed_sql: string
  result_kind: 'idle' | 'query' | 'mutation'
  columns: TableDataColumn[]
  rows: DataGridRow[]
  offset: number
  limit: number
  total_rows: number
  row_count_exact: boolean
  affected_rows: number
  truncated: boolean
  database_loading: boolean
}

export type DataTab = {
  id: string
  kind: 'data'
  title: string
  subtitle: string
  status: 'loading' | 'ready' | 'error'
  error: string
  profile_id: string
  database_name: string
  table_name: string
  data: DataTabState
}

export type ConsoleTab = {
  id: string
  kind: 'console'
  title: string
  subtitle: string
  status: 'loading' | 'ready' | 'error'
  error: string
  profile_id: string
  database_name: string | null
  table_name: string | null
  console: ConsoleTabState
}

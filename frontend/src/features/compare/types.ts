import type {
  CompareDetailPageResponse,
  CompareDetailType,
  CompareTableDiscoveryResponse,
  CompareTaskProgressResponse,
  DataCompareRequest,
  DataCompareResponse,
  StructureCompareDetailResponse,
  StructureCompareRequest,
  StructureCompareResponse,
  StructureDetailCategory,
} from '../../types'

export type CompareFormState = {
  source_profile_id: string
  source_database_name: string
  target_profile_id: string
  target_database_name: string
}

export type CompareWorkflowStep = 1 | 2 | 3

export type DataCompareSelectionItem = {
  table_enabled: boolean
  insert_enabled: boolean
  update_enabled: boolean
  delete_enabled: boolean
  excluded_insert_signatures: string[]
  excluded_update_signatures: string[]
  excluded_delete_signatures: string[]
}

export type DataCompareDetailState = {
  row_columns: string[]
  row_items: CompareDetailPageResponse['row_items']
  update_items: CompareDetailPageResponse['update_items']
  total: number
  fetched: number
  has_more: boolean
  loading: boolean
  loaded: boolean
  error: string
}

export type DataCompareState = {
  current_step: CompareWorkflowStep
  discovery: CompareTableDiscoveryResponse | null
  selected_tables: string[]
  loading_tables: boolean
  running: boolean
  task_progress: CompareTaskProgressResponse | null
  result: DataCompareResponse | null
  current_request: DataCompareRequest | null
  table_filter: string
  selection_by_table: Record<string, DataCompareSelectionItem>
  active_table_key: string
  active_detail_type: CompareDetailType
  detail_pages: Record<string, Record<CompareDetailType, DataCompareDetailState>>
}

export type StructureCompareDetailCacheItem = {
  loading: boolean
  error: string
  detail: StructureCompareDetailResponse | null
}

export type StructureCompareState = {
  current_step: CompareWorkflowStep
  loading: boolean
  result: StructureCompareResponse | null
  current_request: StructureCompareRequest | null
  selection_by_category: Record<StructureDetailCategory, string[]>
  active_category: StructureDetailCategory
  expanded_detail_keys: string[]
  detail_cache: Record<string, StructureCompareDetailCacheItem>
}

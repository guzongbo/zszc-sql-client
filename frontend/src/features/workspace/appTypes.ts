import type {
  CompareFormState,
  DataCompareState,
  StructureCompareState,
} from '../compare/types'
import type { ConsoleTab, DataTab } from './types'
import type {
  CellValue,
  CreateDatabasePayload,
  ExecuteSqlPayload,
  ExportFileFormat,
  ExportScope,
  LoadTableDataPayload,
  SaveConnectionProfilePayload,
  TableColumn,
  TableDataColumn,
  TableDataRow,
} from '../../types'

export type ToastTone = 'success' | 'error' | 'info'

export type ToastItem = {
  id: string
  tone: ToastTone
  message: string
}

export type SelectionState =
  | { kind: 'none' }
  | { kind: 'profile'; profile_id: string }
  | { kind: 'database'; profile_id: string; database_name: string }
  | { kind: 'table'; profile_id: string; database_name: string; table_name: string }

export type DesignDraftColumn = TableColumn & {
  client_id: string
  selected: boolean
  origin_name: string | null
}

export type ProfileEditorState = {
  mode: 'create' | 'edit'
  saving: boolean
  testing: boolean
  test_result: string
  form: SaveConnectionProfilePayload
  group_manager_open: boolean
  group_busy: boolean
  create_group_name: string
  editing_group_id: string | null
  editing_group_name: string
}

export type DesignTabState = {
  mode: 'edit' | 'create'
  loading: boolean
  error: string
  ddl: string
  draft_table_name: string
  original_columns: TableColumn[]
  draft_columns: DesignDraftColumn[]
}

export type ProfileTab = {
  id: string
  kind: 'profile'
  title: string
  subtitle: string
  status: 'ready' | 'busy'
  error: string
  editor: ProfileEditorState
}

export type DesignTab = {
  id: string
  kind: 'design'
  title: string
  subtitle: string
  status: 'loading' | 'ready' | 'error'
  error: string
  profile_id: string
  database_name: string
  table_name: string
  design: DesignTabState
}

export type GroupAssignmentTabState = {
  target_group_id: string
  filter_text: string
  selected_profile_ids: string[]
  submitting: boolean
}

export type GroupAssignmentTab = {
  id: string
  kind: 'group_assignment'
  title: string
  subtitle: string
  status: 'ready' | 'busy'
  error: string
  assignment: GroupAssignmentTabState
}

export type WorkspaceTab =
  | ProfileTab
  | DesignTab
  | DataTab
  | ConsoleTab
  | GroupAssignmentTab

export type SqlPreviewState = {
  title: string
  statements: string[]
  confirm_label?: string
  busy: boolean
  on_confirm?: () => Promise<void>
}

export type TreeContextMenuState =
  | {
      kind: 'group'
      x: number
      y: number
      group_id: string
      group_name: string
    }
  | { kind: 'profile'; x: number; y: number; profile_id: string }
  | {
      kind: 'database'
      x: number
      y: number
      profile_id: string
      database_name: string
    }
  | {
      kind: 'table'
      x: number
      y: number
      profile_id: string
      database_name: string
      table_name: string
    }

export type CreateDatabaseDialogState = {
  profile_id: string
  data_source_name: string
  form: CreateDatabasePayload
  busy: boolean
}

export type ConfirmDialogState = {
  title: string
  body: string
  confirm_label: string
  busy: boolean
  on_confirm: () => Promise<void>
}

export type ExportDialogState =
  | {
      kind: 'table_data'
      title: string
      subtitle: string
      busy: boolean
      format: ExportFileFormat
      scope: ExportScope
      columns: TableDataColumn[]
      rows: TableDataRow[]
      selected_rows: TableDataRow[]
      load_payload: LoadTableDataPayload
    }
  | {
      kind: 'query_result'
      title: string
      subtitle: string
      busy: boolean
      format: ExportFileFormat
      scope: ExportScope
      columns: TableDataColumn[]
      rows: TableDataRow[]
      selected_rows: TableDataRow[]
      execute_payload: ExecuteSqlPayload
    }

export type OutputLogEntry = {
  id: string
  tone: ToastTone
  timestamp: string
  scope: string
  message: string
  sql?: string
}

export type RailSection =
  | 'datasource'
  | 'structure_compare'
  | 'data_compare'
  | 'compare_history'

export type WorkspacePanelKey = 'left' | 'right' | 'bottom'

export const databaseWorkspaceId = 'workspace:database'
export const redisWorkspaceId = 'workspace:redis'

export const defaultConnectionForm: SaveConnectionProfilePayload = {
  group_name: null,
  data_source_name: '',
  host: '',
  port: 3306,
  username: '',
  password: '',
}

export const defaultCompareForm: CompareFormState = {
  source_profile_id: '',
  source_database_name: '',
  target_profile_id: '',
  target_database_name: '',
}

export const defaultDataCompareState: DataCompareState = {
  current_step: 1,
  discovery: null,
  selected_tables: [],
  loading_tables: false,
  running: false,
  task_progress: null,
  result: null,
  current_request: null,
  table_filter: '',
  selection_by_table: {},
  active_table_key: '',
  active_detail_type: 'insert',
  detail_pages: {},
}

export const defaultStructureCompareState: StructureCompareState = {
  current_step: 1,
  loading: false,
  task_progress: null,
  result: null,
  current_request: null,
  selection_by_category: {
    added: [],
    modified: [],
    deleted: [],
  },
  active_category: 'added',
  expanded_detail_keys: [],
  detail_cache: {},
}

export function createProfileEditorState(
  mode: 'create' | 'edit',
  form: SaveConnectionProfilePayload,
): ProfileEditorState {
  return {
    mode,
    saving: false,
    testing: false,
    test_result: '',
    form,
    group_manager_open: false,
    group_busy: false,
    create_group_name: '',
    editing_group_id: null,
    editing_group_name: '',
  }
}

export function createGroupAssignmentState(groupId: string): GroupAssignmentTabState {
  return {
    target_group_id: groupId,
    filter_text: '',
    selected_profile_ids: [],
    submitting: false,
  }
}

export type DefaultCellValue = CellValue

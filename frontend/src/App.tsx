import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
  type UIEventHandler,
} from 'react'
import './App.css'
import {
  addCompareHistory,
  applyTableDataChanges,
  applyTableDesignChanges,
  cancelDataCompareTask,
  chooseSqlExportPath,
  compareDiscoverTables,
  createDataSourceGroup,
  createDatabase,
  createTable,
  deleteDataSourceGroup,
  deleteConnectionProfile,
  disconnectConnectionProfile,
  executeSql,
  exportDataCompareSqlFile,
  exportStructureCompareSqlFile,
  getDataCompareTaskProgress,
  getDataCompareTaskResult,
  getAppBootstrap,
  getTableDdl,
  importNavicatConnectionProfiles,
  listDatabaseTables,
  listCompareHistory,
  listProfileDatabases,
  loadDataCompareDetailPage,
  loadSqlAutocomplete,
  loadStructureCompareDetail,
  loadTableData,
  loadTableDesign,
  previewCreateTableSql,
  previewTableDataChanges,
  previewTableDesignSql,
  renameDataSourceGroup,
  runStructureCompare,
  saveConnectionProfile,
  startDataCompareTask,
  testConnectionProfile,
} from './api'
import { SqlDiffViewer, SqlEditor } from './SqlEditor'
import type {
  AppBootstrap,
  ApplyTableDataChangesPayload,
  CellValue,
  CompareDetailPageResponse,
  CompareDetailType,
  CompareHistoryInput,
  CompareHistoryItem,
  CompareHistoryPerformance,
  CompareHistoryType,
  CompareTableDiscoveryResponse,
  CompareTaskPhase,
  CompareTaskProgressResponse,
  ConnectionProfile,
  DataSourceGroup,
  DataCompareRequest,
  DataCompareResponse,
  CreateDatabasePayload,
  DatabaseEntry,
  JsonRecord,
  SaveConnectionProfilePayload,
  SqlAutocompleteSchema,
  StructureCompareDetailResponse,
  StructureCompareRequest,
  StructureCompareResponse,
  StructureSqlSelection,
  TableSqlSelection,
  StructureDetailCategory,
  StructureTableItem,
  TableColumn,
  TableCompareResult,
  TableDataColumn,
  TableDataRow,
  TableEntry,
} from './types'

type ToastTone = 'success' | 'error' | 'info'

type ToastItem = {
  id: string
  tone: ToastTone
  message: string
}

type SelectionState =
  | { kind: 'none' }
  | { kind: 'profile'; profile_id: string }
  | { kind: 'database'; profile_id: string; database_name: string }
  | { kind: 'table'; profile_id: string; database_name: string; table_name: string }

type DesignDraftColumn = TableColumn & {
  client_id: string
  selected: boolean
  origin_name: string | null
}

type DataGridRow = {
  client_id: string
  selected: boolean
  state: 'clean' | 'new' | 'updated' | 'deleted'
  row_key: JsonRecord | null
  original_values: JsonRecord
  values: JsonRecord
}

type ProfileEditorState = {
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

type DesignTabState = {
  mode: 'edit' | 'create'
  loading: boolean
  error: string
  ddl: string
  draft_table_name: string
  original_columns: TableColumn[]
  draft_columns: DesignDraftColumn[]
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

type ProfileTab = {
  id: string
  kind: 'profile'
  title: string
  subtitle: string
  status: 'ready' | 'busy'
  error: string
  editor: ProfileEditorState
}

type DesignTab = {
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

type DataTab = {
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

type ConsoleTab = {
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

type WorkspaceTab = ProfileTab | DesignTab | DataTab | ConsoleTab

type SqlPreviewState = {
  title: string
  statements: string[]
  confirm_label?: string
  busy: boolean
  on_confirm?: () => Promise<void>
}

type TreeContextMenuState =
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

type CreateDatabaseDialogState = {
  profile_id: string
  data_source_name: string
  form: CreateDatabasePayload
  busy: boolean
}

type ConfirmDialogState = {
  title: string
  body: string
  confirm_label: string
  busy: boolean
  on_confirm: () => Promise<void>
}

type OutputLogEntry = {
  id: string
  tone: ToastTone
  timestamp: string
  scope: string
  message: string
  sql?: string
}

type GroupedProfiles = [string, ConnectionProfile[]][]

const ungroupedGroupName = '未分组'
const commonDataTypes = [
  'bigint',
  'int',
  'tinyint',
  'varchar',
  'text',
  'decimal',
  'datetime',
  'timestamp',
  'date',
]

const defaultConnectionForm: SaveConnectionProfilePayload = {
  group_name: null,
  data_source_name: '',
  host: '',
  port: 3306,
  username: '',
  password: '',
}

function createProfileEditorState(
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

type RailSection = 'datasource' | 'structure_compare' | 'data_compare' | 'compare_history'

type CompareFormState = {
  source_profile_id: string
  source_database_name: string
  target_profile_id: string
  target_database_name: string
}

type CompareWorkflowStep = 1 | 2 | 3

type DataCompareSelectionItem = {
  table_enabled: boolean
  insert_enabled: boolean
  update_enabled: boolean
  delete_enabled: boolean
  excluded_insert_signatures: string[]
  excluded_update_signatures: string[]
  excluded_delete_signatures: string[]
}

type DataCompareDetailState = {
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

type DataCompareState = {
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

type StructureCompareDetailCacheItem = {
  loading: boolean
  error: string
  detail: StructureCompareDetailResponse | null
}

type StructureCompareState = {
  current_step: CompareWorkflowStep
  loading: boolean
  result: StructureCompareResponse | null
  current_request: StructureCompareRequest | null
  selection_by_category: Record<StructureDetailCategory, string[]>
  active_category: StructureDetailCategory
  expanded_detail_keys: string[]
  detail_cache: Record<string, StructureCompareDetailCacheItem>
}

const defaultCompareForm: CompareFormState = {
  source_profile_id: '',
  source_database_name: '',
  target_profile_id: '',
  target_database_name: '',
}

const dataCompareDetailCacheLimit = 300

const defaultDataCompareState: DataCompareState = {
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

const defaultStructureCompareState: StructureCompareState = {
  current_step: 1,
  loading: false,
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

function App() {
  const [, setBootstrap] = useState<AppBootstrap | null>(null)
  const [bootstrapError, setBootstrapError] = useState('')
  const [activeSection, setActiveSection] = useState<RailSection>('datasource')
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [dataSourceGroups, setDataSourceGroups] = useState<DataSourceGroup[]>([])
  const [compareForm, setCompareForm] = useState<CompareFormState>(defaultCompareForm)
  const [dataCompareState, setDataCompareState] = useState<DataCompareState>(
    defaultDataCompareState,
  )
  const [structureCompareState, setStructureCompareState] = useState<StructureCompareState>(
    defaultStructureCompareState,
  )
  const [structureDetailConcurrencyInput, setStructureDetailConcurrencyInput] = useState('')
  const [compareHistoryItems, setCompareHistoryItems] = useState<CompareHistoryItem[]>([])
  const [compareHistoryType, setCompareHistoryType] =
    useState<CompareHistoryType>('data')
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null)
  const [selection, setSelection] = useState<SelectionState>({ kind: 'none' })
  const [selectedGroupKey, setSelectedGroupKey] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [databasesByProfile, setDatabasesByProfile] = useState<Record<string, DatabaseEntry[]>>(
    {},
  )
  const [tablesByDatabase, setTablesByDatabase] = useState<Record<string, TableEntry[]>>({})
  const [sqlAutocompleteByDatabase, setSqlAutocompleteByDatabase] = useState<
    Record<string, SqlAutocompleteSchema>
  >({})
  const [nodeLoading, setNodeLoading] = useState<Record<string, boolean>>({})
  const [profileConnectionState, setProfileConnectionState] = useState<
    Record<string, 'idle' | 'connected' | 'error'>
  >({})
  const [tabs, setTabs] = useState<WorkspaceTab[]>([])
  const [activeTabId, setActiveTabId] = useState('')
  const [ddlDialog, setDdlDialog] = useState<{ title: string; ddl: string } | null>(
    null,
  )
  const [sqlPreview, setSqlPreview] = useState<SqlPreviewState | null>(null)
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(
    null,
  )
  const [createDatabaseDialog, setCreateDatabaseDialog] =
    useState<CreateDatabaseDialogState | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [outputVisible, setOutputVisible] = useState(false)
  const [outputLogs, setOutputLogs] = useState<OutputLogEntry[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const outputBodyRef = useRef<HTMLDivElement | null>(null)
  const sqlAutocompleteRequestsRef = useRef<
    Partial<Record<string, Promise<SqlAutocompleteSchema | null>>>
  >({})

  useEffect(() => {
    let cancelled = false

    async function bootstrapApp() {
      try {
        const [payload, history] = await Promise.all([
          getAppBootstrap(),
          listCompareHistory(100),
        ])
        if (cancelled) {
          return
        }

        const nextProfiles = sortProfiles(payload.connection_profiles)
        setBootstrap(payload)
        setProfiles(nextProfiles)
        setDataSourceGroups(sortDataSourceGroups(payload.data_source_groups))
        setExpandedKeys(new Set())
        setCompareHistoryItems(history)
      } catch (error) {
        if (cancelled) {
          return
        }
        setBootstrapError(
          error instanceof Error ? error.message : '桌面端初始化失败',
        )
      }
    }

    void bootstrapApp()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setTabs((previous) =>
      previous.map((tab) =>
        tab.kind === 'console'
          ? {
              ...tab,
              console: {
                ...tab.console,
                database_loading: !databasesByProfile[tab.profile_id],
              },
            }
          : tab,
      ),
    )
  }, [databasesByProfile])

  useEffect(() => {
    if (toasts.length === 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setToasts((previous) => previous.slice(1))
    }, 2800)

    return () => {
      window.clearTimeout(timer)
    }
  }, [toasts])

  useEffect(() => {
    const activeItems = compareHistoryItems.filter(
      (item) => item.history_type === compareHistoryType,
    )
    if (activeItems.length === 0) {
      setSelectedHistoryId(null)
      return
    }
    if (!activeItems.some((item) => item.id === selectedHistoryId)) {
      setSelectedHistoryId(activeItems[0].id)
    }
  }, [compareHistoryItems, compareHistoryType, selectedHistoryId])

  useEffect(() => {
    if (!outputVisible || !outputBodyRef.current) {
      return
    }

    outputBodyRef.current.scrollTop = outputBodyRef.current.scrollHeight
  }, [outputLogs, outputVisible])

  function pushToast(message: string, tone: ToastTone) {
    setToasts((previous) => [
      ...previous,
      { id: `${Date.now()}-${previous.length}`, tone, message },
    ])
  }

  function appendOutputLog(
    scope: string,
    message: string,
    tone: ToastTone = 'info',
    sql?: string,
  ) {
    setOutputLogs((previous) => {
      const next = [
        ...previous,
        {
          id: createClientId(),
          tone,
          timestamp: formatOutputTimestamp(new Date()),
          scope,
          message,
          sql: sql?.trim() || undefined,
        },
      ]

      return next.slice(-200)
    })
  }

  function patchTab(tabId: string, updater: (tab: WorkspaceTab) => WorkspaceTab) {
    setTabs((previous) =>
      previous.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
    )
  }

  function selectTable(profileId: string, databaseName: string, tableName: string) {
    setSelectedGroupKey('')
    setSelection({
      kind: 'table',
      profile_id: profileId,
      database_name: databaseName,
      table_name: tableName,
    })
    setTreeContextMenu(null)
  }

  function selectProfile(profileId: string) {
    setSelectedGroupKey('')
    setSelection({ kind: 'profile', profile_id: profileId })
    setTreeContextMenu(null)
  }

  function selectDatabase(profileId: string, databaseName: string) {
    setSelectedGroupKey('')
    setSelection({
      kind: 'database',
      profile_id: profileId,
      database_name: databaseName,
    })
    setTreeContextMenu(null)
  }

  function removeTab(tabId: string) {
    setTabs((previous) => previous.filter((tab) => tab.id !== tabId))
    setActiveTabId((previous) => {
      if (previous !== tabId) {
        return previous
      }
      const remaining = tabs.filter((tab) => tab.id !== tabId)
      return remaining.at(-1)?.id ?? ''
    })
  }

  function replaceTab(tabId: string, nextTab: WorkspaceTab) {
    setTabs((previous) =>
      previous
        .filter((tab) => tab.id !== nextTab.id || tab.id === tabId)
        .map((tab) => (tab.id === tabId ? nextTab : tab)),
    )
    setActiveTabId(nextTab.id)
  }

  function upsertTab(nextTab: WorkspaceTab) {
    setTabs((previous) => {
      const exists = previous.some((tab) => tab.id === nextTab.id)
      return exists
        ? previous.map((tab) => (tab.id === nextTab.id ? nextTab : tab))
        : [...previous, nextTab]
    })
    setActiveTabId(nextTab.id)
  }

  async function ensureDatabasesLoaded(
    profileId: string,
    options?: { silent?: boolean; force?: boolean },
  ) {
    if (!options?.force && databasesByProfile[profileId]) {
      return databasesByProfile[profileId]
    }

    setNodeLoading((previous) => ({ ...previous, [profileId]: true }))
    try {
      const databases = await listProfileDatabases(profileId)
      setDatabasesByProfile((previous) => ({ ...previous, [profileId]: databases }))
      setProfileConnectionState((previous) => ({
        ...previous,
        [profileId]: 'connected',
      }))
      return databases
    } catch (error) {
      setProfileConnectionState((previous) => ({
        ...previous,
        [profileId]: 'error',
      }))
      if (!options?.silent) {
        pushToast(error instanceof Error ? error.message : '读取数据库失败', 'error')
      }
      return []
    } finally {
      setNodeLoading((previous) => ({ ...previous, [profileId]: false }))
    }
  }

  async function refreshCompareHistoryState() {
    try {
      const history = await listCompareHistory(100)
      setCompareHistoryItems(history)
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '读取对比记录失败', 'error')
    }
  }

  async function importNavicatProfiles() {
    try {
      const result = await importNavicatConnectionProfiles()
      if (result.canceled) {
        return
      }

      const payload = await getAppBootstrap()
      const nextProfiles = sortProfiles(payload.connection_profiles)
      setBootstrap(payload)
      setProfiles(nextProfiles)
      setDataSourceGroups(sortDataSourceGroups(payload.data_source_groups))
      setExpandedKeys(new Set())

      pushToast(
        `Navicat 导入完成：新增 ${result.created_count}，更新 ${result.updated_count}，跳过 ${result.skipped_count}`,
        'success',
      )
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '导入 Navicat 失败', 'error')
    }
  }

  async function updateCompareProfile(
    side: 'source' | 'target',
    profileId: string,
  ) {
    setCompareForm((previous) =>
      side === 'source'
        ? {
            ...previous,
            source_profile_id: profileId,
            source_database_name: '',
          }
        : {
            ...previous,
            target_profile_id: profileId,
            target_database_name: '',
          },
    )
    setDataCompareState(defaultDataCompareState)
    setStructureCompareState(defaultStructureCompareState)
    if (profileId) {
      await ensureDatabasesLoaded(profileId, { silent: true })
    }
  }

  function updateCompareDatabase(
    side: 'source' | 'target',
    databaseName: string,
  ) {
    setCompareForm((previous) =>
      side === 'source'
        ? { ...previous, source_database_name: databaseName }
        : { ...previous, target_database_name: databaseName },
    )
    setDataCompareState(defaultDataCompareState)
    setStructureCompareState(defaultStructureCompareState)
  }

  function setDataCompareStep(step: CompareWorkflowStep) {
    setDataCompareState((previous) => ({ ...previous, current_step: step }))
  }

  function setStructureCompareStep(step: CompareWorkflowStep) {
    setStructureCompareState((previous) => ({ ...previous, current_step: step }))
  }

  function updateDataCompareTableFilter(value: string) {
    setDataCompareState((previous) => ({ ...previous, table_filter: value }))
  }

  function toggleDataCompareTable(tableName: string, checked: boolean) {
    setDataCompareState((previous) => {
      const selected = new Set(previous.selected_tables)
      if (checked) {
        selected.add(tableName)
      } else {
        selected.delete(tableName)
      }
      return {
        ...previous,
        selected_tables: Array.from(selected),
        result: null,
        current_request: null,
        selection_by_table: {},
        active_table_key: '',
        active_detail_type: 'insert',
        detail_pages: {},
      }
    })
  }

  function selectAllDataCompareTables() {
    setDataCompareState((previous) => ({
      ...previous,
      selected_tables: previous.discovery?.common_tables ?? [],
      result: null,
      current_request: null,
      selection_by_table: {},
      active_table_key: '',
      active_detail_type: 'insert',
      detail_pages: {},
    }))
  }

  function clearAllDataCompareTables() {
    setDataCompareState((previous) => ({
      ...previous,
      selected_tables: [],
      result: null,
      current_request: null,
      selection_by_table: {},
      active_table_key: '',
      active_detail_type: 'insert',
      detail_pages: {},
    }))
  }

  function buildDataCompareRequestFromForm(): DataCompareRequest {
    const { source_profile_id, source_database_name, target_profile_id, target_database_name } =
      compareForm
    if (!source_profile_id || !source_database_name) {
      throw new Error('请先选择源端数据源和数据库')
    }
    if (!target_profile_id || !target_database_name) {
      throw new Error('请先选择目标端数据源和数据库')
    }

    const selectedTables = dataCompareState.selected_tables
    const commonTables = dataCompareState.discovery?.common_tables ?? []

    return {
      source_profile_id,
      source_database_name,
      target_profile_id,
      target_database_name,
      table_mode:
        selectedTables.length === commonTables.length ? 'all' : 'selected',
      selected_tables:
        selectedTables.length === commonTables.length ? [] : selectedTables,
      preview_limit: 20,
    }
  }

  function buildStructureCompareRequestFromForm(): StructureCompareRequest {
    const { source_profile_id, source_database_name, target_profile_id, target_database_name } =
      compareForm
    const detailConcurrency = parsePositiveIntegerOrNull(structureDetailConcurrencyInput)
    if (!source_profile_id || !source_database_name) {
      throw new Error('请先选择源端数据源和数据库')
    }
    if (!target_profile_id || !target_database_name) {
      throw new Error('请先选择目标端数据源和数据库')
    }

    return {
      source_profile_id,
      source_database_name,
      target_profile_id,
      target_database_name,
      preload_details: false,
      ...(detailConcurrency ? { detail_concurrency: detailConcurrency } : {}),
    }
  }

  async function discoverCompareTables() {
    try {
      const { source_profile_id, source_database_name, target_profile_id, target_database_name } =
        compareForm
      if (!source_profile_id || !source_database_name) {
        throw new Error('请先选择源端数据源和数据库')
      }
      if (!target_profile_id || !target_database_name) {
        throw new Error('请先选择目标端数据源和数据库')
      }

      setDataCompareState((previous) => ({
        ...previous,
        loading_tables: true,
      }))

      const discovery = await compareDiscoverTables({
        source_profile_id,
        source_database_name,
        target_profile_id,
        target_database_name,
      })

      setDataCompareState((previous) => ({
        ...previous,
        discovery,
        current_step: 2,
        selected_tables: discovery.common_tables,
        loading_tables: false,
        result: null,
        current_request: null,
        selection_by_table: {},
        active_table_key: '',
        active_detail_type: 'insert',
        detail_pages: {},
      }))

      if (discovery.common_tables.length === 0) {
        pushToast('源库与目标库之间没有同名表可比较', 'info')
      }
    } catch (error) {
      setDataCompareState((previous) => ({ ...previous, loading_tables: false }))
      pushToast(error instanceof Error ? error.message : '加载对比表失败', 'error')
    }
  }

  async function runDataCompareFlow() {
    try {
      const request = buildDataCompareRequestFromForm()
      if (request.table_mode === 'selected' && request.selected_tables.length === 0) {
        throw new Error('请至少勾选一张待比较数据表')
      }

      setDataCompareState((previous) => ({
        ...previous,
        running: true,
        task_progress: null,
        result: null,
        selection_by_table: {},
        active_table_key: '',
        active_detail_type: 'insert',
        detail_pages: {},
      }))

      const task = await startDataCompareTask(request)
      const response = await waitForDataCompareTask(task.compare_id)
      if (!response.result) {
        throw new Error(response.error_message ?? '数据对比未返回结果')
      }
      const compareResult = response.result
      const firstTableKey = compareResult.table_results[0]
        ? buildDataCompareResultTableKey(compareResult.table_results[0])
        : ''

      setDataCompareState((previous) => ({
        ...previous,
        current_step: 3,
        running: false,
        task_progress: null,
        result: compareResult,
        current_request: request,
        selection_by_table: createDataCompareSelectionState(compareResult),
        active_table_key: firstTableKey,
        active_detail_type: 'insert',
        detail_pages: {},
      }))

      await addCompareHistory(
        buildDataCompareHistoryInput(
          compareResult,
          request,
          profiles.find((profile) => profile.id === request.source_profile_id)?.data_source_name ?? '',
          profiles.find((profile) => profile.id === request.target_profile_id)?.data_source_name ?? '',
        ),
      )
      await refreshCompareHistoryState()
      pushToast('数据对比完成', 'success')
      if (firstTableKey) {
        await ensureDataCompareDetailLoaded(
          firstTableKey,
          'insert',
          request,
          true,
          compareResult,
        )
      }
    } catch (error) {
      setDataCompareState((previous) => ({
        ...previous,
        running: false,
        task_progress: null,
      }))
      pushToast(error instanceof Error ? error.message : '数据对比失败', 'error')
    }
  }

  async function exportSelectedDataCompareSql() {
    try {
      if (!dataCompareState.result || !dataCompareState.current_request) {
        throw new Error('当前没有可导出的数据对比结果')
      }

      const tableSelections = buildDataCompareTableSelections(
        dataCompareState.result,
        dataCompareState.selection_by_table,
      )
      const selectedStatementCount = tableSelections.reduce((total, item) => {
        if (!item.table_enabled) {
          return total
        }
        return (
          total +
          Number(item.insert_enabled) +
          Number(item.update_enabled) +
          Number(item.delete_enabled)
        )
      }, 0)

      if (selectedStatementCount === 0) {
        throw new Error('当前没有已选中的差异 SQL 可导出')
      }

      const saveTarget = await chooseSqlExportPath({
        default_file_name: buildDataCompareSqlFileName(compareForm),
      })
      if (saveTarget.canceled || !saveTarget.file_path) {
        return
      }

      const result = await exportDataCompareSqlFile({
        compare_id: dataCompareState.result.compare_id,
        compare_request: dataCompareState.current_request,
        table_selections: tableSelections,
        file_path: saveTarget.file_path,
      })

      pushToast('数据对比 SQL 已导出', 'success')
      appendOutputLog(
        '数据对比导出',
        `已导出到 ${result.file_path}，INSERT ${result.insert_count}，UPDATE ${result.update_count}，DELETE ${result.delete_count}`,
        'success',
      )
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '导出 SQL 失败', 'error')
    }
  }

  async function waitForDataCompareTask(compareId: string) {
    for (;;) {
      const progress = await getDataCompareTaskProgress(compareId)
      setDataCompareState((previous) => ({
        ...previous,
        task_progress: progress,
      }))

      if (
        progress.status === 'completed' ||
        progress.status === 'failed' ||
        progress.status === 'canceled'
      ) {
        return getDataCompareTaskResult(compareId)
      }

      await new Promise((resolve) => window.setTimeout(resolve, 240))
    }
  }

  async function cancelRunningDataCompare() {
    const compareId = dataCompareState.task_progress?.compare_id
    if (!compareId) {
      return
    }
    try {
      await cancelDataCompareTask(compareId)
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '取消数据对比失败', 'error')
    }
  }

  function updateDataCompareSelection(
    tableKey: string,
    updater: (current: DataCompareSelectionItem) => DataCompareSelectionItem,
  ) {
    setDataCompareState((previous) => ({
      ...previous,
      selection_by_table: {
        ...previous.selection_by_table,
        [tableKey]: updater(
          previous.selection_by_table[tableKey] ?? createEmptyDataCompareSelectionItem(),
        ),
      },
    }))
  }

  function toggleDataCompareResultTableSelection(tableKey: string, checked: boolean) {
    updateDataCompareSelection(tableKey, (current) => ({
      ...current,
      table_enabled: checked,
      insert_enabled: checked,
      update_enabled: checked,
      delete_enabled: checked,
      excluded_insert_signatures: checked ? [] : current.excluded_insert_signatures,
      excluded_update_signatures: checked ? [] : current.excluded_update_signatures,
      excluded_delete_signatures: checked ? [] : current.excluded_delete_signatures,
    }))
  }

  function toggleDataCompareResultActionSelection(
    tableKey: string,
    detailType: CompareDetailType,
    checked: boolean,
  ) {
    updateDataCompareSelection(tableKey, (current) => {
      const next: DataCompareSelectionItem = {
        ...current,
        table_enabled: checked ? true : current.table_enabled,
      }

      if (detailType === 'insert') {
        next.insert_enabled = checked
        next.excluded_insert_signatures = checked ? [] : current.excluded_insert_signatures
      } else if (detailType === 'update') {
        next.update_enabled = checked
        next.excluded_update_signatures = checked ? [] : current.excluded_update_signatures
      } else {
        next.delete_enabled = checked
        next.excluded_delete_signatures = checked ? [] : current.excluded_delete_signatures
      }

      if (!next.insert_enabled && !next.update_enabled && !next.delete_enabled) {
        next.table_enabled = false
      }

      return next
    })
  }

  function toggleDataCompareDetailSelection(
    tableKey: string,
    detailType: CompareDetailType,
    signature: string,
    checked: boolean,
  ) {
    if (!signature) {
      return
    }

    updateDataCompareSelection(tableKey, (current) => {
      const next = { ...current }
      if (detailType === 'insert') {
        next.excluded_insert_signatures = toggleExcludedSignature(
          current.excluded_insert_signatures,
          signature,
          checked,
        )
      } else if (detailType === 'update') {
        next.excluded_update_signatures = toggleExcludedSignature(
          current.excluded_update_signatures,
          signature,
          checked,
        )
      } else {
        next.excluded_delete_signatures = toggleExcludedSignature(
          current.excluded_delete_signatures,
          signature,
          checked,
        )
      }
      return next
    })
  }

  function selectDataCompareResultTable(tableKey: string) {
    const detailType = dataCompareState.active_detail_type
    setDataCompareState((previous) => ({
      ...previous,
      active_table_key: tableKey,
    }))
    void ensureDataCompareDetailLoaded(
      tableKey,
      detailType,
      dataCompareState.current_request,
      false,
    )
  }

  function switchDataCompareDetailType(detailType: CompareDetailType) {
    const tableKey = dataCompareState.active_table_key
    setDataCompareState((previous) => ({
      ...previous,
      active_detail_type: detailType,
    }))
    if (tableKey) {
      void ensureDataCompareDetailLoaded(
        tableKey,
        detailType,
        dataCompareState.current_request,
        false,
      )
    }
  }

  async function ensureDataCompareDetailLoaded(
    tableKey: string,
    detailType: CompareDetailType,
    request = dataCompareState.current_request,
    reset = false,
    result = dataCompareState.result,
  ) {
    if (!request) {
      return
    }

    const targetTable = result?.table_results.find(
      (item) => buildDataCompareResultTableKey(item) === tableKey,
    )
    if (!targetTable) {
      return
    }

    const currentDetailState =
      dataCompareState.detail_pages[tableKey]?.[detailType] ?? createEmptyDataCompareDetailState()
    const actionTotal = getDataCompareActionTotalCount(targetTable, detailType)
    if (
      !reset &&
      (currentDetailState.loading ||
        (!currentDetailState.has_more && currentDetailState.loaded) ||
        actionTotal === 0)
    ) {
      return
    }

    setDataCompareState((previous) => {
      const tableDetailPages = {
        insert:
          previous.detail_pages[tableKey]?.insert ?? createEmptyDataCompareDetailState(),
        update:
          previous.detail_pages[tableKey]?.update ?? createEmptyDataCompareDetailState(),
        delete:
          previous.detail_pages[tableKey]?.delete ?? createEmptyDataCompareDetailState(),
      }
      const nextDetailState = reset
        ? {
            ...createEmptyDataCompareDetailState(),
            total: actionTotal,
            has_more: actionTotal > 0,
          }
        : {
            ...tableDetailPages[detailType],
            total: actionTotal,
          }

      return {
        ...previous,
        active_table_key: tableKey,
        active_detail_type: detailType,
        detail_pages: {
          ...previous.detail_pages,
          [tableKey]: {
            ...tableDetailPages,
            [detailType]: {
              ...nextDetailState,
              loading: actionTotal > 0,
              loaded: actionTotal === 0 ? true : nextDetailState.loaded,
              error: '',
            },
          },
        },
      }
    })

    if (actionTotal === 0) {
      return
    }

    try {
      const detailPage = await loadDataCompareDetailPage({
        compare_id: result?.compare_id ?? undefined,
        compare_request: request,
        source_table: targetTable.source_table,
        target_table: targetTable.target_table,
        detail_type: detailType,
        expected_total: actionTotal,
        offset: reset ? 0 : currentDetailState.fetched,
        limit: 50,
      })
      setDataCompareState((previous) => ({
        ...previous,
        detail_pages: buildPrunedDataCompareDetailPages(
          previous.detail_pages,
          tableKey,
          detailType,
          detailPage,
          reset,
        ),
      }))
    } catch (error) {
      setDataCompareState((previous) => ({
        ...previous,
        detail_pages: {
          ...previous.detail_pages,
          [tableKey]: {
            insert:
              previous.detail_pages[tableKey]?.insert ?? createEmptyDataCompareDetailState(),
            update:
              previous.detail_pages[tableKey]?.update ?? createEmptyDataCompareDetailState(),
            delete:
              previous.detail_pages[tableKey]?.delete ?? createEmptyDataCompareDetailState(),
            [detailType]: {
              ...(previous.detail_pages[tableKey]?.[detailType] ??
                createEmptyDataCompareDetailState()),
              loading: false,
              error: error instanceof Error ? error.message : '读取对比详情失败',
            },
          },
        }
      }))
    }
  }

  async function runStructureCompareFlow() {
    try {
      const request = buildStructureCompareRequestFromForm()
      setStructureCompareState((previous) => ({
        ...previous,
        loading: true,
      }))

      const result = await runStructureCompare(request)
      const activeCategory = pickFirstStructureCategory(result)

      setStructureCompareState({
        current_step: 2,
        loading: false,
        result,
        current_request: request,
        selection_by_category: createStructureSelectionState(result),
        active_category: activeCategory,
        expanded_detail_keys: [],
        detail_cache: {},
      })

      await addCompareHistory(
        buildStructureCompareHistoryInput(
          result,
          request,
          profiles.find((profile) => profile.id === request.source_profile_id)?.data_source_name ?? '',
          profiles.find((profile) => profile.id === request.target_profile_id)?.data_source_name ?? '',
        ),
      )
      await refreshCompareHistoryState()
      pushToast('结构对比完成', 'success')
    } catch (error) {
      setStructureCompareState((previous) => ({ ...previous, loading: false }))
      pushToast(error instanceof Error ? error.message : '结构对比失败', 'error')
    }
  }

  async function exportSelectedStructureCompareSql() {
    try {
      if (!structureCompareState.result || !structureCompareState.current_request) {
        throw new Error('当前没有可导出的结构对比结果')
      }

      const selection = buildStructureSqlSelection(
        structureCompareState.selection_by_category,
      )
      const selectedCount =
        selection.added_tables.length +
        selection.modified_tables.length +
        selection.deleted_tables.length

      if (selectedCount === 0) {
        throw new Error('请至少选择一张表后再导出 SQL')
      }

      const saveTarget = await chooseSqlExportPath({
        default_file_name: buildStructureCompareSqlFileName(compareForm),
      })
      if (saveTarget.canceled || !saveTarget.file_path) {
        return
      }

      const result = await exportStructureCompareSqlFile({
        compare_request: structureCompareState.current_request,
        selection,
        file_path: saveTarget.file_path,
      })

      pushToast('结构对比 SQL 已导出', 'success')
      appendOutputLog(
        '结构对比导出',
        `已导出到 ${result.file_path}，新增 ${result.added_count}，修改 ${result.modified_count}，删除 ${result.deleted_count}`,
        'success',
      )
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '导出结构 SQL 失败', 'error')
    }
  }

  function toggleStructureCategorySelection(
    category: StructureDetailCategory,
    checked: boolean,
  ) {
    setStructureCompareState((previous) => ({
      ...previous,
      selection_by_category: {
        ...previous.selection_by_category,
        [category]: checked
          ? getStructureItemsByCategory(previous.result, category).map((item) => item.table_name)
          : [],
      },
    }))
  }

  function toggleStructureTableSelection(
    category: StructureDetailCategory,
    tableName: string,
    checked: boolean,
  ) {
    setStructureCompareState((previous) => {
      const selection = new Set(previous.selection_by_category[category])
      if (checked) {
        selection.add(tableName)
      } else {
        selection.delete(tableName)
      }

      return {
        ...previous,
        selection_by_category: {
          ...previous.selection_by_category,
          [category]: Array.from(selection).sort((left, right) =>
            left.localeCompare(right, 'zh-CN'),
          ),
        },
      }
    })
  }

  async function toggleStructureDetail(
    category: StructureDetailCategory,
    tableName: string,
    request = structureCompareState.current_request,
    forceReload = false,
  ) {
    if (!request) {
      return
    }

    const detailKey = buildStructureCompareDetailKey(category, tableName)
    const alreadyExpanded = structureCompareState.expanded_detail_keys.includes(detailKey)
    if (alreadyExpanded && !forceReload) {
      setStructureCompareState((previous) => ({
        ...previous,
        expanded_detail_keys: previous.expanded_detail_keys.filter((item) => item !== detailKey),
      }))
      return
    }

    setStructureCompareState((previous) => ({
      ...previous,
      active_category: category,
      expanded_detail_keys: alreadyExpanded
        ? previous.expanded_detail_keys
        : [...previous.expanded_detail_keys, detailKey],
    }))

    try {
      setStructureCompareState((previous) => ({
        ...previous,
        detail_cache: {
          ...previous.detail_cache,
          [detailKey]: {
            loading: true,
            error: '',
            detail: previous.detail_cache[detailKey]?.detail ?? null,
          },
        },
      }))

      const detail = await loadStructureCompareDetail({
        compare_request: request,
        category,
        table_name: tableName,
      })
      setStructureCompareState((previous) => ({
        ...previous,
        detail_cache: {
          ...previous.detail_cache,
          [detailKey]: {
            loading: false,
            error: '',
            detail,
          },
        },
      }))
    } catch (error) {
      setStructureCompareState((previous) => ({
        ...previous,
        detail_cache: {
          ...previous.detail_cache,
          [detailKey]: {
            loading: false,
            error: error instanceof Error ? error.message : '读取结构详情失败',
            detail: previous.detail_cache[detailKey]?.detail ?? null,
          },
        },
      }))
    }
  }

  async function ensureTablesLoaded(
    profileId: string,
    databaseName: string,
    options?: { force?: boolean },
  ) {
    const databaseKey = buildDatabaseKey(profileId, databaseName)
    if (!options?.force && tablesByDatabase[databaseKey]) {
      return tablesByDatabase[databaseKey]
    }

    setNodeLoading((previous) => ({ ...previous, [databaseKey]: true }))
    try {
      const tables = await listDatabaseTables(profileId, databaseName)
      setTablesByDatabase((previous) => ({ ...previous, [databaseKey]: tables }))
      return tables
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '读取数据表失败', 'error')
      return []
    } finally {
      setNodeLoading((previous) => ({ ...previous, [databaseKey]: false }))
    }
  }

  async function ensureSqlAutocompleteLoaded(
    profileId: string,
    databaseName: string,
    options?: { force?: boolean; silent?: boolean },
  ) {
    const databaseKey = buildDatabaseKey(profileId, databaseName)
    if (!options?.force && sqlAutocompleteByDatabase[databaseKey]) {
      return sqlAutocompleteByDatabase[databaseKey]
    }

    if (!options?.force && sqlAutocompleteRequestsRef.current[databaseKey]) {
      return sqlAutocompleteRequestsRef.current[databaseKey]
    }

    const request = (async () => {
      try {
        const schema = await loadSqlAutocomplete({
          profile_id: profileId,
          database_name: databaseName,
        })
        setSqlAutocompleteByDatabase((previous) => ({
          ...previous,
          [databaseKey]: schema,
        }))
        return schema
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '读取 SQL 自动补全元数据失败'
        if (!options?.silent) {
          pushToast(message, 'error')
        }
        return null
      } finally {
        delete sqlAutocompleteRequestsRef.current[databaseKey]
      }
    })()

    sqlAutocompleteRequestsRef.current[databaseKey] = request
    return request
  }

  function clearSqlAutocompleteCache(profileId: string, databaseName?: string) {
    if (databaseName) {
      const databaseKey = buildDatabaseKey(profileId, databaseName)
      setSqlAutocompleteByDatabase((previous) => {
        const next = { ...previous }
        delete next[databaseKey]
        return next
      })
      delete sqlAutocompleteRequestsRef.current[databaseKey]
      return
    }

    setSqlAutocompleteByDatabase((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => !key.startsWith(`${profileId}:`)),
      ),
    )
    Object.keys(sqlAutocompleteRequestsRef.current).forEach((key) => {
      if (key.startsWith(`${profileId}:`)) {
        delete sqlAutocompleteRequestsRef.current[key]
      }
    })
  }

  function clearProfileCaches(profileId: string) {
    setDatabasesByProfile((previous) => {
      const next = { ...previous }
      delete next[profileId]
      return next
    })
    setTablesByDatabase((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => !key.startsWith(`${profileId}:`)),
      ),
    )
    setProfileConnectionState((previous) => {
      const next = { ...previous }
      delete next[profileId]
      return next
    })
    clearSqlAutocompleteCache(profileId)
  }

  function openProfileEditorTab(profile?: ConnectionProfile) {
    const tabId = profile ? `profile:${profile.id}` : 'profile:create'

    upsertTab({
      id: tabId,
      kind: 'profile',
      title: profile ? `数据源 · ${profile.data_source_name}` : '新增数据源',
      subtitle: profile ? `${profile.host}:${profile.port}` : '在右侧编辑后保存',
      status: 'ready',
      error: '',
      editor: createProfileEditorState(
        profile ? 'edit' : 'create',
        profile ? profileToForm(profile) : { ...defaultConnectionForm },
      ),
    })
  }

  function openCreateDatabaseDialog(profileId: string) {
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) {
      pushToast('当前数据源不存在', 'error')
      return
    }

    setCreateDatabaseDialog({
      profile_id: profileId,
      data_source_name: profile.data_source_name,
      form: {
        profile_id: profileId,
        database_name: '',
      },
      busy: false,
    })
  }

  function openCreateTableTab(profileId: string, databaseName: string) {
    const profile = profiles.find((item) => item.id === profileId)
    const tabId = `create-table:${profileId}:${databaseName}`

    upsertTab({
      id: tabId,
      kind: 'design',
      title: `${databaseName}.新建表`,
      subtitle: profile?.data_source_name ?? '未知数据源',
      status: 'ready',
      error: '',
      profile_id: profileId,
      database_name: databaseName,
      table_name: '',
      design: {
        mode: 'create',
        loading: false,
        error: '',
        ddl: '',
        draft_table_name: '',
        original_columns: [],
        draft_columns: [
          createDraftColumn(
            {
              name: 'id',
              data_type: 'bigint',
              full_data_type: 'bigint',
              length: null,
              scale: null,
              nullable: false,
              primary_key: true,
              auto_increment: true,
              default_value: null,
              comment: '主键ID',
              ordinal_position: 1,
            },
            null,
          ),
        ],
      },
    })
  }

  function updateProfileTabField(
    tabId: string,
    field: keyof SaveConnectionProfilePayload,
    value: string | number | null,
  ) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'profile') {
        return tab
      }

      return {
        ...tab,
        editor: {
          ...tab.editor,
          test_result: '',
          form: {
            ...tab.editor.form,
            [field]: value,
          },
        },
      }
    })
  }

  function patchProfileEditor(
    tabId: string,
    updater: (editor: ProfileEditorState) => ProfileEditorState,
  ) {
    patchTab(tabId, (tab) =>
      tab.kind === 'profile'
        ? {
            ...tab,
            editor: updater(tab.editor),
          }
        : tab,
    )
  }

  function toggleProfileGroupManager(tabId: string) {
    patchProfileEditor(tabId, (editor) => ({
      ...editor,
      group_manager_open: !editor.group_manager_open,
      editing_group_id: null,
      editing_group_name: '',
    }))
  }

  function updateProfileGroupCreateName(tabId: string, value: string) {
    patchProfileEditor(tabId, (editor) => ({
      ...editor,
      create_group_name: value,
    }))
  }

  function startRenameProfileGroup(tabId: string, group: DataSourceGroup) {
    patchProfileEditor(tabId, (editor) => ({
      ...editor,
      editing_group_id: group.id,
      editing_group_name: group.group_name,
    }))
  }

  function cancelRenameProfileGroup(tabId: string) {
    patchProfileEditor(tabId, (editor) => ({
      ...editor,
      editing_group_id: null,
      editing_group_name: '',
    }))
  }

  function updateProfileEditingGroupName(tabId: string, value: string) {
    patchProfileEditor(tabId, (editor) => ({
      ...editor,
      editing_group_name: value,
    }))
  }

  function syncGroupNameAcrossState(
    previousGroupName: string,
    nextGroupName: string | null,
  ) {
    setProfiles((previous) =>
      sortProfiles(
        previous.map((profile) =>
          profile.group_name === previousGroupName
            ? { ...profile, group_name: nextGroupName }
            : profile,
        ),
      ),
    )
    setExpandedKeys((previous) => {
      const next = new Set(previous)
      next.delete(`group:${normalizeGroupName(previousGroupName)}`)
      if (nextGroupName) {
        next.add(`group:${normalizeGroupName(nextGroupName)}`)
      }
      return next
    })
    setTabs((previous) =>
      previous.map((currentTab) => {
        if (currentTab.kind !== 'profile') {
          return currentTab
        }

        if (currentTab.editor.form.group_name !== previousGroupName) {
          return currentTab
        }

        return {
          ...currentTab,
          editor: {
            ...currentTab.editor,
            form: {
              ...currentTab.editor.form,
              group_name: nextGroupName,
            },
          },
        }
      }),
    )
  }

  async function createProfileGroupFromTab(tab: ProfileTab) {
    patchProfileEditor(tab.id, (editor) => ({
      ...editor,
      group_busy: true,
    }))

    try {
      const group = await createDataSourceGroup({
        group_name: tab.editor.create_group_name,
      })
      setDataSourceGroups((previous) => sortDataSourceGroups([...previous, group]))
      patchProfileEditor(tab.id, (editor) => ({
        ...editor,
        group_busy: false,
        create_group_name: '',
        form: {
          ...editor.form,
          group_name: group.group_name,
        },
      }))
      pushToast(`分组“${group.group_name}”已创建`, 'success')
    } catch (error) {
      patchProfileEditor(tab.id, (editor) => ({
        ...editor,
        group_busy: false,
      }))
      pushToast(error instanceof Error ? error.message : '创建分组失败', 'error')
    }
  }

  async function renameProfileGroupFromTab(tab: ProfileTab) {
    const groupId = tab.editor.editing_group_id
    if (!groupId) {
      return
    }

    patchProfileEditor(tab.id, (editor) => ({
      ...editor,
      group_busy: true,
    }))

    try {
      const result = await renameDataSourceGroup({
        group_id: groupId,
        group_name: tab.editor.editing_group_name,
      })
      setDataSourceGroups((previous) =>
        sortDataSourceGroups(
          previous.map((group) =>
            group.id === groupId
              ? { ...group, group_name: result.group_name }
              : group,
          ),
        ),
      )
      syncGroupNameAcrossState(result.previous_group_name, result.group_name)
      patchProfileEditor(tab.id, (editor) => ({
        ...editor,
        group_busy: false,
        editing_group_id: null,
        editing_group_name: '',
      }))
      pushToast(
        result.affected_profile_count > 0
          ? `分组已重命名，已同步 ${result.affected_profile_count} 个数据源`
          : '分组已重命名',
        'success',
      )
    } catch (error) {
      patchProfileEditor(tab.id, (editor) => ({
        ...editor,
        group_busy: false,
      }))
      pushToast(error instanceof Error ? error.message : '重命名分组失败', 'error')
    }
  }

  async function deleteProfileGroupFromTab(tab: ProfileTab, group: DataSourceGroup) {
    patchProfileEditor(tab.id, (editor) => ({
      ...editor,
      group_busy: true,
    }))

    try {
      const result = await deleteDataSourceGroup(group.id)
      setDataSourceGroups((previous) =>
        previous.filter((currentGroup) => currentGroup.id !== group.id),
      )
      syncGroupNameAcrossState(result.group_name, null)
      patchProfileEditor(tab.id, (editor) => ({
        ...editor,
        group_busy: false,
        editing_group_id:
          editor.editing_group_id === group.id ? null : editor.editing_group_id,
        editing_group_name: editor.editing_group_id === group.id ? '' : editor.editing_group_name,
        form: {
          ...editor.form,
          group_name:
            editor.form.group_name === group.group_name ? null : editor.form.group_name,
        },
      }))
      pushToast(
        result.affected_profile_count > 0
          ? `分组已删除，${result.affected_profile_count} 个数据源已移入未分组`
          : '分组已删除',
        'success',
      )
    } catch (error) {
      patchProfileEditor(tab.id, (editor) => ({
        ...editor,
        group_busy: false,
      }))
      pushToast(error instanceof Error ? error.message : '删除分组失败', 'error')
    }
  }

  async function testProfileTab(tab: ProfileTab) {
    patchTab(tab.id, (currentTab) =>
      currentTab.kind === 'profile'
        ? {
            ...currentTab,
            status: 'busy',
            editor: { ...currentTab.editor, testing: true, test_result: '' },
          }
        : currentTab,
    )

    try {
      const result = await testConnectionProfile(normalizeProfileForm(tab.editor.form))
      patchTab(tab.id, (currentTab) =>
        currentTab.kind === 'profile'
          ? {
              ...currentTab,
              status: 'ready',
              editor: {
                ...currentTab.editor,
                testing: false,
                test_result: `连接成功，MySQL ${result.server_version}${
                  result.current_database ? `，当前库 ${result.current_database}` : ''
                }`,
              },
            }
          : currentTab,
      )
    } catch (error) {
      patchTab(tab.id, (currentTab) =>
        currentTab.kind === 'profile'
          ? {
              ...currentTab,
              status: 'ready',
              editor: {
                ...currentTab.editor,
                testing: false,
                test_result: error instanceof Error ? error.message : '连接测试失败',
              },
            }
          : currentTab,
      )
    }
  }

  async function saveProfileTab(tab: ProfileTab) {
    patchTab(tab.id, (currentTab) =>
      currentTab.kind === 'profile'
        ? {
            ...currentTab,
            status: 'busy',
            editor: { ...currentTab.editor, saving: true, test_result: '' },
          }
        : currentTab,
    )

    try {
      const savedProfile = await saveConnectionProfile(
        normalizeProfileForm(tab.editor.form),
      )

      setProfiles((previous) => sortProfiles(upsertProfile(previous, savedProfile)))
      clearProfileCaches(savedProfile.id)
      void ensureDatabasesLoaded(savedProfile.id, { silent: true })
      setSelectedGroupKey('')
      setSelection({ kind: 'profile', profile_id: savedProfile.id })
      setExpandedKeys((previous) => expandAncestorsForProfile(previous, savedProfile))

      replaceTab(tab.id, {
        id: `profile:${savedProfile.id}`,
        kind: 'profile',
        title: `数据源 · ${savedProfile.data_source_name}`,
        subtitle: `${savedProfile.host}:${savedProfile.port}`,
        status: 'ready',
        error: '',
        editor: {
          ...createProfileEditorState('edit', profileToForm(savedProfile)),
          test_result: '数据源已保存',
        },
      })

      pushToast('数据源已保存', 'success')
    } catch (error) {
      patchTab(tab.id, (currentTab) =>
        currentTab.kind === 'profile'
          ? {
              ...currentTab,
              status: 'ready',
              editor: {
                ...currentTab.editor,
                saving: false,
                test_result: error instanceof Error ? error.message : '保存失败',
              },
            }
          : currentTab,
      )
    }
  }

  async function deleteProfileFromTab(tab: ProfileTab) {
    const profileId = tab.editor.form.id
    if (!profileId) {
      removeTab(tab.id)
      return
    }

    try {
      await deleteConnectionProfile(profileId)
      clearProfileCaches(profileId)
      setProfiles((previous) => previous.filter((profile) => profile.id !== profileId))
      setTabs((previous) =>
        previous.filter(
          (currentTab) =>
            !(
              ('profile_id' in currentTab && currentTab.profile_id === profileId) ||
              currentTab.id === tab.id
            ),
        ),
      )
      setSelectedGroupKey('')
      setSelection({ kind: 'none' })
      setActiveTabId('')
      pushToast('数据源已删除', 'success')
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '删除失败', 'error')
    }
  }

  async function toggleNodeExpansion(
    key: string,
    loader?: () => Promise<void>,
  ) {
    const next = new Set(expandedKeys)
    if (next.has(key)) {
      next.delete(key)
      setExpandedKeys(next)
      return
    }

    next.add(key)
    setExpandedKeys(next)
    if (loader) {
      await loader()
    }
  }

  async function openTableTab(
    kind: 'design' | 'data',
    profileId: string,
    databaseName: string,
    tableName: string,
  ) {
    const profile = profiles.find((item) => item.id === profileId)
    const tabId = `${kind}:${profileId}:${databaseName}:${tableName}`

    if (kind === 'design') {
      upsertTab({
        id: tabId,
        kind: 'design',
        title: `${databaseName}.${tableName}`,
        subtitle: profile?.data_source_name ?? '未知数据源',
        status: 'loading',
        error: '',
        profile_id: profileId,
        database_name: databaseName,
        table_name: tableName,
        design: {
          mode: 'edit',
          loading: true,
          error: '',
          ddl: '',
          draft_table_name: tableName,
          original_columns: [],
          draft_columns: [],
        },
      })
      await refreshDesignTab(tabId, profileId, databaseName, tableName)
      return
    }

    upsertTab({
      id: tabId,
      kind: 'data',
      title: `${databaseName}.${tableName}`,
      subtitle: profile?.data_source_name ?? '未知数据源',
      status: 'loading',
      error: '',
      profile_id: profileId,
      database_name: databaseName,
      table_name: tableName,
      data: {
        loading: true,
        error: '',
        columns: [],
        rows: [],
        primary_keys: [],
        where_clause: '',
        order_by_clause: '',
        offset: 0,
        limit: 100,
        total_rows: 0,
        row_count_exact: true,
        editable: true,
        transaction_mode: 'auto',
      },
    })
    await refreshDataTab(tabId, profileId, databaseName, tableName, '', '', 0, 100)
  }

  function openConsoleTab(scope: SelectionState) {
    if (scope.kind === 'none') {
      pushToast('请先选择数据源、数据库或表', 'info')
      return
    }

    void ensureDatabasesLoaded(scope.profile_id, { silent: true })

    const profile = profiles.find((item) => item.id === scope.profile_id)
    const databaseName =
      scope.kind === 'database' || scope.kind === 'table' ? scope.database_name : null
    const tableName = scope.kind === 'table' ? scope.table_name : null

    if (databaseName) {
      void ensureSqlAutocompleteLoaded(scope.profile_id, databaseName, { silent: true })
    }

    const tabId = `console:${scope.profile_id}:${databaseName ?? '__profile__'}:${tableName ?? '__scope__'}`
    const scopeLabel =
      scope.kind === 'profile'
        ? profile?.data_source_name ?? '未知数据源'
        : scope.kind === 'database'
          ? `${profile?.data_source_name ?? '未知数据源'} / ${scope.database_name}`
          : `${profile?.data_source_name ?? '未知数据源'} / ${scope.database_name}.${scope.table_name}`

    upsertTab({
      id: tabId,
      kind: 'console',
      title: '控制台',
      subtitle: scopeLabel,
      status: 'ready',
      error: '',
      profile_id: scope.profile_id,
      database_name: databaseName,
      table_name: tableName,
      console: {
        loading: false,
        error: '',
        sql:
          scope.kind === 'table'
            ? `SELECT *\nFROM ${quoteIdentifier(scope.database_name)}.${quoteIdentifier(
                scope.table_name,
              )}`
            : '',
        message:
          scope.kind === 'profile'
            ? '当前控制台未指定默认数据库，请使用库名前缀或先选择数据库。'
            : `当前控制台默认连接到 ${databaseName}。`,
        executed_sql: '',
        result_kind: 'idle',
        columns: [],
        rows: [],
        offset: 0,
        limit: 200,
        total_rows: 0,
        row_count_exact: true,
        affected_rows: 0,
        truncated: false,
        database_loading: !databasesByProfile[scope.profile_id],
      },
    })
  }

  async function refreshDesignTab(
    tabId: string,
    profileId: string,
    databaseName: string,
    tableName: string,
  ) {
    patchTab(tabId, (tab) =>
      tab.kind === 'design'
        ? {
            ...tab,
            status: 'loading',
            error: '',
            design: { ...tab.design, loading: true, error: '' },
          }
        : tab,
    )

    try {
      const design = await loadTableDesign({
        profile_id: profileId,
        database_name: databaseName,
        table_name: tableName,
      })

      patchTab(tabId, (tab) =>
        tab.kind === 'design'
          ? {
              ...tab,
              status: 'ready',
              error: '',
              design: {
                mode: 'edit',
                loading: false,
                error: '',
                ddl: design.ddl,
                draft_table_name: design.table_name,
                original_columns: design.columns,
                draft_columns: design.columns.map((column) =>
                  createDraftColumn(column),
                ),
              },
            }
          : tab,
      )
    } catch (error) {
      patchTab(tabId, (tab) =>
        tab.kind === 'design'
          ? {
              ...tab,
              status: 'error',
              error: error instanceof Error ? error.message : '读取表结构失败',
              design: {
                ...tab.design,
                loading: false,
                error: error instanceof Error ? error.message : '读取表结构失败',
              },
            }
          : tab,
      )
    }
  }

  async function refreshDataTab(
    tabId: string,
    profileId: string,
    databaseName: string,
    tableName: string,
    whereClause: string,
    orderByClause: string,
    offset: number,
    limit: number,
  ) {
    patchTab(tabId, (tab) =>
      tab.kind === 'data'
        ? {
            ...tab,
            status: 'loading',
            error: '',
            data: { ...tab.data, loading: true, error: '' },
          }
        : tab,
    )

    try {
      const startedAt = performance.now()
      const data = await loadTableData({
        profile_id: profileId,
        database_name: databaseName,
        table_name: tableName,
        where_clause: whereClause,
        order_by_clause: orderByClause,
        offset,
        limit,
      })

      patchTab(tabId, (tab) =>
        tab.kind === 'data'
          ? {
              ...tab,
              status: 'ready',
              error: '',
              data: {
                loading: false,
                error: '',
                columns: data.columns,
                rows: data.rows.map((row) => createGridRow(row)),
                primary_keys: data.primary_keys,
                where_clause: whereClause,
                order_by_clause: orderByClause,
                offset: data.offset,
                limit: data.limit,
                total_rows: data.total_rows,
                row_count_exact: data.row_count_exact,
                editable: data.editable,
                transaction_mode: tab.data.transaction_mode,
              },
            }
          : tab,
      )

      appendOutputLog(
        databaseName,
        `在 ${Math.max(1, Math.round(performance.now() - startedAt))} ms 内读取了 ${data.rows.length} 行数据${
          data.row_count_exact ? `，共 ${data.total_rows} 行` : '，结果总数未统计'
        }`,
        'success',
        buildTableDataSql(databaseName, tableName, whereClause, orderByClause, limit, offset),
      )
    } catch (error) {
      appendOutputLog(
        databaseName,
        error instanceof Error ? error.message : '读取表数据失败',
        'error',
        buildTableDataSql(databaseName, tableName, whereClause, orderByClause, limit, offset),
      )
      patchTab(tabId, (tab) =>
        tab.kind === 'data'
          ? {
              ...tab,
              status: 'error',
              error: error instanceof Error ? error.message : '读取表数据失败',
              data: {
                ...tab.data,
                loading: false,
                error: error instanceof Error ? error.message : '读取表数据失败',
              },
            }
          : tab,
      )
    }
  }

  function updateDesignRow(
    tabId: string,
    clientId: string,
    field: keyof TableColumn,
    value: string | boolean | number | null,
  ) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'design') {
        return tab
      }

      return {
        ...tab,
        design: {
          ...tab.design,
          draft_columns: tab.design.draft_columns.map((column) => {
            if (column.client_id !== clientId) {
              return column
            }

            const nextColumn = {
              ...column,
              [field]: value,
            }

            return {
              ...nextColumn,
              full_data_type: buildFullDataType(nextColumn),
            }
          }),
        },
      }
    })
  }

  function updateDesignDraftTableName(tabId: string, value: string) {
    patchTab(tabId, (tab) =>
      tab.kind === 'design'
        ? {
            ...tab,
            design: {
              ...tab.design,
              draft_table_name: value,
            },
          }
        : tab,
    )
  }

  function toggleDesignRowSelection(tabId: string, clientId: string, checked: boolean) {
    patchTab(tabId, (tab) =>
      tab.kind === 'design'
        ? {
            ...tab,
            design: {
              ...tab.design,
              draft_columns: tab.design.draft_columns.map((column) =>
                column.client_id === clientId
                  ? { ...column, selected: checked }
                  : column,
              ),
            },
          }
        : tab,
    )
  }

  function toggleAllDesignRows(tabId: string, checked: boolean) {
    patchTab(tabId, (tab) =>
      tab.kind === 'design'
        ? {
            ...tab,
            design: {
              ...tab.design,
              draft_columns: tab.design.draft_columns.map((column) => ({
                ...column,
                selected: checked,
              })),
            },
          }
        : tab,
    )
  }

  function addDesignRow(tabId: string) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'design') {
        return tab
      }

      const nextIndex = tab.design.draft_columns.length + 1
      return {
        ...tab,
        design: {
          ...tab.design,
          draft_columns: [
            ...tab.design.draft_columns,
            createDraftColumn(
              {
                name: `new_column_${nextIndex}`,
                data_type: 'varchar',
                full_data_type: 'varchar(64)',
                length: 64,
                scale: null,
                nullable: true,
                primary_key: false,
                auto_increment: false,
                default_value: null,
                comment: '',
                ordinal_position: nextIndex,
              },
              null,
            ),
          ],
        },
      }
    })
  }

  function deleteSelectedDesignRows(tabId: string) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'design') {
        return tab
      }

      const remaining = tab.design.draft_columns.filter((column) => !column.selected)
      if (remaining.length === 0) {
        pushToast('表结构至少保留一个字段', 'info')
        return tab
      }

      return {
        ...tab,
        design: {
          ...tab.design,
          draft_columns: remaining.map((column, index) => ({
            ...column,
            selected: false,
            ordinal_position: index + 1,
          })),
        },
      }
    })
  }

  function restoreSelectedDesignRows(tabId: string) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'design') {
        return tab
      }

      const originalByName = Object.fromEntries(
        tab.design.original_columns.map((column) => [column.name, column]),
      )

      return {
        ...tab,
        design: {
          ...tab.design,
          draft_columns: tab.design.draft_columns
            .flatMap((column) => {
              if (!column.selected) {
                return [column]
              }

              if (column.origin_name && originalByName[column.origin_name]) {
                return [
                  {
                    ...createDraftColumn(
                      originalByName[column.origin_name],
                      column.origin_name,
                    ),
                    client_id: column.client_id,
                  },
                ]
              }

              return []
            })
            .map((column, index) => ({
              ...column,
              selected: false,
              ordinal_position: index + 1,
            })),
        },
      }
    })
  }

  async function previewDesignSql(tab: DesignTab) {
    try {
      const columns = tab.design.draft_columns.map((column) => stripDraftColumn(column))
      const preview =
        tab.design.mode === 'create'
          ? await previewCreateTableSql({
              profile_id: tab.profile_id,
              database_name: tab.database_name,
              table_name: tab.design.draft_table_name,
              columns,
            })
          : await previewTableDesignSql({
              profile_id: tab.profile_id,
              database_name: tab.database_name,
              table_name: tab.table_name,
              columns,
            })

      setSqlPreview({
        title:
          tab.design.mode === 'create'
            ? `${tab.database_name}.${tab.design.draft_table_name || '新表'} 创建 SQL`
            : `${tab.title} 结构变更 SQL`,
        statements:
          preview.statements.length > 0
            ? preview.statements
            : ['-- 当前没有待提交的结构改动'],
        busy: false,
      })
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'DDL 预览失败', 'error')
    }
  }

  async function commitDesignChanges(tab: DesignTab) {
    try {
      const columns = tab.design.draft_columns.map((column) => stripDraftColumn(column))
      const previewPayload = {
        profile_id: tab.profile_id,
        database_name: tab.database_name,
        table_name:
          tab.design.mode === 'create' ? tab.design.draft_table_name : tab.table_name,
        columns,
      }
      const preview =
        tab.design.mode === 'create'
          ? await previewCreateTableSql(previewPayload)
          : await previewTableDesignSql(previewPayload)

      setSqlPreview({
        title:
          tab.design.mode === 'create'
            ? `${tab.database_name}.${tab.design.draft_table_name || '新表'} 创建 SQL`
            : `${tab.title} 结构变更 SQL`,
        statements:
          preview.statements.length > 0
            ? preview.statements
            : ['-- 当前没有待提交的结构改动'],
        confirm_label:
          preview.statements.length > 0
            ? tab.design.mode === 'create'
              ? '确认创建数据表'
              : '确认提交结构变更'
            : undefined,
        busy: false,
        on_confirm:
          preview.statements.length > 0
            ? async () => {
                setSqlPreview((previous) =>
                  previous ? { ...previous, busy: true } : previous,
                )
                const startedAt = performance.now()
                setSqlPreview(null)
                if (tab.design.mode === 'create') {
                  const result = await createTable(previewPayload)
                  pushToast(`数据表已创建，共执行 ${result.affected_rows} 条语句`, 'success')
                  appendOutputLog(
                    tab.database_name,
                    `在 ${Math.max(1, Math.round(performance.now() - startedAt))} ms 内创建表成功`,
                    'success',
                    result.statements.join(';\n'),
                  )
                  await ensureTablesLoaded(tab.profile_id, tab.database_name, { force: true })
                  clearSqlAutocompleteCache(tab.profile_id, tab.database_name)
                  void ensureSqlAutocompleteLoaded(tab.profile_id, tab.database_name, {
                    force: true,
                    silent: true,
                  })
                  selectTable(
                    tab.profile_id,
                    tab.database_name,
                    tab.design.draft_table_name.trim(),
                  )
                  setTabs((previous) => previous.filter((item) => item.id !== tab.id))
                  await openTableTab(
                    'design',
                    tab.profile_id,
                    tab.database_name,
                    tab.design.draft_table_name.trim(),
                  )
                  return
                }

                const result = await applyTableDesignChanges(previewPayload)
                pushToast(
                  `结构变更已提交，共执行 ${result.affected_rows} 条语句`,
                  'success',
                )
                appendOutputLog(
                  tab.database_name,
                  `在 ${Math.max(1, Math.round(performance.now() - startedAt))} ms 内完成表结构修改`,
                  'success',
                  result.statements.join(';\n'),
                )
                clearSqlAutocompleteCache(tab.profile_id, tab.database_name)
                void ensureSqlAutocompleteLoaded(tab.profile_id, tab.database_name, {
                  force: true,
                  silent: true,
                })
                await refreshDesignTab(
                  tab.id,
                  tab.profile_id,
                  tab.database_name,
                  tab.table_name,
                )
              }
            : undefined,
      })
    } catch (error) {
      appendOutputLog(
        tab.database_name,
        error instanceof Error ? error.message : '结构提交失败',
        'error',
        tab.design.mode === 'create'
          ? buildCreateTablePreviewSql(tab)
          : `ALTER TABLE ${quoteIdentifier(tab.database_name)}.${quoteIdentifier(tab.table_name)} ...`,
      )
      pushToast(error instanceof Error ? error.message : '结构提交失败', 'error')
    }
  }

  function updateDataRow(
    tabId: string,
    clientId: string,
    columnName: string,
    nextValue: CellValue,
  ) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'data') {
        return tab
      }

      return {
        ...tab,
        data: {
          ...tab.data,
          rows: tab.data.rows.map((row) => {
            if (row.client_id !== clientId || row.state === 'deleted') {
              return row
            }

            const nextValues = { ...row.values, [columnName]: nextValue }
            const changedValues = buildChangedDataValues({
              ...row,
              values: nextValues,
            })
            const nextState =
              row.state === 'new'
                ? 'new'
                : Object.keys(changedValues).length === 0
                  ? 'clean'
                  : 'updated'

            return {
              ...row,
              values: nextValues,
              state: nextState,
            }
          }),
        },
      }
    })
  }

  function selectDataRowsRange(
    tabId: string,
    startClientId: string,
    endClientId: string,
    options?: { append?: boolean },
  ) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'data') {
        return tab
      }

      const startIndex = tab.data.rows.findIndex((row) => row.client_id === startClientId)
      const endIndex = tab.data.rows.findIndex((row) => row.client_id === endClientId)
      if (startIndex === -1 || endIndex === -1) {
        return tab
      }

      const rangeStart = Math.min(startIndex, endIndex)
      const rangeEnd = Math.max(startIndex, endIndex)
      return {
        ...tab,
        data: {
          ...tab.data,
          rows: tab.data.rows.map((row, index) => {
            if (index >= rangeStart && index <= rangeEnd) {
              return { ...row, selected: true }
            }

            return options?.append ? row : { ...row, selected: false }
          }),
        },
      }
    })
  }

  function addDataRow(tabId: string) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'data') {
        return tab
      }

      const blankValues = Object.fromEntries(
        tab.data.columns.map((column) => [
          column.name,
          column.default_value ? inferDefaultCellValue(column.default_value) : null,
        ]),
      ) as JsonRecord

      return {
        ...tab,
        data: {
          ...tab.data,
          rows: [
            ...tab.data.rows,
            {
              client_id: createClientId(),
              selected: false,
              state: 'new',
              row_key: null,
              original_values: {},
              values: blankValues,
            },
          ],
        },
      }
    })
  }

  function deleteSelectedDataRows(tabId: string) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'data') {
        return tab
      }

      return {
        ...tab,
        data: {
          ...tab.data,
          rows: tab.data.rows.flatMap((row) => {
            if (!row.selected) {
              return [row]
            }

            if (row.state === 'new') {
              return []
            }

            return [{ ...row, state: 'deleted' as const, selected: false }]
          }),
        },
      }
    })
  }

  function restoreSelectedDataRows(tabId: string) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'data') {
        return tab
      }

      return {
        ...tab,
        data: {
          ...tab.data,
          rows: tab.data.rows.flatMap((row) => {
            if (!row.selected) {
              return [row]
            }

            if (row.state === 'new') {
              return []
            }

            return [
              {
                ...row,
                selected: false,
                state: 'clean' as const,
                values: { ...row.original_values },
              },
            ]
          }),
        },
      }
    })
  }

  function updateDataQueryField(
    tabId: string,
    field: 'where_clause' | 'order_by_clause' | 'transaction_mode',
    value: string,
  ) {
    patchTab(tabId, (tab) =>
      tab.kind === 'data'
        ? {
            ...tab,
            data: {
              ...tab.data,
              [field]:
                field === 'transaction_mode'
                  ? (value as 'auto' | 'manual')
                  : value,
            },
          }
        : tab,
    )
  }

  async function changeDataPage(tab: DataTab, direction: 'first' | 'prev' | 'next' | 'last') {
    let nextOffset = tab.data.offset
    if (direction === 'first') {
      nextOffset = 0
    } else if (direction === 'prev') {
      nextOffset = Math.max(tab.data.offset - tab.data.limit, 0)
    } else if (direction === 'next') {
      if (tab.data.rows.length < tab.data.limit) {
        return
      }
      nextOffset = tab.data.offset + tab.data.limit
    } else if (direction === 'last') {
      if (!tab.data.row_count_exact) {
        return
      }
      const lastOffset = Math.max(
        Math.ceil(tab.data.total_rows / Math.max(tab.data.limit, 1)) - 1,
        0,
      ) * tab.data.limit
      nextOffset = lastOffset
    }

    if (nextOffset === tab.data.offset && direction !== 'first') {
      return
    }

    await refreshDataTab(
      tab.id,
      tab.profile_id,
      tab.database_name,
      tab.table_name,
      tab.data.where_clause,
      tab.data.order_by_clause,
      nextOffset,
      tab.data.limit,
    )
  }

  async function commitDataChanges(tab: DataTab) {
    const payload = buildDataMutationPayload(tab)
    if (!payload) {
      pushToast('当前没有待提交的数据改动', 'info')
      return
    }

    try {
      const preview = await previewTableDataChanges(payload)
      const previewStatements =
        preview.statements.length > 0
          ? preview.statements
          : ['-- 当前没有待提交的数据改动']
      setSqlPreview({
        title: `${tab.title} 数据变更 SQL`,
        statements: previewStatements,
        confirm_label: preview.statements.length > 0 ? '确认提交数据改动' : undefined,
        busy: false,
        on_confirm:
          preview.statements.length > 0
            ? async () => {
                setSqlPreview((previous) =>
                  previous ? { ...previous, busy: true } : previous,
                )
                const startedAt = performance.now()
                try {
                  const result = await applyTableDataChanges(payload)
                  pushToast(
                    `数据变更已提交，共处理 ${result.affected_rows} 行`,
                    'success',
                  )
                  appendOutputLog(
                    tab.database_name,
                    `在 ${Math.max(1, Math.round(performance.now() - startedAt))} ms 内提交了 ${result.affected_rows} 行数据变更`,
                    'success',
                    result.statements.join(';\n'),
                  )
                  setSqlPreview(null)
                  await refreshDataTab(
                    tab.id,
                    tab.profile_id,
                    tab.database_name,
                    tab.table_name,
                    tab.data.where_clause,
                    tab.data.order_by_clause,
                    tab.data.offset,
                    tab.data.limit,
                  )
                } catch (error) {
                  const message = error instanceof Error ? error.message : '数据提交失败'
                  setSqlPreview((previous) =>
                    previous ? { ...previous, busy: false } : previous,
                  )
                  appendOutputLog(
                    tab.database_name,
                    message,
                    'error',
                    previewStatements.join(';\n'),
                  )
                  pushToast(message, 'error')
                }
              }
            : undefined,
      })
    } catch (error) {
      appendOutputLog(
        tab.database_name,
        error instanceof Error ? error.message : '数据提交失败',
        'error',
        buildDataMutationPreviewSql(tab),
      )
      pushToast(error instanceof Error ? error.message : '数据提交失败', 'error')
    }
  }

  async function openTableDdl(profileId: string, databaseName: string, tableName: string) {
    try {
      const startedAt = performance.now()
      const ddl = await getTableDdl({
        profile_id: profileId,
        database_name: databaseName,
        table_name: tableName,
      })
      setDdlDialog({
        title: `${databaseName}.${tableName} DDL`,
        ddl: ddl.ddl,
      })
      appendOutputLog(
        databaseName,
        `在 ${Math.max(1, Math.round(performance.now() - startedAt))} ms 内读取了 ${databaseName}.${tableName} 的 DDL`,
        'success',
        `SHOW CREATE TABLE ${quoteIdentifier(databaseName)}.${quoteIdentifier(tableName)}`,
      )
    } catch (error) {
      appendOutputLog(
        databaseName,
        error instanceof Error ? error.message : '读取 DDL 失败',
        'error',
        `SHOW CREATE TABLE ${quoteIdentifier(databaseName)}.${quoteIdentifier(tableName)}`,
      )
      pushToast(error instanceof Error ? error.message : '读取 DDL 失败', 'error')
    }
  }

  async function saveCreateDatabaseDialog() {
    if (!createDatabaseDialog) {
      return
    }

    const databaseName = createDatabaseDialog.form.database_name.trim()
    if (!databaseName) {
      pushToast('数据库名不能为空', 'info')
      return
    }

    setCreateDatabaseDialog((previous) =>
      previous ? { ...previous, busy: true } : previous,
    )

    try {
      const startedAt = performance.now()
      const result = await createDatabase({
        profile_id: createDatabaseDialog.profile_id,
        database_name: databaseName,
      })
      setCreateDatabaseDialog(null)
      setExpandedKeys((previous) => {
        const next = new Set(previous)
        next.add(`profile:${createDatabaseDialog.profile_id}`)
        return next
      })
      await ensureDatabasesLoaded(createDatabaseDialog.profile_id, { force: true })
      clearSqlAutocompleteCache(createDatabaseDialog.profile_id, databaseName)
      selectDatabase(createDatabaseDialog.profile_id, databaseName)
      pushToast(`数据库 ${databaseName} 已创建`, 'success')
      appendOutputLog(
        databaseName,
        `在 ${Math.max(1, Math.round(performance.now() - startedAt))} ms 内创建数据库成功`,
        'success',
        result.statements.join(';\n'),
      )
    } catch (error) {
      setCreateDatabaseDialog((previous) =>
        previous ? { ...previous, busy: false } : previous,
      )
      appendOutputLog(
        databaseName,
        error instanceof Error ? error.message : '创建数据库失败',
        'error',
        `CREATE DATABASE ${quoteIdentifier(databaseName)}`,
      )
      pushToast(error instanceof Error ? error.message : '创建数据库失败', 'error')
    }
  }

  function updateCreateDatabaseField(value: string) {
    setCreateDatabaseDialog((previous) =>
      previous
        ? {
            ...previous,
            form: {
              ...previous.form,
              database_name: value,
            },
          }
        : previous,
    )
  }

  function updateConsoleSql(tabId: string, value: string) {
    patchTab(tabId, (tab) =>
      tab.kind === 'console'
        ? {
            ...tab,
            console: {
              ...tab.console,
              sql: value,
            },
          }
        : tab,
    )
  }

  function updateConsoleDatabase(tabId: string, databaseName: string | null) {
    const consoleTab = tabs.find(
      (tab): tab is ConsoleTab => tab.id === tabId && tab.kind === 'console',
    )

    if (consoleTab && databaseName) {
      void ensureSqlAutocompleteLoaded(consoleTab.profile_id, databaseName, {
        silent: true,
      })
    }

    patchTab(tabId, (tab) => {
      if (tab.kind !== 'console') {
        return tab
      }

      const profile = profiles.find((item) => item.id === tab.profile_id)
      const nextSubtitle = databaseName
        ? `${profile?.data_source_name ?? '未知数据源'} / ${databaseName}`
        : profile?.data_source_name ?? '未知数据源'

      return {
        ...tab,
        subtitle: nextSubtitle,
        database_name: databaseName,
        table_name: null,
        console: {
          ...tab.console,
          message: databaseName
            ? `当前控制台默认连接到 ${databaseName}。`
            : '当前控制台未指定默认数据库，请使用库名前缀或先选择数据库。',
        },
      }
    })

    if (databaseName) {
      appendOutputLog(
        databaseName,
        '已切换控制台默认数据库',
        'info',
        `USE ${quoteIdentifier(databaseName)}`,
      )
    }
  }

  function formatConsoleSql(tabId: string) {
    patchTab(tabId, (tab) =>
      tab.kind === 'console'
        ? {
            ...tab,
            console: {
              ...tab.console,
              sql: prettifySql(tab.console.sql),
            },
          }
        : tab,
    )
  }

  async function runConsoleSql(tab: ConsoleTab, offset = 0) {
    patchTab(tab.id, (currentTab) =>
      currentTab.kind === 'console'
        ? {
            ...currentTab,
            status: 'loading',
            error: '',
            console: {
              ...currentTab.console,
              loading: true,
              error: '',
            },
          }
        : currentTab,
    )

    try {
      const startedAt = performance.now()
      const result = await executeSql({
        profile_id: tab.profile_id,
        database_name: tab.database_name,
        sql: tab.console.sql,
        limit: tab.console.limit,
        offset,
      })

      patchTab(tab.id, (currentTab) =>
        currentTab.kind === 'console'
          ? {
              ...currentTab,
              status: 'ready',
              error: '',
              console: {
                ...currentTab.console,
                loading: false,
                error: '',
                executed_sql: result.executed_sql,
                message: result.message,
                result_kind:
                  result.result_kind === 'query' ? 'query' : 'mutation',
                columns: result.columns,
                rows: result.rows.map((row) => createGridRow(row)),
                offset: result.offset,
                limit: result.limit,
                total_rows: result.total_rows,
                row_count_exact: result.row_count_exact,
                affected_rows: result.affected_rows,
                truncated: result.truncated,
              },
            }
          : currentTab,
      )

      appendOutputLog(
        tab.database_name ?? 'console',
        result.result_kind === 'query'
          ? `在 ${Math.max(1, Math.round(performance.now() - startedAt))} ms 内返回 ${result.rows.length} 行${
              result.row_count_exact ? `，共 ${result.total_rows} 行` : '，结果总数未统计'
            }`
          : `在 ${Math.max(1, Math.round(performance.now() - startedAt))} ms 内完成，影响 ${result.affected_rows} 行`,
        'success',
        tab.database_name
          ? `USE ${quoteIdentifier(tab.database_name)};\n${result.executed_sql}`
          : result.executed_sql,
      )
    } catch (error) {
      appendOutputLog(
        tab.database_name ?? 'console',
        error instanceof Error ? error.message : 'SQL 执行失败',
        'error',
        tab.database_name
          ? `USE ${quoteIdentifier(tab.database_name)};\n${tab.console.sql}`
          : tab.console.sql,
      )
      patchTab(tab.id, (currentTab) =>
        currentTab.kind === 'console'
          ? {
              ...currentTab,
              status: 'error',
              error: error instanceof Error ? error.message : 'SQL 执行失败',
              console: {
                ...currentTab.console,
                loading: false,
                error: error instanceof Error ? error.message : 'SQL 执行失败',
              },
            }
          : currentTab,
      )
    }
  }

  async function changeConsolePage(
    tab: ConsoleTab,
    direction: 'first' | 'prev' | 'next' | 'last',
  ) {
    let nextOffset = tab.console.offset
    if (direction === 'first') {
      nextOffset = 0
    } else if (direction === 'prev') {
      nextOffset = Math.max(tab.console.offset - tab.console.limit, 0)
    } else if (direction === 'next') {
      if (!tab.console.truncated) {
        return
      }
      nextOffset = tab.console.offset + tab.console.limit
    } else if (direction === 'last') {
      if (!tab.console.row_count_exact) {
        return
      }
      const lastOffset = Math.max(
        Math.ceil(tab.console.total_rows / Math.max(tab.console.limit, 1)) - 1,
        0,
      ) * tab.console.limit
      nextOffset = lastOffset
    }

    if (nextOffset === tab.console.offset && direction !== 'first') {
      return
    }

    await runConsoleSql(tab, nextOffset)
  }

  function openConsoleFromSelection() {
    if (selection.kind === 'none') {
      pushToast('请先选择数据源、数据库或表', 'info')
      return
    }

    openConsoleTab(selection)
  }

  function confirmUnimplementedAction(title: string, body: string) {
    setConfirmDialog({
      title,
      body,
      confirm_label: '确认',
      busy: false,
      on_confirm: async () => {
        setConfirmDialog(null)
        pushToast('该功能暂未开发', 'info')
      },
    })
  }

  async function disconnectSelectedProfile() {
    const profileId =
      selection.kind === 'profile'
        ? selection.profile_id
        : selection.kind === 'database'
          ? selection.profile_id
        : selection.kind === 'table'
          ? selection.profile_id
          : ''

    if (!profileId) {
      pushToast('请先选择一个数据源', 'info')
      return
    }

    try {
      await disconnectConnectionProfile(profileId)
      setProfileConnectionState((previous) => ({
        ...previous,
        [profileId]: 'idle',
      }))
      pushToast('连接池已释放', 'success')
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '断开连接失败', 'error')
    }
  }

  async function refreshCurrentSelection() {
    if (selection.kind === 'profile') {
      await ensureDatabasesLoaded(selection.profile_id, { force: true })
      return
    }

    if (selection.kind === 'database') {
      await ensureTablesLoaded(selection.profile_id, selection.database_name, {
        force: true,
      })
      return
    }

    if (selection.kind === 'table') {
      const activeTab = tabs.find((tab) => tab.id === activeTabId)
      await ensureTablesLoaded(selection.profile_id, selection.database_name, {
        force: true,
      })
      if (activeTab?.kind === 'design') {
        await refreshDesignTab(
          activeTab.id,
          activeTab.profile_id,
          activeTab.database_name,
          activeTab.table_name,
        )
      }
      if (activeTab?.kind === 'data') {
        await refreshDataTab(
          activeTab.id,
          activeTab.profile_id,
          activeTab.database_name,
          activeTab.table_name,
          activeTab.data.where_clause,
          activeTab.data.order_by_clause,
          activeTab.data.offset,
          activeTab.data.limit,
        )
      }
      return
    }

    pushToast('请先选择数据源、数据库或数据表', 'info')
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const activeConsoleDatabaseKey =
    activeTab?.kind === 'console' && activeTab.database_name
      ? buildDatabaseKey(activeTab.profile_id, activeTab.database_name)
      : ''
  const activeConsoleAutocomplete =
    activeConsoleDatabaseKey && sqlAutocompleteByDatabase[activeConsoleDatabaseKey]
      ? sqlAutocompleteByDatabase[activeConsoleDatabaseKey]
      : null
  const activeConsoleSchemas =
    activeTab?.kind === 'console'
      ? Object.entries(sqlAutocompleteByDatabase)
          .filter(([key]) => key.startsWith(`${activeTab.profile_id}:`))
          .map(([, schema]) => schema)
      : []
  const selectedProfileId =
    selection.kind === 'profile'
      ? selection.profile_id
      : selection.kind === 'database'
        ? selection.profile_id
      : selection.kind === 'table'
        ? selection.profile_id
        : ''
  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ?? null
  const groupedProfiles = buildGroupedProfiles(profiles)
  const filteredDataCompareTables =
    dataCompareState.discovery?.common_tables.filter((tableName) =>
      tableName.toLowerCase().includes(dataCompareState.table_filter.trim().toLowerCase()),
    ) ?? []
  const visibleHistoryItems = compareHistoryItems.filter(
    (item) => item.history_type === compareHistoryType,
  )
  const selectedHistoryItem =
    visibleHistoryItems.find((item) => item.id === selectedHistoryId) ??
    visibleHistoryItems[0] ??
    null
  const collapseNavigationPane =
    activeSection === 'structure_compare' || activeSection === 'data_compare'

  return (
    <main className="app-shell" onClick={() => setTreeContextMenu(null)}>
      <div className="titlebar" data-tauri-drag-region></div>
      <section className="workspace-shell">
        <header
          className="window-bar"
        />

        <div
          className={`workspace-layout ${collapseNavigationPane ? 'workspace-layout-collapsed' : ''}`}
        >
          <aside className="tool-rail">
            <button
              className={`rail-item ${activeSection === 'datasource' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveSection('datasource')}
            >
              <span>数</span>
              <span>据</span>
              <span>源</span>
            </button>
            <button
              className={`rail-item ${activeSection === 'structure_compare' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveSection('structure_compare')}
            >
              <span>结</span>
              <span>构</span>
              <span>对</span>
              <span>比</span>
            </button>
            <button
              className={`rail-item ${activeSection === 'data_compare' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveSection('data_compare')}
            >
              <span>数</span>
              <span>据</span>
              <span>对</span>
              <span>比</span>
            </button>
            <button
              className={`rail-item ${activeSection === 'compare_history' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveSection('compare_history')}
            >
              <span>对</span>
              <span>比</span>
              <span>记</span>
              <span>录</span>
            </button>
            <button
              className="rail-item"
              type="button"
              onClick={() => pushToast('性能监控页未纳入本轮范围', 'info')}
            >
              <span>性</span>
              <span>能</span>
              <span>监</span>
              <span>控</span>
            </button>
          </aside>

          <aside className={`navigation-pane ${collapseNavigationPane ? 'hidden-pane' : ''}`}>
            {activeSection === 'datasource' ? (
            <>
            <div className="pane-header">
              <div className="pane-title">
                <DatabaseGlyph />
                <strong>数据库导航</strong>
              </div>

              <div className="pane-actions">
                <SquareIconButton label="新增数据源" onClick={() => openProfileEditorTab()}>
                  +
                </SquareIconButton>
                <SquareIconButton
                  label="数据源属性"
                  disabled={!selectedProfile}
                  onClick={() => {
                    if (selectedProfile) {
                      openProfileEditorTab(selectedProfile)
                    }
                  }}
                >
                  <DatabaseSettingsGlyph />
                </SquareIconButton>
                <SquareIconButton label="刷新" onClick={() => void refreshCurrentSelection()}>
                  ↻
                </SquareIconButton>
                <SquareIconButton
                  label="停止连接"
                  disabled={!selectedProfile}
                  onClick={() => void disconnectSelectedProfile()}
                >
                  ■
                </SquareIconButton>
                <SquareActionButton
                  label="控制台"
                  disabled={selection.kind === 'none'}
                  onClick={() => openConsoleFromSelection()}
                />
                <SquareActionButton
                  active={outputVisible}
                  label="输出"
                  onClick={() => setOutputVisible((previous) => !previous)}
                />
              </div>
            </div>

            <div className="tree-pane">
              {bootstrapError ? (
                <EmptyNotice title="初始化失败" text={bootstrapError} />
              ) : null}

              {!bootstrapError && profiles.length === 0 ? (
                <EmptyNotice
                  title="暂无数据源"
                  text="点击左上角加号，在右侧工作区创建新的 MySQL 数据源。"
                />
              ) : null}

              {groupedProfiles.map(([groupName, groupProfiles]) => {
                const groupKey = `group:${groupName}`
                const expanded = expandedKeys.has(groupKey)

                return (
                  <div className="tree-group" key={groupKey}>
                    <button
                      className={`tree-row group-row ${selectedGroupKey === groupKey ? 'selected' : ''}`}
                      type="button"
                      onClick={() => {
                        setSelectedGroupKey(groupKey)
                        setSelection({ kind: 'none' })
                        setTreeContextMenu(null)
                      }}
                      onDoubleClick={() => void toggleNodeExpansion(groupKey)}
                    >
                      <span className="tree-caret">{expanded ? '▾' : '▸'}</span>
                      <span className="tree-node-label">{groupName}</span>
                      <span className="tree-node-meta">{groupProfiles.length} 个数据源</span>
                    </button>

                    {expanded ? (
                      <div className="tree-children">
                        {groupProfiles.map((profile) => {
                          const datasourceKey = `profile:${profile.id}`
                          const datasourceExpanded = expandedKeys.has(datasourceKey)
                          const databases = databasesByProfile[profile.id] ?? []

                          return (
                            <div className="tree-group" key={profile.id}>
                              <button
                                className={`tree-row datasource-row ${
                                  selection.kind === 'profile' &&
                                  selection.profile_id === profile.id
                                    ? 'selected'
                                    : ''
                                }`}
                                type="button"
                                onClick={() => {
                                  selectProfile(profile.id)
                                }}
                                onDoubleClick={() => {
                                  selectProfile(profile.id)
                                  void toggleNodeExpansion(datasourceKey, async () => {
                                    await ensureDatabasesLoaded(profile.id)
                                  })
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  selectProfile(profile.id)
                                  setTreeContextMenu({
                                    kind: 'profile',
                                    x: Math.min(event.clientX, window.innerWidth - 188),
                                    y: Math.min(event.clientY, window.innerHeight - 140),
                                    profile_id: profile.id,
                                  })
                                }}
                              >
                                <span className="tree-caret">
                                  {datasourceExpanded ? '▾' : '▸'}
                                </span>
                                <span
                                  className={`connection-indicator connection-${
                                    profileConnectionState[profile.id] ?? 'idle'
                                  }`}
                                />
                                <span className="tree-node-label">{profile.data_source_name}</span>
                                <span className="tree-node-meta">
                                  {nodeLoading[profile.id]
                                    ? '加载中'
                                    : databasesByProfile[profile.id]
                                      ? `${databases.length} 个数据库`
                                      : '待加载'}
                                </span>
                              </button>

                              {datasourceExpanded ? (
                                <div className="tree-children">
                                  {databases.map((database) => {
                                    const databaseKey = buildDatabaseKey(
                                      profile.id,
                                      database.name,
                                    )
                                    const databaseNodeKey = `database:${databaseKey}`
                                    const databaseExpanded =
                                      expandedKeys.has(databaseNodeKey)
                                    const tables = tablesByDatabase[databaseKey] ?? []

                                    return (
                                      <div className="tree-group" key={databaseKey}>
                                        <button
                                          className={`tree-row database-row ${
                                            selection.kind === 'database' &&
                                            selection.profile_id === profile.id &&
                                            selection.database_name === database.name
                                              ? 'selected'
                                              : ''
                                          }`}
                                          type="button"
                                          onClick={() => {
                                            selectDatabase(profile.id, database.name)
                                          }}
                                          onDoubleClick={() => {
                                            selectDatabase(profile.id, database.name)
                                            void toggleNodeExpansion(
                                              databaseNodeKey,
                                              async () => {
                                                await ensureTablesLoaded(
                                                  profile.id,
                                                  database.name,
                                                )
                                              },
                                            )
                                          }}
                                          onContextMenu={(event) => {
                                            event.preventDefault()
                                            event.stopPropagation()
                                            selectDatabase(profile.id, database.name)
                                            setTreeContextMenu({
                                              kind: 'database',
                                              x: Math.min(
                                                event.clientX,
                                                window.innerWidth - 188,
                                              ),
                                              y: Math.min(
                                                event.clientY,
                                                window.innerHeight - 140,
                                              ),
                                              profile_id: profile.id,
                                              database_name: database.name,
                                            })
                                          }}
                                        >
                                          <span className="tree-caret">
                                            {databaseExpanded ? '▾' : '▸'}
                                          </span>
                                          <TreeDatabaseGlyph />
                                          <span className="tree-node-label">
                                            {database.name}
                                          </span>
                                          <span className="tree-node-meta">
                                            {database.table_count} 张表
                                          </span>
                                        </button>

                                        {databaseExpanded ? (
                                          <div className="tree-children">
                                            {tables.map((table) => (
                                              <button
                                                className={`tree-row table-row ${
                                                  selection.kind === 'table' &&
                                                  selection.profile_id === profile.id &&
                                                  selection.database_name === database.name &&
                                                  selection.table_name === table.name
                                                    ? 'selected'
                                                    : ''
                                                }`}
                                                key={`${databaseKey}:${table.name}`}
                                                type="button"
                                                onClick={() => {
                                                  selectTable(
                                                    profile.id,
                                                    database.name,
                                                    table.name,
                                                  )
                                                }}
                                                onDoubleClick={() => {
                                                  selectTable(
                                                    profile.id,
                                                    database.name,
                                                    table.name,
                                                  )
                                                  void openTableTab(
                                                    'data',
                                                    profile.id,
                                                    database.name,
                                                    table.name,
                                                  )
                                                }}
                                                onContextMenu={(event) => {
                                                  event.preventDefault()
                                                  event.stopPropagation()
                                                  selectTable(
                                                    profile.id,
                                                    database.name,
                                                    table.name,
                                                  )
                                                  setTreeContextMenu({
                                                    kind: 'table',
                                                    x: Math.min(
                                                      event.clientX,
                                                      window.innerWidth - 188,
                                                    ),
                                                    y: Math.min(
                                                      event.clientY,
                                                      window.innerHeight - 220,
                                                    ),
                                                    profile_id: profile.id,
                                                    database_name: database.name,
                                                    table_name: table.name,
                                                  })
                                                }}
                                              >
                                                <TreeTableGlyph />
                                                <span className="tree-node-label">
                                                  {table.name}
                                                </span>
                                              </button>
                                            ))}
                                          </div>
                                        ) : null}
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            </>
            ) : activeSection === 'data_compare' ? (
              <div />
            ) : activeSection === 'structure_compare' ? (
              <div />
            ) : (
              <CompareSidebar
                title="对比记录"
                subtitle="本地保存的结构对比和数据对比记录，可用于回看统计与涉及表。"
              >
                <div className="compare-history-tabs">
                  <button
                    className={`flat-button ${compareHistoryType === 'data' ? 'primary' : ''}`}
                    type="button"
                    onClick={() => setCompareHistoryType('data')}
                  >
                    数据对比
                  </button>
                  <button
                    className={`flat-button ${compareHistoryType === 'structure' ? 'primary' : ''}`}
                    type="button"
                    onClick={() => setCompareHistoryType('structure')}
                  >
                    结构对比
                  </button>
                </div>
                <div className="compare-summary-list">
                  <span>记录数 {visibleHistoryItems.length}</span>
                  <span>当前筛选 {compareHistoryType === 'data' ? '数据对比' : '结构对比'}</span>
                </div>
              </CompareSidebar>
            )}
          </aside>

          <section className="content-pane">
            {activeSection === 'datasource' ? (
            <>
            <div className="tab-bar">
              {tabs.map((tab) => (
                <button
                  className={`tab-item ${activeTabId === tab.id ? 'active' : ''}`}
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <span>{tab.title}</span>
                  <small>{tab.subtitle}</small>
                  <span
                    className="tab-close"
                    onClick={(event) => {
                      event.stopPropagation()
                      removeTab(tab.id)
                    }}
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>

            <div className="content-panel">
              {activeTab?.kind === 'profile' ? (
                <ProfileEditorView
                  tab={activeTab}
                  dataSourceGroups={dataSourceGroups}
                  onFieldChange={updateProfileTabField}
                  onToggleGroupManager={toggleProfileGroupManager}
                  onCreateGroupNameChange={updateProfileGroupCreateName}
                  onCreateGroup={createProfileGroupFromTab}
                  onStartRenameGroup={startRenameProfileGroup}
                  onCancelRenameGroup={cancelRenameProfileGroup}
                  onEditingGroupNameChange={updateProfileEditingGroupName}
                  onRenameGroup={renameProfileGroupFromTab}
                  onDeleteGroup={deleteProfileGroupFromTab}
                  onImportNavicat={() => void importNavicatProfiles()}
                  onSave={saveProfileTab}
                  onTest={testProfileTab}
                  onDelete={deleteProfileFromTab}
                />
              ) : null}

              {activeTab?.kind === 'design' ? (
                <DesignEditorView
                  tab={activeTab}
                  onRefresh={() =>
                    void refreshDesignTab(
                      activeTab.id,
                      activeTab.profile_id,
                      activeTab.database_name,
                      activeTab.table_name,
                    )
                  }
                  onAddColumn={() => addDesignRow(activeTab.id)}
                  onDeleteColumns={() => deleteSelectedDesignRows(activeTab.id)}
                  onRestoreColumns={() => restoreSelectedDesignRows(activeTab.id)}
                  onPreview={() => void previewDesignSql(activeTab)}
                  onCommit={() => void commitDesignChanges(activeTab)}
                  onToggleAll={(checked) => toggleAllDesignRows(activeTab.id, checked)}
                  onToggleOne={(clientId, checked) =>
                    toggleDesignRowSelection(activeTab.id, clientId, checked)
                  }
                  onTableNameChange={updateDesignDraftTableName}
                  onChange={updateDesignRow}
                />
              ) : null}

              {activeTab?.kind === 'data' ? (
                <DataEditorView
                  tab={activeTab}
                  onRefresh={() =>
                    void refreshDataTab(
                      activeTab.id,
                      activeTab.profile_id,
                      activeTab.database_name,
                      activeTab.table_name,
                      activeTab.data.where_clause,
                      activeTab.data.order_by_clause,
                      activeTab.data.offset,
                      activeTab.data.limit,
                    )
                  }
                  onAddRow={() => addDataRow(activeTab.id)}
                  onDeleteRows={() => deleteSelectedDataRows(activeTab.id)}
                  onRestoreRows={() => restoreSelectedDataRows(activeTab.id)}
                  onCommit={() => void commitDataChanges(activeTab)}
                  onApplyFilter={() =>
                    void refreshDataTab(
                      activeTab.id,
                      activeTab.profile_id,
                      activeTab.database_name,
                      activeTab.table_name,
                      activeTab.data.where_clause,
                      activeTab.data.order_by_clause,
                      0,
                      activeTab.data.limit,
                    )
                  }
                  onFirstPage={() => void changeDataPage(activeTab, 'first')}
                  onPrevPage={() => void changeDataPage(activeTab, 'prev')}
                  onNextPage={() => void changeDataPage(activeTab, 'next')}
                  onLastPage={() => void changeDataPage(activeTab, 'last')}
                  onQueryFieldChange={updateDataQueryField}
                  onSelectRowsRange={(startClientId, endClientId, options) =>
                    selectDataRowsRange(activeTab.id, startClientId, endClientId, options)
                  }
                  onValueChange={updateDataRow}
                />
              ) : null}

              {activeTab?.kind === 'console' ? (
                <ConsoleView
                  tab={activeTab}
                  databaseOptions={databasesByProfile[activeTab.profile_id] ?? []}
                  schemaTables={activeConsoleAutocomplete?.tables ?? []}
                  schemaCatalog={activeConsoleSchemas}
                  onResolveSchema={(databaseName) =>
                    ensureSqlAutocompleteLoaded(activeTab.profile_id, databaseName, {
                      silent: true,
                    })
                  }
                  onDatabaseChange={updateConsoleDatabase}
                  onFormat={formatConsoleSql}
                  onSqlChange={updateConsoleSql}
                  onExecute={() => void runConsoleSql(activeTab, 0)}
                  onFirstPage={() => void changeConsolePage(activeTab, 'first')}
                  onPrevPage={() => void changeConsolePage(activeTab, 'prev')}
                  onNextPage={() => void changeConsolePage(activeTab, 'next')}
                  onLastPage={() => void changeConsolePage(activeTab, 'last')}
                />
              ) : null}

              {!activeTab ? <EmptyWorkspace /> : null}
            </div>

            {outputVisible ? (
              <OutputDock
                logs={outputLogs}
                outputBodyRef={outputBodyRef}
                onClear={() => setOutputLogs([])}
              />
            ) : null}
            </>
            ) : activeSection === 'data_compare' ? (
              <DataCompareWorkspace
                state={dataCompareState}
                compareForm={compareForm}
                profiles={profiles}
                compareHistoryItems={compareHistoryItems}
                databasesByProfile={databasesByProfile}
                nodeLoading={nodeLoading}
                profileConnectionState={profileConnectionState}
                filteredTables={filteredDataCompareTables}
                onSourceProfileChange={(value) => void updateCompareProfile('source', value)}
                onSourceDatabaseChange={(value) => updateCompareDatabase('source', value)}
                onTargetProfileChange={(value) => void updateCompareProfile('target', value)}
                onTargetDatabaseChange={(value) => updateCompareDatabase('target', value)}
                onDiscover={() => void discoverCompareTables()}
                onBackToSourceStep={() => setDataCompareStep(1)}
                onTableFilterChange={updateDataCompareTableFilter}
                onTableToggle={toggleDataCompareTable}
                onSelectAllTables={selectAllDataCompareTables}
                onClearAllTables={clearAllDataCompareTables}
                onRunCompare={() => void runDataCompareFlow()}
                onExportSql={() => void exportSelectedDataCompareSql()}
                onCancelCompare={() => void cancelRunningDataCompare()}
                onResultTablePick={selectDataCompareResultTable}
                onDetailTypeChange={switchDataCompareDetailType}
                onResultTableToggle={toggleDataCompareResultTableSelection}
                onResultActionToggle={toggleDataCompareResultActionSelection}
                onDetailToggle={toggleDataCompareDetailSelection}
                onLoadMoreDetail={() =>
                  void ensureDataCompareDetailLoaded(
                    dataCompareState.active_table_key,
                    dataCompareState.active_detail_type,
                    dataCompareState.current_request,
                    false,
                  )
                }
              />
            ) : activeSection === 'structure_compare' ? (
              <StructureCompareWorkspace
                state={structureCompareState}
                compareForm={compareForm}
                profiles={profiles}
                compareHistoryItems={compareHistoryItems}
                databasesByProfile={databasesByProfile}
                nodeLoading={nodeLoading}
                profileConnectionState={profileConnectionState}
                onSourceProfileChange={(value) => void updateCompareProfile('source', value)}
                onSourceDatabaseChange={(value) => updateCompareDatabase('source', value)}
                onTargetProfileChange={(value) => void updateCompareProfile('target', value)}
                onTargetDatabaseChange={(value) => updateCompareDatabase('target', value)}
                onRunCompare={() => void runStructureCompareFlow()}
                onBackToSourceStep={() => setStructureCompareStep(1)}
                onGoToSummaryStep={() => setStructureCompareStep(3)}
                onBackToDiffStep={() => setStructureCompareStep(2)}
                detailConcurrencyInput={structureDetailConcurrencyInput}
                onDetailConcurrencyInputChange={setStructureDetailConcurrencyInput}
                onExportSql={() => void exportSelectedStructureCompareSql()}
                onCategoryChange={(category) =>
                  setStructureCompareState((previous) => ({
                    ...previous,
                    active_category: category,
                  }))
                }
                onCategoryToggle={toggleStructureCategorySelection}
                onTableToggle={toggleStructureTableSelection}
                onDetailToggle={(category, tableName, forceReload) =>
                  void toggleStructureDetail(
                    category,
                    tableName,
                    structureCompareState.current_request,
                    forceReload,
                  )
                }
              />
            ) : (
              <CompareHistoryWorkspace
                historyItems={visibleHistoryItems}
                selectedHistoryItem={selectedHistoryItem}
                historyType={compareHistoryType}
                onSelect={(historyId) => setSelectedHistoryId(historyId)}
              />
            )}
          </section>
        </div>
      </section>

      {ddlDialog ? (
        <Modal
          title={ddlDialog.title}
          subtitle="当前表的 CREATE TABLE 语句"
          onClose={() => setDdlDialog(null)}
          actions={
            <button className="flat-button primary" type="button" onClick={() => setDdlDialog(null)}>
              关闭
            </button>
          }
        >
          <pre className="code-block">{ddlDialog.ddl}</pre>
        </Modal>
      ) : null}

      {sqlPreview ? (
        <Modal
          title={sqlPreview.title}
          subtitle="提交前请确认待执行 SQL"
          onClose={() => {
            if (!sqlPreview.busy) {
              setSqlPreview(null)
            }
          }}
          actions={
            <>
              <button
                className="flat-button"
                disabled={sqlPreview.busy}
                type="button"
                onClick={() => setSqlPreview(null)}
              >
                取消
              </button>
              {sqlPreview.confirm_label && sqlPreview.on_confirm ? (
                <button
                  className="flat-button primary"
                  disabled={sqlPreview.busy}
                  type="button"
                  onClick={() => void sqlPreview.on_confirm?.()}
                >
                  {sqlPreview.busy ? '处理中...' : sqlPreview.confirm_label}
                </button>
              ) : null}
            </>
          }
        >
          <pre className="code-block">{sqlPreview.statements.join('\n\n')}</pre>
        </Modal>
      ) : null}

      {createDatabaseDialog ? (
        <Modal
          title="新增数据库"
          subtitle={`当前数据源：${createDatabaseDialog.data_source_name}`}
          onClose={() => {
            if (!createDatabaseDialog.busy) {
              setCreateDatabaseDialog(null)
            }
          }}
          actions={
            <>
              <button
                className="flat-button"
                disabled={createDatabaseDialog.busy}
                type="button"
                onClick={() => setCreateDatabaseDialog(null)}
              >
                取消
              </button>
              <button
                className="flat-button primary"
                disabled={createDatabaseDialog.busy}
                type="button"
                onClick={() => void saveCreateDatabaseDialog()}
              >
                {createDatabaseDialog.busy ? '创建中...' : '确认创建'}
              </button>
            </>
          }
        >
          <div className="form-card compact-form-card">
            <label className="form-item">
              <span>数据库名</span>
              <input
                autoFocus
                value={createDatabaseDialog.form.database_name}
                onChange={(event) => updateCreateDatabaseField(event.target.value)}
                placeholder="请输入数据库名"
              />
            </label>
          </div>
        </Modal>
      ) : null}

      {confirmDialog ? (
        <Modal
          title={confirmDialog.title}
          subtitle={confirmDialog.body}
          onClose={() => {
            if (!confirmDialog.busy) {
              setConfirmDialog(null)
            }
          }}
          actions={
            <>
              <button
                className="flat-button"
                disabled={confirmDialog.busy}
                type="button"
                onClick={() => setConfirmDialog(null)}
              >
                取消
              </button>
              <button
                className="flat-button primary"
                disabled={confirmDialog.busy}
                type="button"
                onClick={() => void confirmDialog.on_confirm()}
              >
                {confirmDialog.busy ? '处理中...' : confirmDialog.confirm_label}
              </button>
            </>
          }
        >
          <div className="status-panel">{confirmDialog.body}</div>
        </Modal>
      ) : null}

      {treeContextMenu ? (
        <div
          className="context-menu"
          role="menu"
          style={{ left: treeContextMenu.x, top: treeContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {treeContextMenu.kind === 'profile' ? (
            <button
              className="context-menu-item"
              type="button"
              onClick={() => {
                openCreateDatabaseDialog(treeContextMenu.profile_id)
                setTreeContextMenu(null)
              }}
            >
              新增数据库
            </button>
          ) : null}

          {treeContextMenu.kind === 'database' ? (
            <button
              className="context-menu-item"
              type="button"
              onClick={() => {
                openCreateTableTab(
                  treeContextMenu.profile_id,
                  treeContextMenu.database_name,
                )
                setTreeContextMenu(null)
              }}
            >
              新增表
            </button>
          ) : null}

          {treeContextMenu.kind === 'table' ? (
            <>
              <button
                className="context-menu-item"
                type="button"
                onClick={() => {
                  void openTableTab(
                    'data',
                    treeContextMenu.profile_id,
                    treeContextMenu.database_name,
                    treeContextMenu.table_name,
                  )
                  setTreeContextMenu(null)
                }}
              >
                修改表数据
              </button>
              <button
                className="context-menu-item"
                type="button"
                onClick={() => {
                  void openTableTab(
                    'design',
                    treeContextMenu.profile_id,
                    treeContextMenu.database_name,
                    treeContextMenu.table_name,
                  )
                  setTreeContextMenu(null)
                }}
              >
                修改表结构
              </button>
              <button
                className="context-menu-item"
                type="button"
                onClick={() => {
                  void openTableDdl(
                    treeContextMenu.profile_id,
                    treeContextMenu.database_name,
                    treeContextMenu.table_name,
                  )
                  setTreeContextMenu(null)
                }}
              >
                查看 DDL
              </button>
              <button
                className="context-menu-item"
                type="button"
                onClick={() => {
                  confirmUnimplementedAction(
                    '复制表',
                    `确认复制表 ${treeContextMenu.database_name}.${treeContextMenu.table_name} 吗？`,
                  )
                  setTreeContextMenu(null)
                }}
              >
                复制表
              </button>
              <button
                className="context-menu-item"
                type="button"
                onClick={() => {
                  pushToast('该功能暂未开发', 'info')
                  setTreeContextMenu(null)
                }}
              >
                导出表
              </button>
              <button
                className="context-menu-item danger"
                type="button"
                onClick={() => {
                  confirmUnimplementedAction(
                    '删除表',
                    `确认删除表 ${treeContextMenu.database_name}.${treeContextMenu.table_name} 吗？`,
                  )
                  setTreeContextMenu(null)
                }}
              >
                删除表
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div className={`toast toast-${toast.tone}`} key={toast.id}>
            {toast.message}
          </div>
        ))}
      </div>
    </main>
  )
}

function ProfileEditorView({
  tab,
  dataSourceGroups,
  onFieldChange,
  onToggleGroupManager,
  onCreateGroupNameChange,
  onCreateGroup,
  onStartRenameGroup,
  onCancelRenameGroup,
  onEditingGroupNameChange,
  onRenameGroup,
  onDeleteGroup,
  onImportNavicat,
  onSave,
  onTest,
  onDelete,
}: {
  tab: ProfileTab
  dataSourceGroups: DataSourceGroup[]
  onFieldChange: (
    tabId: string,
    field: keyof SaveConnectionProfilePayload,
    value: string | number | null,
  ) => void
  onToggleGroupManager: (tabId: string) => void
  onCreateGroupNameChange: (tabId: string, value: string) => void
  onCreateGroup: (tab: ProfileTab) => Promise<void>
  onStartRenameGroup: (tabId: string, group: DataSourceGroup) => void
  onCancelRenameGroup: (tabId: string) => void
  onEditingGroupNameChange: (tabId: string, value: string) => void
  onRenameGroup: (tab: ProfileTab) => Promise<void>
  onDeleteGroup: (tab: ProfileTab, group: DataSourceGroup) => Promise<void>
  onImportNavicat: () => void
  onSave: (tab: ProfileTab) => Promise<void>
  onTest: (tab: ProfileTab) => Promise<void>
  onDelete: (tab: ProfileTab) => Promise<void>
}) {
  return (
    <div className="editor-page">
      <div className="editor-header">
        <div>
          <strong>{tab.editor.mode === 'create' ? '新增数据源' : '编辑数据源'}</strong>
          <p>
            在这里直接选择分组或维护分组目录。整个结构为：分组 - 数据源 -
            数据库 - 表。
          </p>
        </div>

        <div className="editor-actions">
          {tab.editor.mode === 'create' ? (
            <button className="flat-button" type="button" onClick={onImportNavicat}>
              导入 Navicat
            </button>
          ) : null}
          {tab.editor.mode === 'edit' ? (
            <button className="flat-button danger" type="button" onClick={() => void onDelete(tab)}>
              删除
            </button>
          ) : null}
          <button
            className="flat-button"
            disabled={tab.editor.testing || tab.editor.saving}
            type="button"
            onClick={() => void onTest(tab)}
          >
            {tab.editor.testing ? '测试中...' : '测试连接'}
          </button>
          <button
            className="flat-button primary"
            disabled={tab.editor.testing || tab.editor.saving}
            type="button"
            onClick={() => void onSave(tab)}
          >
            {tab.editor.saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      <div className="form-card">
        <div className="form-grid">
          <div className="form-item form-item-span-2">
            <span>所属分组</span>
            <div className="group-select-row">
              <select
                value={tab.editor.form.group_name ?? ''}
                onChange={(event) =>
                  onFieldChange(tab.id, 'group_name', event.target.value || null)
                }
              >
                <option value="">未分组</option>
                {dataSourceGroups.map((group) => (
                  <option key={group.id} value={group.group_name}>
                    {group.group_name}
                  </option>
                ))}
              </select>
              <button
                className="flat-button"
                disabled={tab.editor.group_busy}
                type="button"
                onClick={() => onToggleGroupManager(tab.id)}
              >
                {tab.editor.group_manager_open ? '收起分组维护' : '维护分组'}
              </button>
            </div>
            <small className="form-hint">
              新增数据源时可直接下拉选组；没有合适分组时，在这里新增即可。
            </small>
          </div>

          <label className="form-item">
            <span>数据源名称</span>
            <input
              value={tab.editor.form.data_source_name}
              onChange={(event) =>
                onFieldChange(tab.id, 'data_source_name', event.target.value)
              }
              placeholder="例如：采购生产库"
            />
          </label>

          <label className="form-item">
            <span>主机</span>
            <input
              value={tab.editor.form.host}
              onChange={(event) => onFieldChange(tab.id, 'host', event.target.value)}
              placeholder="例如：10.20.8.12"
            />
          </label>

          <label className="form-item">
            <span>端口</span>
            <input
              inputMode="numeric"
              value={tab.editor.form.port}
              onChange={(event) =>
                onFieldChange(
                  tab.id,
                  'port',
                  Number.parseInt(event.target.value || '3306', 10),
                )
              }
              placeholder="3306"
            />
          </label>

          <label className="form-item">
            <span>用户名</span>
            <input
              value={tab.editor.form.username}
              onChange={(event) => onFieldChange(tab.id, 'username', event.target.value)}
              placeholder="root"
            />
          </label>

          <label className="form-item">
            <span>密码</span>
            <input
              type="password"
              value={tab.editor.form.password}
              onChange={(event) => onFieldChange(tab.id, 'password', event.target.value)}
              placeholder="请输入密码"
            />
          </label>
        </div>

        {tab.editor.group_manager_open ? (
          <div className="group-manager-card">
            <div className="group-manager-header">
              <div>
                <strong>分组维护</strong>
                <p>删除分组后，已有数据源会自动回到“未分组”。</p>
              </div>
            </div>

            <div className="group-manager-create">
              <input
                value={tab.editor.create_group_name}
                onChange={(event) => onCreateGroupNameChange(tab.id, event.target.value)}
                placeholder="输入新的分组名称"
              />
              <button
                className="flat-button primary"
                disabled={tab.editor.group_busy}
                type="button"
                onClick={() => void onCreateGroup(tab)}
              >
                {tab.editor.group_busy ? '处理中...' : '新增分组'}
              </button>
            </div>

            <div className="group-manager-list">
              {dataSourceGroups.length === 0 ? (
                <div className="group-manager-empty">
                  暂无分组，新增后即可在上方下拉框中选择。
                </div>
              ) : (
                dataSourceGroups.map((group) => {
                  const editing = tab.editor.editing_group_id === group.id
                  return (
                    <div className="group-manager-row" key={group.id}>
                      {editing ? (
                        <>
                          <input
                            value={tab.editor.editing_group_name}
                            onChange={(event) =>
                              onEditingGroupNameChange(tab.id, event.target.value)
                            }
                            placeholder="请输入分组名称"
                          />
                          <button
                            className="flat-button primary"
                            disabled={tab.editor.group_busy}
                            type="button"
                            onClick={() => void onRenameGroup(tab)}
                          >
                            保存
                          </button>
                          <button
                            className="flat-button"
                            disabled={tab.editor.group_busy}
                            type="button"
                            onClick={() => onCancelRenameGroup(tab.id)}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="group-manager-name">{group.group_name}</div>
                          <div className="group-manager-actions">
                            <button
                              className="flat-button"
                              disabled={tab.editor.group_busy}
                              type="button"
                              onClick={() => onStartRenameGroup(tab.id, group)}
                            >
                              重命名
                            </button>
                            <button
                              className="flat-button danger"
                              disabled={tab.editor.group_busy}
                              type="button"
                              onClick={() => void onDeleteGroup(tab, group)}
                            >
                              删除
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ) : null}

        {tab.editor.test_result ? (
          <div className="status-panel">{tab.editor.test_result}</div>
        ) : null}
      </div>
    </div>
  )
}

function DesignEditorView({
  tab,
  onRefresh,
  onAddColumn,
  onDeleteColumns,
  onRestoreColumns,
  onPreview,
  onCommit,
  onToggleAll,
  onToggleOne,
  onTableNameChange,
  onChange,
}: {
  tab: DesignTab
  onRefresh: () => void
  onAddColumn: () => void
  onDeleteColumns: () => void
  onRestoreColumns: () => void
  onPreview: () => void
  onCommit: () => void
  onToggleAll: (checked: boolean) => void
  onToggleOne: (clientId: string, checked: boolean) => void
  onTableNameChange: (tabId: string, value: string) => void
  onChange: (
    tabId: string,
    clientId: string,
    field: keyof TableColumn,
    value: string | boolean | number | null,
  ) => void
}) {
  return (
    <div className="editor-page">
      <div className="editor-header">
        <div>
          <strong>{tab.title}</strong>
          <p>
            {tab.design.mode === 'create'
              ? '新建表会按当前字段定义生成 CREATE TABLE 语句。'
              : '表结构编辑页。仅覆盖原型中的字段定义维度，不扩展索引与外键面板。'}
          </p>
        </div>

        <div className="editor-actions">
          {tab.design.mode === 'edit' ? (
            <button className="flat-button" type="button" onClick={onRefresh}>
              刷新
            </button>
          ) : null}
          <button className="flat-button" type="button" onClick={onAddColumn}>
            新增字段
          </button>
          <button className="flat-button" type="button" onClick={onDeleteColumns}>
            删除字段
          </button>
          <button className="flat-button" type="button" onClick={onRestoreColumns}>
            恢复所选
          </button>
          <button className="flat-button" type="button" onClick={onPreview}>
            预览 SQL
          </button>
          <button className="flat-button primary" type="button" onClick={onCommit}>
            {tab.design.mode === 'create' ? '创建表' : '提交'}
          </button>
        </div>
      </div>

      {tab.design.mode === 'create' ? (
        <div className="form-card compact-form-card">
          <label className="form-item">
            <span>表名</span>
            <input
              value={tab.design.draft_table_name}
              onChange={(event) => onTableNameChange(tab.id, event.target.value)}
              placeholder="请输入新表名称"
            />
          </label>
        </div>
      ) : null}

      {tab.design.error ? (
        <EmptyNotice title="读取表结构失败" text={tab.design.error} />
      ) : null}

      <div className="grid-shell">
        <div className="grid-head structure-grid">
          <label className="grid-cell center-cell">
            <input
              type="checkbox"
              checked={
                tab.design.draft_columns.length > 0 &&
                tab.design.draft_columns.every((column) => column.selected)
              }
              onChange={(event) => onToggleAll(event.target.checked)}
            />
          </label>
          <div className="grid-cell">字段名</div>
          <div className="grid-cell">类型</div>
          <div className="grid-cell">长度</div>
          <div className="grid-cell">小数位</div>
          <div className="grid-cell center-cell">允许空</div>
          <div className="grid-cell center-cell">主键</div>
          <div className="grid-cell center-cell">自增</div>
          <div className="grid-cell">默认值</div>
          <div className="grid-cell">注释</div>
        </div>

        <div className="grid-body">
          {tab.design.draft_columns.map((column) => (
            <div className="grid-row structure-grid" key={column.client_id}>
              <label className="grid-cell center-cell">
                <input
                  type="checkbox"
                  checked={column.selected}
                  onChange={(event) =>
                    onToggleOne(column.client_id, event.target.checked)
                  }
                />
              </label>

              <div className="grid-cell">
                <input
                  className="cell-input"
                  value={column.name}
                  onChange={(event) =>
                    onChange(tab.id, column.client_id, 'name', event.target.value)
                  }
                />
              </div>

              <div className="grid-cell">
                <select
                  className="cell-input"
                  value={column.data_type}
                  onChange={(event) =>
                    onChange(tab.id, column.client_id, 'data_type', event.target.value)
                  }
                >
                  {commonDataTypes.map((dataType) => (
                    <option key={dataType} value={dataType}>
                      {dataType}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid-cell">
                <input
                  className="cell-input"
                  inputMode="numeric"
                  value={column.length ?? ''}
                  onChange={(event) =>
                    onChange(
                      tab.id,
                      column.client_id,
                      'length',
                      parseOptionalNumber(event.target.value),
                    )
                  }
                />
              </div>

              <div className="grid-cell">
                <input
                  className="cell-input"
                  inputMode="numeric"
                  value={column.scale ?? ''}
                  onChange={(event) =>
                    onChange(
                      tab.id,
                      column.client_id,
                      'scale',
                      parseOptionalNumber(event.target.value),
                    )
                  }
                />
              </div>

              <label className="grid-cell center-cell">
                <input
                  type="checkbox"
                  checked={column.nullable}
                  onChange={(event) =>
                    onChange(tab.id, column.client_id, 'nullable', event.target.checked)
                  }
                />
              </label>

              <label className="grid-cell center-cell">
                <input
                  type="checkbox"
                  checked={column.primary_key}
                  onChange={(event) =>
                    onChange(tab.id, column.client_id, 'primary_key', event.target.checked)
                  }
                />
              </label>

              <label className="grid-cell center-cell">
                <input
                  type="checkbox"
                  checked={column.auto_increment}
                  onChange={(event) =>
                    onChange(
                      tab.id,
                      column.client_id,
                      'auto_increment',
                      event.target.checked,
                    )
                  }
                />
              </label>

              <div className="grid-cell">
                <input
                  className="cell-input"
                  value={column.default_value ?? ''}
                  onChange={(event) =>
                    onChange(
                      tab.id,
                      column.client_id,
                      'default_value',
                      event.target.value || null,
                    )
                  }
                />
              </div>

              <div className="grid-cell">
                <input
                  className="cell-input"
                  value={column.comment}
                  onChange={(event) =>
                    onChange(tab.id, column.client_id, 'comment', event.target.value)
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <footer className="page-footer">
        <span>{tab.design.draft_columns.length} 个字段</span>
      </footer>
    </div>
  )
}

function DataEditorView({
  tab,
  onRefresh,
  onAddRow,
  onDeleteRows,
  onRestoreRows,
  onCommit,
  onApplyFilter,
  onFirstPage,
  onPrevPage,
  onNextPage,
  onLastPage,
  onQueryFieldChange,
  onSelectRowsRange,
  onValueChange,
}: {
  tab: DataTab
  onRefresh: () => void
  onAddRow: () => void
  onDeleteRows: () => void
  onRestoreRows: () => void
  onCommit: () => void
  onApplyFilter: () => void
  onFirstPage: () => void
  onPrevPage: () => void
  onNextPage: () => void
  onLastPage: () => void
  onQueryFieldChange: (
    tabId: string,
    field: 'where_clause' | 'order_by_clause' | 'transaction_mode',
    value: string,
  ) => void
  onSelectRowsRange: (
    startClientId: string,
    endClientId: string,
    options?: { append?: boolean },
  ) => void
  onValueChange: (
    tabId: string,
    clientId: string,
    columnName: string,
    value: CellValue,
  ) => void
}) {
  const rangeStart = tab.data.rows.length === 0 ? 0 : tab.data.offset + 1
  const rangeEnd =
    tab.data.rows.length === 0
      ? 0
      : Math.min(tab.data.offset + tab.data.rows.length, tab.data.total_rows)
  const atFirstPage = tab.data.offset <= 0 || tab.data.total_rows === 0
  const atLastPage = tab.data.row_count_exact
    ? rangeEnd >= tab.data.total_rows
    : tab.data.rows.length < tab.data.limit
  const totalRowsLabel = formatTotalRowsLabel(tab.data.total_rows, tab.data.row_count_exact)
  const hasPendingDataChanges = hasPendingDataMutations(tab)
  const hasSelectedRowsForDelete = hasSelectedDataRowsForDelete(tab)
  const hasSelectedRowsForRestore = hasRestorableSelectedDataRows(tab)

  return (
    <div className="editor-page data-editor-page">
      <div className="data-control-stack">
        <div className="data-toolbar-row">
          <div className="editor-actions">
            <button className="flat-button" type="button" onClick={onRefresh}>
              刷新
            </button>
            <button
              className="flat-button"
              disabled={!tab.data.editable}
              type="button"
              onClick={onAddRow}
            >
              新增行
            </button>
            <button
              className="flat-button"
              disabled={!tab.data.editable || !hasSelectedRowsForDelete}
              type="button"
              onClick={onDeleteRows}
            >
              删除行
            </button>
            <button
              className="flat-button"
              disabled={!tab.data.editable || !hasSelectedRowsForRestore}
              type="button"
              onClick={onRestoreRows}
            >
              恢复所选
            </button>
            <button
              className="flat-button primary"
              disabled={!tab.data.editable || !hasPendingDataChanges}
              type="button"
              onClick={onCommit}
            >
              提交
            </button>
          </div>
        </div>

        <div className="inline-query-bar">
          <label className="inline-query-field">
            <span>WHERE</span>
            <SqlEditor
              editor_id={`${tab.id}:where`}
              mode="where"
              value={tab.data.where_clause}
              placeholder=""
              table_name={tab.table_name}
              table_columns={tab.data.columns}
              onChange={(value) => onQueryFieldChange(tab.id, 'where_clause', value)}
            />
          </label>

          <label className="inline-query-field">
            <span>ORDER BY</span>
            <SqlEditor
              editor_id={`${tab.id}:order_by`}
              mode="order_by"
              value={tab.data.order_by_clause}
              placeholder=""
              table_name={tab.table_name}
              table_columns={tab.data.columns}
              onChange={(value) => onQueryFieldChange(tab.id, 'order_by_clause', value)}
            />
          </label>

          <button className="flat-button primary" type="button" onClick={onApplyFilter}>
            应用条件
          </button>
        </div>
      </div>

      {!tab.data.editable ? (
        <div className="status-panel warning">
          当前表没有主键。为了避免误更新，本轮只提供只读浏览，不开放直接提交。
        </div>
      ) : null}

      {tab.data.error ? <EmptyNotice title="读取表数据失败" text={tab.data.error} /> : null}

      <div className="grid-shell data-grid-shell">
        <DataGridTable
          columns={tab.data.columns}
          editable={tab.data.editable}
          rows={tab.data.rows}
          rowNumberOffset={tab.data.offset}
          onSelectRowsRange={onSelectRowsRange}
          onValueChange={(clientId, columnName, value) =>
            onValueChange(tab.id, clientId, columnName, value)
          }
        />
      </div>

      <footer className="page-footer">
        <span className="page-footer-meta">
          已加载 {tab.data.rows.length} 行，{tab.data.row_count_exact ? '共' : '至少'}{' '}
          {tab.data.total_rows} 行
        </span>
        <div className="page-footer-center">
          <div className="pager-shell">
            <button
              className="pager-button"
              disabled={tab.data.loading || atFirstPage}
              type="button"
              onClick={onFirstPage}
            >
              |&lt;
            </button>
            <button
              className="pager-button"
              disabled={tab.data.loading || atFirstPage}
              type="button"
              onClick={onPrevPage}
            >
              &lt;
            </button>
            <span className="pager-range">
              {rangeStart}-{rangeEnd} / {totalRowsLabel}
            </span>
            <button
              className="pager-button"
              disabled={tab.data.loading || atLastPage}
              type="button"
              onClick={onNextPage}
            >
              &gt;
            </button>
            <button
              className="pager-button"
              disabled={tab.data.loading || !tab.data.row_count_exact || atLastPage}
              type="button"
              onClick={onLastPage}
            >
              &gt;|
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

function DataGridTable({
  columns,
  rows,
  editable,
  rowNumberOffset,
  onSelectRowsRange,
  onValueChange,
}: {
  columns: TableDataColumn[]
  rows: DataGridRow[]
  editable: boolean
  rowNumberOffset?: number
  onSelectRowsRange?: (
    startClientId: string,
    endClientId: string,
    options?: { append?: boolean },
  ) => void
  onValueChange?: (clientId: string, columnName: string, value: CellValue) => void
}) {
  const selectionAnchorRef = useRef<string | null>(null)
  const dragSelectionRef = useRef<{
    startClientId: string
    append: boolean
    lastClientId: string
  } | null>(null)

  useEffect(() => {
    const handleMouseUp = () => {
      if (dragSelectionRef.current) {
        selectionAnchorRef.current = dragSelectionRef.current.lastClientId
      }
      dragSelectionRef.current = null
    }

    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [])

  return (
    <div className="data-grid-viewport">
      <table className="data-table">
        <colgroup>
          <col style={{ width: '56px' }} />
          {columns.map((column) => (
            <col key={`col-${column.name}`} style={{ width: '240px' }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="center-cell">#</th>
            {columns.map((column) => (
              <th key={column.name}>
                <span className="column-title">
                  {column.primary_key ? <strong>PK</strong> : null}
                  {column.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              className={`${row.selected ? 'selected' : ''} row-${row.state}`}
              key={row.client_id}
              onMouseEnter={() => {
                if (!dragSelectionRef.current) {
                  return
                }

                dragSelectionRef.current.lastClientId = row.client_id
                onSelectRowsRange?.(
                  dragSelectionRef.current.startClientId,
                  row.client_id,
                  { append: dragSelectionRef.current.append },
                )
              }}
            >
              <td
                className="center-cell row-selector-cell"
                onMouseDown={(event) => {
                  event.preventDefault()
                  const append = event.metaKey || event.ctrlKey
                  const startClientId =
                    event.shiftKey && selectionAnchorRef.current
                      ? selectionAnchorRef.current
                      : row.client_id
                  dragSelectionRef.current = {
                    startClientId,
                    append,
                    lastClientId: row.client_id,
                  }
                  if (!event.shiftKey || !selectionAnchorRef.current) {
                    selectionAnchorRef.current = row.client_id
                  }
                  onSelectRowsRange?.(startClientId, row.client_id, {
                    append,
                  })
                }}
              >
                {(rowNumberOffset ?? 0) + index + 1}
              </td>

              {columns.map((column) => (
                <td key={`${row.client_id}:${column.name}`}>
                  <input
                    className={`data-cell-input ${
                      row.values[column.name] == null ? 'is-null' : ''
                    }`}
                    disabled={!editable || row.state === 'deleted' || !onValueChange}
                    value={stringifyCellValue(row.values[column.name] ?? null)}
                    placeholder="NULL"
                    onChange={(event) =>
                      onValueChange?.(
                        row.client_id,
                        column.name,
                        parseCellValue(event.target.value, column),
                      )
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ConsoleView({
  tab,
  databaseOptions,
  schemaTables,
  schemaCatalog,
  onResolveSchema,
  onDatabaseChange,
  onFormat,
  onSqlChange,
  onExecute,
  onFirstPage,
  onPrevPage,
  onNextPage,
  onLastPage,
}: {
  tab: ConsoleTab
  databaseOptions: DatabaseEntry[]
  schemaTables: SqlAutocompleteSchema['tables']
  schemaCatalog: SqlAutocompleteSchema[]
  onResolveSchema: (databaseName: string) => Promise<SqlAutocompleteSchema | null>
  onDatabaseChange: (tabId: string, databaseName: string | null) => void
  onFormat: (tabId: string) => void
  onSqlChange: (tabId: string, value: string) => void
  onExecute: () => void
  onFirstPage: () => void
  onPrevPage: () => void
  onNextPage: () => void
  onLastPage: () => void
}) {
  const rangeStart = tab.console.rows.length === 0 ? 0 : tab.console.offset + 1
  const rangeEnd =
    tab.console.rows.length === 0
      ? 0
      : Math.min(tab.console.offset + tab.console.rows.length, tab.console.total_rows)
  const atFirstPage = tab.console.offset <= 0 || tab.console.total_rows === 0
  const atLastPage = tab.console.row_count_exact
    ? rangeEnd >= tab.console.total_rows
    : !tab.console.truncated
  const totalRowsLabel = formatTotalRowsLabel(
    tab.console.total_rows,
    tab.console.row_count_exact,
  )

  return (
    <div className="editor-page console-page">
      <div className="console-shell">
        <div className="console-toolbar">
          <div className="console-toolbar-left">
            <button
              className="console-action run"
              disabled={tab.console.loading}
              type="button"
              onClick={onExecute}
            >
              {tab.console.loading ? '运行中' : '运行'}
            </button>
            <button
              className="console-action"
              disabled={tab.console.loading || !tab.console.sql.trim()}
              type="button"
              onClick={() => onFormat(tab.id)}
            >
              格式化 SQL
            </button>
          </div>

          <div className="console-toolbar-right">
            <select
              className="console-database-select"
              value={tab.database_name ?? ''}
              disabled={tab.console.database_loading}
              onChange={(event) => onDatabaseChange(tab.id, event.target.value || null)}
            >
              <option value="">未指定</option>
              {databaseOptions.map((database) => (
                <option key={database.name} value={database.name}>
                  {database.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="console-editor">
          <SqlEditor
            editor_id={tab.id}
            mode="console"
            value={tab.console.sql}
            placeholder="请输入单条 SQL，当前控制台暂不支持一次执行多条语句"
            database_name={tab.database_name}
            schema_tables={schemaTables}
            schema_catalog={schemaCatalog}
            database_names={databaseOptions.map((database) => database.name)}
            onResolveSchema={onResolveSchema}
            onChange={(value) => onSqlChange(tab.id, value)}
            onExecute={onExecute}
          />
        </div>
      </div>

      {tab.console.error ? <EmptyNotice title="SQL 执行失败" text={tab.console.error} /> : null}

      <div className="grid-shell data-grid-shell">
        {tab.console.columns.length > 0 ? (
          <DataGridTable
            columns={tab.console.columns}
            editable={false}
            rows={tab.console.rows}
            rowNumberOffset={tab.console.offset}
          />
        ) : (
          <div className="empty-notice inline-empty-notice">
            <strong>
              {tab.console.result_kind === 'mutation' ? '语句已执行' : '暂无查询结果'}
            </strong>
            <p>
              {tab.console.result_kind === 'mutation'
                ? `当前语句没有返回结果集，影响 ${tab.console.affected_rows} 行。`
                : '执行查询后，结果会在这里展示。'}
            </p>
          </div>
        )}
      </div>

      {tab.console.columns.length > 0 ? (
        <footer className="page-footer">
          <span className="page-footer-meta">
            已加载 {tab.console.rows.length} 行，{tab.console.row_count_exact ? '共' : '至少'}{' '}
            {tab.console.total_rows} 行
          </span>
          <div className="page-footer-center">
            <div className="pager-shell">
              <button
                className="pager-button"
                disabled={tab.console.loading || atFirstPage}
                type="button"
                onClick={onFirstPage}
              >
                |&lt;
              </button>
              <button
                className="pager-button"
                disabled={tab.console.loading || atFirstPage}
                type="button"
                onClick={onPrevPage}
              >
                &lt;
              </button>
              <span className="pager-range">
                {rangeStart}-{rangeEnd} / {totalRowsLabel}
              </span>
              <button
                className="pager-button"
                disabled={tab.console.loading || atLastPage}
                type="button"
                onClick={onNextPage}
              >
                &gt;
              </button>
              <button
                className="pager-button"
                disabled={tab.console.loading || !tab.console.row_count_exact || atLastPage}
                type="button"
                onClick={onLastPage}
              >
                &gt;|
              </button>
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  )
}

function formatTotalRowsLabel(totalRows: number, rowCountExact: boolean) {
  return rowCountExact ? `${totalRows}` : `至少 ${totalRows}`
}

function OutputDock({
  logs,
  outputBodyRef,
  onClear,
}: {
  logs: OutputLogEntry[]
  outputBodyRef: RefObject<HTMLDivElement | null>
  onClear: () => void
}) {
  return (
    <div className="output-dock">
      <div className="output-dock-header">
        <div className="output-dock-title">
          <strong>输出</strong>
          <span>{logs.length} 条记录</span>
        </div>
        <div className="editor-actions">
          <button className="flat-button" type="button" onClick={onClear}>
            清空
          </button>
        </div>
      </div>

      <div className="output-dock-body" ref={outputBodyRef}>
        {logs.length === 0 ? (
          <div className="output-empty">执行 SQL 或打开数据表后，这里会持续记录对应的 SQL 操作。</div>
        ) : (
          logs.map((log) => (
            <div className={`output-entry output-${log.tone}`} key={log.id}>
              <div className="output-entry-meta">
                <span>[{log.timestamp}]</span>
                <span>{log.scope}&gt;</span>
                <span>{log.message}</span>
              </div>
              {log.sql ? <pre className="output-entry-sql">{log.sql}</pre> : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function EmptyWorkspace() {
  return <div className="empty-workspace" />
}

function EmptyNotice({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-notice">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  )
}

function SquareIconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      className="icon-button"
      disabled={disabled}
      title={label}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function SquareActionButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active?: boolean
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`text-button ${active ? 'active' : ''}`}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function Modal({
  title,
  subtitle,
  children,
  actions,
  onClose,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
  onClose: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <strong>{title}</strong>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">{children}</div>
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>
  )
}

function CompareSidebar({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="compare-sidebar">
      <div className="pane-header compare-pane-header">
        <div className="pane-title compare-pane-title">
          <DatabaseGlyph />
          <strong>{title}</strong>
        </div>
        <p className="compare-pane-subtitle">{subtitle}</p>
      </div>
      <div className="tree-pane compare-pane-body">{children}</div>
    </div>
  )
}

type CompareSelectionOption = {
  value: string
  title: string
  subtitle?: string
  usage_count: number
  search_texts: string[]
}

function CompareSelectionDropdown({
  label,
  placeholder,
  searchPlaceholder,
  value,
  options,
  disabled = false,
  emptyText,
  onChange,
}: {
  label: string
  placeholder: string
  searchPlaceholder: string
  value: string
  options: CompareSelectionOption[]
  disabled?: boolean
  emptyText: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const shellRef = useRef<HTMLDivElement | null>(null)

  const selectedOption = options.find((option) => option.value === value) ?? null
  const filteredOptions = options.filter((option) =>
    matchCompareFormSearch(option.search_texts, query),
  )

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (shellRef.current && !shellRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (disabled) {
      setOpen(false)
    }
  }, [disabled])

  return (
    <div className="form-item">
      <span>{label}</span>
      <div
        ref={shellRef}
        className={`compare-select-shell ${open ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
      >
        <button
          className="compare-select-trigger"
          type="button"
          disabled={disabled}
          onClick={() => {
            if (disabled) {
              return
            }
            setOpen((current) => !current)
          }}
        >
          <div className="compare-select-trigger-copy">
            <strong className={selectedOption ? '' : 'placeholder'}>
              {selectedOption?.title ?? placeholder}
            </strong>
            {selectedOption?.subtitle ? <span>{selectedOption.subtitle}</span> : null}
          </div>
          <div className="compare-select-trigger-side">
            {selectedOption ? (
              <span className="compare-select-usage-badge">使用 {selectedOption.usage_count} 次</span>
            ) : null}
            <span className="compare-select-chevron" aria-hidden="true" />
          </div>
        </button>

        {open ? (
          <div className="compare-select-panel">
            <div className="compare-select-search">
              <input
                autoFocus
                placeholder={searchPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="compare-select-options">
              {filteredOptions.length ? (
                filteredOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`compare-select-option ${option.value === value ? 'selected' : ''}`}
                    type="button"
                    onClick={() => {
                      onChange(option.value)
                      setOpen(false)
                      setQuery('')
                    }}
                  >
                    <div className="compare-select-option-copy">
                      <strong>{option.title}</strong>
                      {option.subtitle ? <span>{option.subtitle}</span> : null}
                    </div>
                    <span className="compare-select-usage-badge">使用 {option.usage_count} 次</span>
                  </button>
                ))
              ) : (
                <div className="compare-select-empty">{emptyText}</div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function CompareConnectionForm({
  compareForm,
  profiles,
  compareHistoryItems,
  databasesByProfile,
  nodeLoading,
  profileConnectionState,
  onSourceProfileChange,
  onSourceDatabaseChange,
  onTargetProfileChange,
  onTargetDatabaseChange,
}: {
  compareForm: CompareFormState
  profiles: ConnectionProfile[]
  compareHistoryItems: CompareHistoryItem[]
  databasesByProfile: Record<string, DatabaseEntry[]>
  nodeLoading: Record<string, boolean>
  profileConnectionState: Record<string, 'idle' | 'connected' | 'error'>
  onSourceProfileChange: (value: string) => void
  onSourceDatabaseChange: (value: string) => void
  onTargetProfileChange: (value: string) => void
  onTargetDatabaseChange: (value: string) => void
}) {
  const sortedProfiles = sortCompareProfilesForSelection(profiles, compareHistoryItems)
  const sourceProfileOptions = sortedProfiles.map((profile) => ({
    value: profile.id,
    title: profile.data_source_name,
    subtitle: [profile.group_name, profile.host, profile.username].filter(Boolean).join(' · '),
    usage_count: getProfileCompareUsageCount(profile.id, compareHistoryItems),
    search_texts: [
      profile.data_source_name,
      profile.group_name ?? '',
      profile.host,
      profile.username,
    ],
  }))
  const targetProfileOptions = sourceProfileOptions
  const sourceDatabases = sortCompareDatabasesForSelection(
    compareForm.source_profile_id,
    databasesByProfile[compareForm.source_profile_id] ?? [],
    compareHistoryItems,
  )
  const targetDatabases = sortCompareDatabasesForSelection(
    compareForm.target_profile_id,
    databasesByProfile[compareForm.target_profile_id] ?? [],
    compareHistoryItems,
  )
  const sourceDatabaseOptions = sourceDatabases.map((database) => ({
    value: database.name,
    title: database.name,
    usage_count: getDatabaseCompareUsageCount(
      compareForm.source_profile_id,
      database.name,
      compareHistoryItems,
    ),
    search_texts: [database.name],
  }))
  const targetDatabaseOptions = targetDatabases.map((database) => ({
    value: database.name,
    title: database.name,
    usage_count: getDatabaseCompareUsageCount(
      compareForm.target_profile_id,
      database.name,
      compareHistoryItems,
    ),
    search_texts: [database.name],
  }))

  const sourceLoading = Boolean(compareForm.source_profile_id) && Boolean(nodeLoading[compareForm.source_profile_id])
  const targetLoading = Boolean(compareForm.target_profile_id) && Boolean(nodeLoading[compareForm.target_profile_id])
  const sourceConnected = profileConnectionState[compareForm.source_profile_id] === 'connected'
  const targetConnected = profileConnectionState[compareForm.target_profile_id] === 'connected'

  return (
    <div className="form-card compact-form-card compare-form-card">
      <div className="compare-connection-grid">
        <div className="compare-connection-panel">
          <div className="compare-connection-panel-head">
            <strong>源端</strong>
            <span className={`status-tag ${sourceConnected ? 'success' : sourceLoading ? 'warning' : 'muted'}`}>
              {sourceLoading
                ? '读取中'
                : sourceConnected
                  ? `已连接 · ${(databasesByProfile[compareForm.source_profile_id] ?? []).length} 个库`
                  : compareForm.source_profile_id
                    ? '待建立连接'
                    : '未选择'}
            </span>
          </div>
          <div className="form-grid single-column-grid">
            <CompareSelectionDropdown
              label="源端数据源"
              placeholder="请选择数据源"
              searchPlaceholder="输入关键字模糊搜索"
              value={compareForm.source_profile_id}
              options={sourceProfileOptions}
              emptyText="没有匹配的数据源"
              onChange={onSourceProfileChange}
            />
            <CompareSelectionDropdown
              label="源端数据库"
              placeholder={
                !compareForm.source_profile_id
                  ? '请先选择数据源'
                  : sourceLoading
                    ? '正在加载数据库...'
                    : sourceConnected
                      ? '请选择数据库'
                      : '数据库列表暂未就绪'
              }
              searchPlaceholder="输入数据库名搜索"
              value={compareForm.source_database_name}
              options={sourceDatabaseOptions}
              disabled={!compareForm.source_profile_id || sourceLoading}
              emptyText={
                compareForm.source_profile_id
                  ? '当前数据源下没有匹配的数据库'
                  : '请先选择数据源'
              }
              onChange={onSourceDatabaseChange}
            />
          </div>
        </div>

        <div className="compare-connection-panel">
          <div className="compare-connection-panel-head">
            <strong>目标端</strong>
            <span className={`status-tag ${targetConnected ? 'success' : targetLoading ? 'warning' : 'muted'}`}>
              {targetLoading
                ? '读取中'
                : targetConnected
                  ? `已连接 · ${(databasesByProfile[compareForm.target_profile_id] ?? []).length} 个库`
                  : compareForm.target_profile_id
                    ? '待建立连接'
                    : '未选择'}
            </span>
          </div>
          <div className="form-grid single-column-grid">
            <CompareSelectionDropdown
              label="目标端数据源"
              placeholder="请选择数据源"
              searchPlaceholder="输入关键字模糊搜索"
              value={compareForm.target_profile_id}
              options={targetProfileOptions}
              emptyText="没有匹配的数据源"
              onChange={onTargetProfileChange}
            />
            <CompareSelectionDropdown
              label="目标端数据库"
              placeholder={
                !compareForm.target_profile_id
                  ? '请先选择数据源'
                  : targetLoading
                    ? '正在加载数据库...'
                    : targetConnected
                      ? '请选择数据库'
                      : '数据库列表暂未就绪'
              }
              searchPlaceholder="输入数据库名搜索"
              value={compareForm.target_database_name}
              options={targetDatabaseOptions}
              disabled={!compareForm.target_profile_id || targetLoading}
              emptyText={
                compareForm.target_profile_id
                  ? '当前数据源下没有匹配的数据库'
                  : '请先选择数据源'
              }
              onChange={onTargetDatabaseChange}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function DataCompareWorkspace({
  state,
  compareForm,
  profiles,
  compareHistoryItems,
  databasesByProfile,
  nodeLoading,
  profileConnectionState,
  filteredTables,
  onSourceProfileChange,
  onSourceDatabaseChange,
  onTargetProfileChange,
  onTargetDatabaseChange,
  onDiscover,
  onBackToSourceStep,
  onTableFilterChange,
  onTableToggle,
  onSelectAllTables,
  onClearAllTables,
  onRunCompare,
  onExportSql,
  onCancelCompare,
  onResultTablePick,
  onDetailTypeChange,
  onResultTableToggle,
  onResultActionToggle,
  onDetailToggle,
  onLoadMoreDetail,
}: {
  state: DataCompareState
  compareForm: CompareFormState
  profiles: ConnectionProfile[]
  compareHistoryItems: CompareHistoryItem[]
  databasesByProfile: Record<string, DatabaseEntry[]>
  nodeLoading: Record<string, boolean>
  profileConnectionState: Record<string, 'idle' | 'connected' | 'error'>
  filteredTables: string[]
  onSourceProfileChange: (value: string) => void
  onSourceDatabaseChange: (value: string) => void
  onTargetProfileChange: (value: string) => void
  onTargetDatabaseChange: (value: string) => void
  onDiscover: () => void
  onBackToSourceStep: () => void
  onTableFilterChange: (value: string) => void
  onTableToggle: (tableName: string, checked: boolean) => void
  onSelectAllTables: () => void
  onClearAllTables: () => void
  onRunCompare: () => void
  onExportSql: () => void
  onCancelCompare: () => void
  onResultTablePick: (tableKey: string) => void
  onDetailTypeChange: (detailType: CompareDetailType) => void
  onResultTableToggle: (tableKey: string, checked: boolean) => void
  onResultActionToggle: (
    tableKey: string,
    detailType: CompareDetailType,
    checked: boolean,
  ) => void
  onDetailToggle: (
    tableKey: string,
    detailType: CompareDetailType,
    signature: string,
    checked: boolean,
  ) => void
  onLoadMoreDetail: () => void
}) {
  const sourceProfile =
    profiles.find((profile) => profile.id === compareForm.source_profile_id) ?? null
  const targetProfile =
    profiles.find((profile) => profile.id === compareForm.target_profile_id) ?? null
  const sourceTables =
    state.discovery?.source_tables.filter((tableName) =>
      tableName.toLowerCase().includes(state.table_filter.trim().toLowerCase()),
    ) ?? []
  const targetTables =
    state.discovery?.target_tables.filter((tableName) =>
      tableName.toLowerCase().includes(state.table_filter.trim().toLowerCase()),
    ) ?? []
  const commonTableSet = new Set(state.discovery?.common_tables ?? [])
  const sourceOnlyTables = (state.discovery?.source_tables ?? []).filter(
    (tableName) => !commonTableSet.has(tableName),
  )
  const targetOnlyTables = (state.discovery?.target_tables ?? []).filter(
    (tableName) => !commonTableSet.has(tableName),
  )
  const activeResult =
    state.result?.table_results.find(
      (item) => buildDataCompareResultTableKey(item) === state.active_table_key,
    ) ?? null
  const activeDetailState =
    (activeResult
      ? state.detail_pages[state.active_table_key]?.[state.active_detail_type]
      : null) ?? createEmptyDataCompareDetailState()
  const selectionSummary = getDataCompareSelectionSummary(
    state.result,
    state.selection_by_table,
  )

  if (state.current_step === 1) {
    return (
      <div className="compare-workspace compare-flow-workspace">
        <div className="compare-page-header">
          <div>
            <strong>数据对比</strong>
            <p>直接在当前页面选择源端与目标端数据库，不再依赖数据源树的额外点击流程。</p>
          </div>
          <div className="editor-actions">
            <button
              className="flat-button primary"
              disabled={state.loading_tables || state.running || profiles.length === 0}
              type="button"
              onClick={onDiscover}
            >
              {state.loading_tables ? '加载中...' : '加载同名表'}
            </button>
          </div>
        </div>

        <div className="glass-card compare-results-card">
          <div className="section-head">
            <div>
              <h2>步骤 1 / 3</h2>
              <p>选择数据源后即可直接加载数据库列表，并进入同名表筛选阶段。</p>
            </div>
          </div>
          {profiles.length === 0 ? (
            <EmptyNotice title="暂无数据源" text="先新增或导入数据源，再开始数据对比。" />
          ) : (
            <>
              <CompareConnectionForm
                compareForm={compareForm}
                profiles={profiles}
                compareHistoryItems={compareHistoryItems}
                databasesByProfile={databasesByProfile}
                nodeLoading={nodeLoading}
                profileConnectionState={profileConnectionState}
                onSourceProfileChange={onSourceProfileChange}
                onSourceDatabaseChange={onSourceDatabaseChange}
                onTargetProfileChange={onTargetProfileChange}
                onTargetDatabaseChange={onTargetDatabaseChange}
              />
              <div className="compare-pair-summary">
                <div className="compare-pair-item">
                  <span>源端</span>
                  <strong>
                    {sourceProfile
                      ? `${sourceProfile.data_source_name} / ${compareForm.source_database_name || '未选择数据库'}`
                      : '未选择'}
                  </strong>
                </div>
                <div className="compare-pair-arrow">→</div>
                <div className="compare-pair-item">
                  <span>目标端</span>
                  <strong>
                    {targetProfile
                      ? `${targetProfile.data_source_name} / ${compareForm.target_database_name || '未选择数据库'}`
                      : '未选择'}
                  </strong>
                </div>
              </div>
            </>
          )}
          {state.task_progress ? (
            <div className="status-panel compare-status-panel">
              <strong>任务状态</strong>
              <span>
                {state.task_progress.completed_tables}/{state.task_progress.total_tables} 表
              </span>
              <span>{formatCompareTaskPhaseLabel(state.task_progress.current_phase)}</span>
              {state.task_progress.current_phase_progress?.total ? (
                <span>
                  阶段进度 {state.task_progress.current_phase_progress.current}/
                  {state.task_progress.current_phase_progress.total}
                </span>
              ) : null}
              {state.task_progress.current_table ? (
                <span>{state.task_progress.current_table}</span>
              ) : null}
              {state.running ? (
                <button className="flat-button danger" type="button" onClick={onCancelCompare}>
                  取消任务
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (state.current_step === 2) {
    return (
      <div className="compare-workspace compare-flow-workspace">
        <div className="compare-page-header">
          <div>
            <strong>数据对比</strong>
            <p>完全沿用 mysql-data-compare 的表范围筛选方式：三栏表目录、同名表勾选和差异预检查。</p>
          </div>
          <div className="editor-actions">
            <button className="flat-button" type="button" onClick={onBackToSourceStep}>
              上一步
            </button>
            <button className="flat-button" type="button" onClick={onSelectAllTables}>
              全选所有表
            </button>
            <button className="flat-button" type="button" onClick={onClearAllTables}>
              清空所有表
            </button>
            <button
              className="flat-button primary"
              disabled={state.running || state.selected_tables.length === 0}
              type="button"
              onClick={onRunCompare}
            >
              {state.running ? '对比中...' : '比较并预览'}
            </button>
          </div>
        </div>

        <SummaryCards
          items={[
            ['源表总数', String(state.discovery?.source_tables.length ?? 0)],
            ['目标表总数', String(state.discovery?.target_tables.length ?? 0)],
            ['可比较同名表', String(state.discovery?.common_tables.length ?? 0)],
            ['当前选中', String(state.selected_tables.length)],
          ]}
        />

        <div className="glass-card compare-results-card">
          <div className="compare-pair-summary">
            <div className="compare-pair-item">
              <span>源端</span>
              <strong>
                {sourceProfile
                  ? `${sourceProfile.data_source_name} / ${compareForm.source_database_name}`
                  : '未选择'}
              </strong>
            </div>
            <div className="compare-pair-arrow">→</div>
            <div className="compare-pair-item">
              <span>目标端</span>
              <strong>
                {targetProfile
                  ? `${targetProfile.data_source_name} / ${compareForm.target_database_name}`
                  : '未选择'}
              </strong>
            </div>
          </div>

          <div className="form-card compact-form-card compare-filter-card">
            <label className="form-item">
              <span>搜索表名</span>
              <input
                value={state.table_filter}
                onChange={(event) => onTableFilterChange(event.target.value)}
                placeholder="输入关键字筛选源表、同名表和目标表"
              />
            </label>
          </div>

          <div className="compare-database-grid">
            <CompareDatabaseTablePanel
              items={sourceTables}
              title="源数据库表"
              matchLabel="同名可比较"
              matchedSet={commonTableSet}
              soloLabel="仅源端"
            />

            <div className="compare-catalog-card">
              <div className="table-panel-head">
                <div>可比较同名表</div>
                <div className="small-text">共 {filteredTables.length} 条匹配结果</div>
              </div>
              <div className="compare-table-list compare-catalog-list">
                {filteredTables.length === 0 ? (
                  <div className="empty-inline">当前没有匹配的可比较表</div>
                ) : (
                  filteredTables.map((tableName) => (
                    <label className="compare-table-item" key={tableName}>
                      <input
                        checked={state.selected_tables.includes(tableName)}
                        type="checkbox"
                        onChange={(event) =>
                          onTableToggle(tableName, event.target.checked)
                        }
                      />
                      <span>{tableName}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <CompareDatabaseTablePanel
              items={targetTables}
              title="目标数据库表"
              matchLabel="同名可比较"
              matchedSet={commonTableSet}
              soloLabel="仅目标端"
            />
          </div>

          <div className="compare-difference-grid">
            <CompareDifferenceCard items={sourceOnlyTables} title="仅在源端存在" />
            <CompareDifferenceCard items={targetOnlyTables} title="仅在目标端存在" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="compare-workspace compare-flow-workspace">
      <div className="compare-page-header">
        <div>
          <strong>数据对比</strong>
        </div>
        <div className="editor-actions">
          <button className="flat-button" type="button" onClick={() => onBackToSourceStep()}>
            返回表选择
          </button>
          <button
            className="flat-button"
            disabled={
              selectionSummary.insert_selected +
                selectionSummary.update_selected +
                selectionSummary.delete_selected ===
              0
            }
            type="button"
            onClick={onExportSql}
          >
            导出 SQL
          </button>
          <button className="flat-button primary" type="button" onClick={onRunCompare}>
            重新执行
          </button>
        </div>
      </div>

      {state.result ? (
        <>
          <SummaryCards
            items={[
              ['总表数', String(state.result.summary.total_tables)],
              ['已选表', `${selectionSummary.selected_tables}/${state.result.summary.compared_tables}`],
              ['总耗时', `${state.result.performance.total_elapsed_ms} ms`],
              [
                'INSERT（已选/总数）',
                `${selectionSummary.insert_selected}/${state.result.summary.total_insert_count}`,
              ],
              [
                'UPDATE（已选/总数）',
                `${selectionSummary.update_selected}/${state.result.summary.total_update_count}`,
              ],
              [
                'DELETE（已选/总数）',
                `${selectionSummary.delete_selected}/${state.result.summary.total_delete_count}`,
              ],
            ]}
          />

          {state.result.skipped_tables.length > 0 ? (
            <div className="status-panel warning compare-warning-panel">
              <strong>跳过的表</strong>
              {state.result.skipped_tables.map((item) => (
                <span key={`${item.source_table}:${item.reason}`}>
                  {item.source_table} {'->'} {item.target_table}：{item.reason}
                </span>
              ))}
            </div>
          ) : null}

          <div className="compare-main-grid compare-main-stack">
            <div className="glass-card compare-results-card">
              <div className="section-head">
                <div>
                  <h2>表对比结果</h2>
                </div>
              </div>
              <div className="result-table-wrap">
                <table className="result-table">
                  <thead>
                    <tr>
                      <th>表名</th>
                      <th>模式</th>
                      <th>整表（已选/总数）</th>
                      <th>INSERT（已选/总数）</th>
                      <th>UPDATE（已选/总数）</th>
                      <th>DELETE（已选/总数）</th>
                      <th>告警</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.result.table_results.map((item) => {
                      const tableKey = buildDataCompareResultTableKey(item)
                      const tableStats = getDataCompareTableSelectionStats(
                        item,
                        state.selection_by_table,
                      )

                      return (
                        <tr
                          className={state.active_table_key === tableKey ? 'active-row' : ''}
                          key={tableKey}
                          onClick={() => onResultTablePick(tableKey)}
                        >
                          <td>
                            <button
                              className="link-button"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                onResultTablePick(tableKey)
                              }}
                            >
                              {item.source_table}
                            </button>
                            {item.target_table !== item.source_table ? (
                              <div className="result-table-meta">
                                目标表：{item.target_table}
                              </div>
                            ) : null}
                          </td>
                          <td>{item.compare_mode}</td>
                          <td>
                            <CompareResultCheckbox
                              checked={tableStats.table_checked}
                              countLabel={`${tableStats.selected_total}/${tableStats.total_total}`}
                              indeterminate={tableStats.table_indeterminate}
                              label="整表"
                              onChange={(checked) =>
                                onResultTableToggle(tableKey, checked)
                              }
                            />
                          </td>
                          <td>
                            <CompareResultCheckbox
                              checked={tableStats.insert_checked}
                              countLabel={`${tableStats.insert_selected}/${tableStats.insert_total}`}
                              indeterminate={tableStats.insert_indeterminate}
                              label="INSERT"
                              onChange={(checked) =>
                                onResultActionToggle(tableKey, 'insert', checked)
                              }
                            />
                          </td>
                          <td>
                            <CompareResultCheckbox
                              checked={tableStats.update_checked}
                              countLabel={`${tableStats.update_selected}/${tableStats.update_total}`}
                              indeterminate={tableStats.update_indeterminate}
                              label="UPDATE"
                              onChange={(checked) =>
                                onResultActionToggle(tableKey, 'update', checked)
                              }
                            />
                          </td>
                          <td>
                            <CompareResultCheckbox
                              checked={tableStats.delete_checked}
                              countLabel={`${tableStats.delete_selected}/${tableStats.delete_total}`}
                              indeterminate={tableStats.delete_indeterminate}
                              label="DELETE"
                              onChange={(checked) =>
                                onResultActionToggle(tableKey, 'delete', checked)
                              }
                            />
                          </td>
                          <td>{item.warnings.length > 0 ? item.warnings.join('；') : '--'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="glass-card compare-detail-card">
              <div className="section-head">
                <div>
                  <h2>表差异详情</h2>
                  <p>
                    {activeResult
                      ? `${activeResult.source_table} -> ${activeResult.target_table}`
                      : '请选择一张表'}
                  </p>
                </div>
                {activeResult ? (
                  <div className="compare-history-tabs">
                    {(['insert', 'update', 'delete'] as CompareDetailType[]).map((detailType) => (
                      <button
                        className={`flat-button ${state.active_detail_type === detailType ? 'primary' : ''}`}
                        key={detailType}
                        type="button"
                        onClick={() => onDetailTypeChange(detailType)}
                      >
                        {detailType.toUpperCase()}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {activeResult ? (
                <>
                  <div className="compare-detail-summary">
                    <span>
                      主键/唯一键：
                      {(activeResult.key_columns ?? []).length > 0
                        ? activeResult.key_columns.join('、')
                        : '未识别'}
                    </span>
                    <span>
                      当前分类已选{' '}
                      {
                        getDataCompareActionSelectionStats(
                          activeResult,
                          state.selection_by_table,
                          state.active_detail_type,
                        ).selected
                      }
                      /
                      {
                        getDataCompareActionSelectionStats(
                          activeResult,
                          state.selection_by_table,
                          state.active_detail_type,
                        ).total
                      }
                    </span>
                    <span>
                      已加载 {activeDetailState.fetched}/{activeDetailState.total}
                    </span>
                  </div>

                  {activeResult.warnings.length > 0 ? (
                    <div className="status-panel warning compare-warning-panel">
                      {activeResult.warnings.map((warning) => (
                        <span key={warning}>{warning}</span>
                      ))}
                    </div>
                  ) : null}

                  {activeDetailState.error ? (
                    <EmptyNotice title="读取差异详情失败" text={activeDetailState.error} />
                  ) : state.active_detail_type === 'update' ? (
                    <div className="compare-detail-list">
                      {activeDetailState.update_items.length === 0 && activeDetailState.loading ? (
                        <div className="empty-inline">正在加载差异详情...</div>
                      ) : null}
                      {activeDetailState.update_items.length === 0 &&
                      !activeDetailState.loading ? (
                        <div className="empty-inline">当前分类下没有差异数据</div>
                      ) : null}
                      {activeDetailState.update_items.map((item) => (
                        <div className="compare-detail-item compare-update-item" key={item.signature}>
                          <div className="compare-update-head">
                            <label className="detail-check">
                              <input
                                checked={isDataCompareDetailSelected(
                                  activeResult,
                                  state.selection_by_table,
                                  'update',
                                  item.signature,
                                )}
                                type="checkbox"
                                onChange={(event) =>
                                  onDetailToggle(
                                    state.active_table_key,
                                    'update',
                                    item.signature,
                                    event.target.checked,
                                  )
                                }
                              />
                              <span>纳入 SQL</span>
                            </label>
                            <span className="status-tag warning">UPDATE</span>
                            <span className="compare-update-signature">
                              签名：{item.signature}，差异字段：
                              {item.diff_columns.length > 0
                                ? item.diff_columns.join('、')
                                : '无'}
                            </span>
                          </div>
                          <div className="compare-update-grid">
                            <SyncedUpdateFieldTables
                              diffColumns={item.diff_columns}
                              sourceRow={item.source_row}
                              targetRow={item.target_row}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <DataCompareRowTable
                      columns={activeDetailState.row_columns}
                      detailType={state.active_detail_type}
                      items={activeDetailState.row_items}
                      selectionByTable={state.selection_by_table}
                      tableKey={state.active_table_key}
                      tableResult={activeResult}
                      onToggle={onDetailToggle}
                    />
                  )}

                  {activeDetailState.loading && activeDetailState.fetched > 0 ? (
                    <div className="status-panel">正在加载更多差异...</div>
                  ) : null}

                  {activeDetailState.has_more ? (
                    <div className="compare-detail-loadmore">
                      <button className="flat-button" type="button" onClick={onLoadMoreDetail}>
                        加载更多
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <EmptyNotice title="请选择结果表" text="先在左侧结果表格中选择一张表。" />
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="empty-workspace compare-empty-workspace">
          <strong>等待执行数据对比</strong>
          <p>完成同名表加载并执行比较后，在这里查看统计结果与明细。</p>
          <span>当前筛选 {filteredTables.length} 张可比表</span>
        </div>
      )}
    </div>
  )
}

function StructureCompareWorkspace({
  state,
  compareForm,
  profiles,
  compareHistoryItems,
  databasesByProfile,
  nodeLoading,
  profileConnectionState,
  onSourceProfileChange,
  onSourceDatabaseChange,
  onTargetProfileChange,
  onTargetDatabaseChange,
  onRunCompare,
  onBackToSourceStep,
  onGoToSummaryStep,
  onBackToDiffStep,
  detailConcurrencyInput,
  onDetailConcurrencyInputChange,
  onExportSql,
  onCategoryChange,
  onCategoryToggle,
  onTableToggle,
  onDetailToggle,
}: {
  state: StructureCompareState
  compareForm: CompareFormState
  profiles: ConnectionProfile[]
  compareHistoryItems: CompareHistoryItem[]
  databasesByProfile: Record<string, DatabaseEntry[]>
  nodeLoading: Record<string, boolean>
  profileConnectionState: Record<string, 'idle' | 'connected' | 'error'>
  onSourceProfileChange: (value: string) => void
  onSourceDatabaseChange: (value: string) => void
  onTargetProfileChange: (value: string) => void
  onTargetDatabaseChange: (value: string) => void
  onRunCompare: () => void
  onBackToSourceStep: () => void
  onGoToSummaryStep: () => void
  onBackToDiffStep: () => void
  detailConcurrencyInput: string
  onDetailConcurrencyInputChange: (value: string) => void
  onExportSql: () => void
  onCategoryChange: (category: StructureDetailCategory) => void
  onCategoryToggle: (category: StructureDetailCategory, checked: boolean) => void
  onTableToggle: (
    category: StructureDetailCategory,
    tableName: string,
    checked: boolean,
  ) => void
  onDetailToggle: (
    category: StructureDetailCategory,
    tableName: string,
    forceReload?: boolean,
  ) => void
}) {
  const sourceProfile =
    profiles.find((profile) => profile.id === compareForm.source_profile_id) ?? null
  const targetProfile =
    profiles.find((profile) => profile.id === compareForm.target_profile_id) ?? null
  const activeItems = getStructureItemsByCategory(state.result, state.active_category)
  const selectedTotal = getStructureSelectionTotal(state.selection_by_category)

  if (state.current_step === 1) {
    return (
      <div className="compare-workspace compare-flow-workspace">
        <div className="compare-page-header">
          <div>
            <strong>结构对比</strong>
            <p>结构对比的源端与目标端选择已经内聚到当前页面，不再依赖数据源页的额外创建链接。</p>
          </div>
          <div className="editor-actions">
            <button
              className="flat-button primary"
              disabled={state.loading || profiles.length === 0}
              type="button"
              onClick={onRunCompare}
            >
              {state.loading ? '比较中...' : '比较结构'}
            </button>
          </div>
        </div>

        <div className="glass-card compare-results-card">
          <div className="section-head">
            <div>
              <h2>步骤 1 / 3</h2>
              <p>直接在当前结构对比页选择源端与目标端数据库，然后进入差异分类勾选。</p>
            </div>
          </div>
          {profiles.length === 0 ? (
            <EmptyNotice title="暂无数据源" text="先新增或导入数据源，再开始结构对比。" />
          ) : (
            <>
              <CompareConnectionForm
                compareForm={compareForm}
                profiles={profiles}
                compareHistoryItems={compareHistoryItems}
                databasesByProfile={databasesByProfile}
                nodeLoading={nodeLoading}
                profileConnectionState={profileConnectionState}
                onSourceProfileChange={onSourceProfileChange}
                onSourceDatabaseChange={onSourceDatabaseChange}
                onTargetProfileChange={onTargetProfileChange}
                onTargetDatabaseChange={onTargetDatabaseChange}
              />
              <div className="compare-pair-summary">
                <div className="compare-pair-item">
                  <span>源端</span>
                  <strong>
                    {sourceProfile
                      ? `${sourceProfile.data_source_name} / ${compareForm.source_database_name || '未选择数据库'}`
                      : '未选择'}
                  </strong>
                </div>
                <div className="compare-pair-arrow">→</div>
                <div className="compare-pair-item">
                  <span>目标端</span>
                  <strong>
                    {targetProfile
                      ? `${targetProfile.data_source_name} / ${compareForm.target_database_name || '未选择数据库'}`
                      : '未选择'}
                  </strong>
                </div>
              </div>
              <div className="form-card compact-form-card compare-form-card">
                <div className="form-grid single-column-grid">
                  <label className="form-item">
                    <span>结构详情并发度</span>
                    <input
                      max={16}
                      min={1}
                      placeholder="留空表示自动，首屏仍保持按需加载"
                      step={1}
                      type="number"
                      value={detailConcurrencyInput}
                      onChange={(event) =>
                        onDetailConcurrencyInputChange(event.target.value)
                      }
                    />
                  </label>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  if (state.current_step === 2) {
    return (
      <div className="compare-workspace compare-flow-workspace">
        <div className="compare-page-header">
          <div>
            <strong>结构对比</strong>
            <p>按新增、修改、删除三类查看结构差异，并对每张表单独控制是否保留在本次结果中。</p>
          </div>
          <div className="editor-actions">
            <button className="flat-button" type="button" onClick={onBackToSourceStep}>
              上一步
            </button>
            <button
              className="flat-button primary"
              disabled={selectedTotal === 0}
              type="button"
              onClick={onGoToSummaryStep}
            >
              下一步
            </button>
          </div>
        </div>

        {state.result ? (
          <>
            <SummaryCards
              items={[
                ['源表数', String(state.result.summary.source_table_count)],
                ['目标表数', String(state.result.summary.target_table_count)],
                [
                  '新增项',
                  `${state.selection_by_category.added.length}/${state.result.summary.added_table_count}`,
                ],
                [
                  '修改项',
                  `${state.selection_by_category.modified.length}/${state.result.summary.modified_table_count}`,
                ],
                [
                  '删除项',
                  `${state.selection_by_category.deleted.length}/${state.result.summary.deleted_table_count}`,
                ],
              ]}
            />

            <div className="glass-card compare-results-card">
              <div className="compare-structure-tabstrip">
                {(['added', 'modified', 'deleted'] as StructureDetailCategory[]).map((category) => {
                  const total = getStructureItemsByCategory(state.result, category).length
                  const selected = state.selection_by_category[category].length

                  return (
                    <div
                      className={`structure-tab-group ${
                        state.active_category === category ? 'active' : ''
                      }`}
                      key={category}
                    >
                      <label className="structure-tab-check">
                        <input
                          checked={total > 0 && selected === total}
                          ref={(element) => {
                            if (!element) {
                              return
                            }
                            element.indeterminate = selected > 0 && selected < total
                          }}
                          type="checkbox"
                          onChange={(event) =>
                            onCategoryToggle(category, event.target.checked)
                          }
                        />
                      </label>
                      <button
                        className={`flat-button ${state.active_category === category ? 'primary' : ''}`}
                        type="button"
                        onClick={() => onCategoryChange(category)}
                      >
                        {getStructureCategoryLabel(category)} {selected}/{total}
                      </button>
                    </div>
                  )
                })}
              </div>

              <div className="section-head">
                <div>
                  <h2>{getStructureCategoryLabel(state.active_category)}</h2>
                  <p>{getStructureCategoryDescription(state.active_category)}</p>
                </div>
              </div>

              <div className="compare-detail-list">
                {activeItems.length === 0 ? (
                  <EmptyNotice title="当前分类为空" text="这一类结构差异本轮未命中。" />
                ) : (
                  activeItems.map((item) => {
                    const detailKey = buildStructureCompareDetailKey(
                      state.active_category,
                      item.table_name,
                    )
                    const expanded = state.expanded_detail_keys.includes(detailKey)
                    const detailState = state.detail_cache[detailKey]

                    return (
                      <div className="compare-detail-item structure-detail-item" key={detailKey}>
                        <div className="structure-row">
                          <label className="structure-row-main">
                            <input
                              checked={state.selection_by_category[state.active_category].includes(
                                item.table_name,
                              )}
                              type="checkbox"
                              onChange={(event) =>
                                onTableToggle(
                                  state.active_category,
                                  item.table_name,
                                  event.target.checked,
                                )
                              }
                            />
                            <span className="structure-row-name">{item.table_name}</span>
                          </label>
                          <button
                            className="flat-button"
                            type="button"
                            onClick={() =>
                              onDetailToggle(state.active_category, item.table_name)
                            }
                          >
                            {detailState?.loading ? '加载中...' : expanded ? '收起详情' : '查看详情'}
                          </button>
                        </div>
                        {expanded ? (
                          <StructureDetailPanel
                            category={state.active_category}
                            detailState={detailState}
                            item={item}
                            onReload={() =>
                              onDetailToggle(state.active_category, item.table_name, true)
                            }
                          />
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </>
        ) : (
          <EmptyNotice title="等待执行结构对比" text="先完成源端与目标端选择。" />
        )}
      </div>
    )
  }

  return (
    <div className="compare-workspace compare-flow-workspace">
      <div className="compare-page-header">
        <div>
          <strong>结构对比</strong>
          <p>当前汇总的是本次保留的结构改动范围，便于继续复核和后续导出 SQL。</p>
        </div>
        <div className="editor-actions">
          <button className="flat-button" type="button" onClick={onBackToDiffStep}>
            返回差异筛选
          </button>
          <button
            className="flat-button"
            disabled={selectedTotal === 0}
            type="button"
            onClick={onExportSql}
          >
            导出结构 SQL
          </button>
          <button className="flat-button primary" type="button" onClick={onRunCompare}>
            重新比较
          </button>
        </div>
      </div>

      {state.result ? (
        <>
          <SummaryCards
            items={[
              ['已选新增表', String(state.selection_by_category.added.length)],
              ['已选修改表', String(state.selection_by_category.modified.length)],
              ['已选删除表', String(state.selection_by_category.deleted.length)],
              ['总耗时', `${state.result.performance.total_elapsed_ms} ms`],
            ]}
          />
          <div className="compare-structure-summary-grid">
            <CompareDifferenceCard
              items={state.selection_by_category.added}
              title="新增项"
            />
            <CompareDifferenceCard
              items={state.selection_by_category.modified}
              title="修改项"
            />
            <CompareDifferenceCard
              items={state.selection_by_category.deleted}
              title="删除项"
            />
          </div>
          <div className="status-panel compare-status-panel">
            <strong>当前库对</strong>
            <span>
              {sourceProfile
                ? `${sourceProfile.data_source_name} / ${compareForm.source_database_name}`
                : compareForm.source_database_name}
              {' -> '}
              {targetProfile
                ? `${targetProfile.data_source_name} / ${compareForm.target_database_name}`
                : compareForm.target_database_name}
            </span>
            <span>已选结构差异共 {selectedTotal} 项</span>
          </div>
        </>
      ) : (
        <div className="empty-workspace compare-empty-workspace">
          <strong>等待执行结构对比</strong>
          <p>先完成结构比较，再在这里汇总本次保留的结构改动。</p>
        </div>
      )}
    </div>
  )
}

function CompareDatabaseTablePanel({
  items,
  title,
  matchLabel,
  matchedSet,
  soloLabel,
}: {
  items: string[]
  title: string
  matchLabel: string
  matchedSet: Set<string>
  soloLabel: string
}) {
  return (
    <div className="compare-catalog-card">
      <div className="table-panel-head">
        <div>{title}</div>
        <div className="small-text">{items.length} 张表</div>
      </div>
      <div className="compare-catalog-list">
        {items.length === 0 ? (
          <div className="empty-inline">没有匹配的表</div>
        ) : (
          items.map((tableName) => (
            <div className="compare-readonly-table-item" key={`${title}:${tableName}`}>
              <span>{tableName}</span>
              <span className={`status-tag ${matchedSet.has(tableName) ? 'success' : 'muted'}`}>
                {matchedSet.has(tableName) ? matchLabel : soloLabel}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function CompareDifferenceCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="compare-difference-card">
      <div className="compare-difference-title">{title}</div>
      <div className="compare-chip-wrap">
        {items.length === 0 ? (
          <span className="empty-inline">无</span>
        ) : (
          items.slice(0, 18).map((item) => (
            <span className="compare-chip" key={`${title}:${item}`}>
              {item}
            </span>
          ))
        )}
      </div>
    </div>
  )
}

function CompareResultCheckbox({
  checked,
  indeterminate,
  label,
  countLabel,
  onChange,
}: {
  checked: boolean
  indeterminate: boolean
  label: string
  countLabel: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      className="compare-result-check"
      onClick={(event) => {
        event.stopPropagation()
      }}
    >
      <input
        checked={checked}
        ref={(element) => {
          if (!element) {
            return
          }
          element.indeterminate = indeterminate
        }}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
      <strong>{countLabel}</strong>
    </label>
  )
}

function DataCompareRowTable({
  columns,
  items,
  tableResult,
  tableKey,
  detailType,
  selectionByTable,
  onToggle,
}: {
  columns: string[]
  items: CompareDetailPageResponse['row_items']
  tableResult: TableCompareResult
  tableKey: string
  detailType: CompareDetailType
  selectionByTable: Record<string, DataCompareSelectionItem>
  onToggle: (
    tableKey: string,
    detailType: CompareDetailType,
    signature: string,
    checked: boolean,
  ) => void
}) {
  if (items.length === 0) {
    return <div className="empty-inline">当前分类下没有差异数据</div>
  }

  return (
    <div className="detail-row-table-wrap">
      <table className="detail-row-table">
        <thead>
          <tr>
            <th className="detail-row-select-col">勾选</th>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.signature}>
              <td>
                <label className="detail-check compact-check">
                  <input
                    checked={isDataCompareDetailSelected(
                      tableResult,
                      selectionByTable,
                      detailType,
                      item.signature,
                    )}
                    type="checkbox"
                    onChange={(event) =>
                      onToggle(
                        tableKey,
                        detailType,
                        item.signature,
                        event.target.checked,
                      )
                    }
                  />
                  <span>纳入</span>
                </label>
              </td>
              {columns.map((column) => (
                <td key={`${item.signature}:${column}`}>
                  {stringifyCellValue(item.row[column] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SyncedUpdateFieldTables({
  diffColumns,
  sourceRow,
  targetRow,
}: {
  diffColumns: string[]
  sourceRow: JsonRecord
  targetRow: JsonRecord
}) {
  const sourceScrollRef = useRef<HTMLDivElement | null>(null)
  const targetScrollRef = useRef<HTMLDivElement | null>(null)
  const syncingTargetRef = useRef<'source' | 'target' | null>(null)
  const rowKeys = buildUpdateRowKeys(sourceRow, targetRow)

  const syncScroll = (origin: 'source' | 'target') => {
    if (syncingTargetRef.current === origin) {
      syncingTargetRef.current = null
      return
    }

    const sourceElement = origin === 'source' ? sourceScrollRef.current : targetScrollRef.current
    const targetElement = origin === 'source' ? targetScrollRef.current : sourceScrollRef.current

    if (!sourceElement || !targetElement) {
      return
    }

    syncingTargetRef.current = origin === 'source' ? 'target' : 'source'
    targetElement.scrollTop = sourceElement.scrollTop
    targetElement.scrollLeft = sourceElement.scrollLeft
  }

  return (
    <>
      <UpdateFieldTable
        diffColumns={diffColumns}
        onScroll={() => syncScroll('source')}
        row={sourceRow}
        rowKeys={rowKeys}
        scrollRef={sourceScrollRef}
        title="源数据"
      />
      <UpdateFieldTable
        diffColumns={diffColumns}
        onScroll={() => syncScroll('target')}
        row={targetRow}
        rowKeys={rowKeys}
        scrollRef={targetScrollRef}
        title="目标数据"
      />
    </>
  )
}

function UpdateFieldTable({
  title,
  row,
  rowKeys,
  diffColumns,
  scrollRef,
  onScroll,
}: {
  title: string
  row: JsonRecord
  rowKeys: string[]
  diffColumns: string[]
  scrollRef?: RefObject<HTMLDivElement | null>
  onScroll?: UIEventHandler<HTMLDivElement>
}) {
  return (
    <div className="compare-update-table">
      <strong>{title}</strong>
      <div className="compare-update-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="compare-update-rows">
          {rowKeys.map((key) => (
            <div
              className={`compare-update-row ${diffColumns.includes(key) ? 'changed' : ''}`}
              key={`${title}:${key}`}
            >
              <span>{key}</span>
              <code>{stringifyCellValue(row[key] ?? null)}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function buildUpdateRowKeys(sourceRow: JsonRecord, targetRow: JsonRecord) {
  return Array.from(new Set([...Object.keys(sourceRow), ...Object.keys(targetRow)]))
}

function StructureDetailPanel({
  category,
  item,
  detailState,
  onReload,
}: {
  category: StructureDetailCategory
  item: StructureTableItem
  detailState: StructureCompareDetailCacheItem | undefined
  onReload: () => void
}) {
  if (detailState?.loading) {
    return <div className="status-panel">正在加载结构详情...</div>
  }

  if (detailState?.error) {
    return (
      <div className="status-panel warning compare-warning-panel">
        <span>{detailState.error}</span>
        <button className="flat-button" type="button" onClick={onReload}>
          重试加载
        </button>
      </div>
    )
  }

  const detail = detailState?.detail?.detail ?? item
  const detailPerformance = detailState?.detail?.performance ?? null
  const slowestStage = getSlowestPerformanceStage(detailPerformance)

  return (
    <div className="structure-detail-card">
      {detailPerformance && detailPerformance.total_elapsed_ms > 0 ? (
        <div className="compare-chip-wrap">
          <span className="compare-chip">总耗时 {detailPerformance.total_elapsed_ms} ms</span>
          {slowestStage ? (
            <span className="compare-chip">
              最慢：{slowestStage.label} {slowestStage.elapsed_ms} ms
            </span>
          ) : null}
          {detailPerformance.stages.map((stage) => (
            <span className="compare-chip" key={`${stage.key}:${stage.label}`}>
              {stage.label} {stage.elapsed_ms} ms
            </span>
          ))}
        </div>
      ) : null}
      {detail.warnings.length > 0 ? (
        <div className="status-panel warning compare-warning-panel">
          {detail.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}
      {category === 'modified' ? (
        <>
          {detail.preview_sql ? (
            <SqlViewer
              sql={detail.preview_sql}
              title="结构同步 SQL"
            />
          ) : null}
          <SqlDiffViewer
            editor_id={`structure-compare:${item.table_name}`}
            modified_label="目标端 DDL"
            modified_sql={detail.target_sql ?? '-- 暂无目标端 DDL'}
            original_label="源端 DDL"
            original_sql={detail.source_sql ?? '-- 暂无源端 DDL'}
          />
        </>
      ) : (
        <SqlViewer
          sql={detail.preview_sql ?? '-- 暂无可预览 SQL'}
        />
      )}
    </div>
  )
}

function SqlViewer({
  title,
  sql,
}: {
  title?: string
  sql: string
}) {
  return (
    <div className="compare-sql-block">
      {title ? <div className="compare-sql-label">{title}</div> : null}
      <pre className="compare-sql-pre">{sql}</pre>
    </div>
  )
}

function getStructureCategoryLabel(category: StructureDetailCategory) {
  if (category === 'added') {
    return '新增项'
  }
  if (category === 'modified') {
    return '修改项'
  }
  return '删除项'
}

function getSlowestPerformanceStage(performance: CompareHistoryPerformance | null) {
  const stages = performance?.stages ?? []
  if (stages.length === 0) {
    return null
  }

  return stages.reduce((slowest, stage) =>
    stage.elapsed_ms > slowest.elapsed_ms ? stage : slowest,
  ) as CompareHistoryPerformance['stages'][number]
}

function formatCompareTaskPhaseLabel(phase: CompareTaskPhase | null) {
  switch (phase) {
    case 'pending':
      return '等待执行'
    case 'discover_tables':
      return '发现表清单'
    case 'prepare_table':
      return '准备单表对比'
    case 'table_checksum':
      return '表级校验和预筛'
    case 'keyed_hash_scan':
      return '键控哈希扫描'
    case 'chunk_hash_scan':
      return '分块哈希扫描'
    case 'source_stage_load':
      return '写入源端缓存'
    case 'target_stage_load':
      return '写入目标端缓存'
    case 'finalize_cache':
      return '归并缓存结果'
    case 'compare_table':
      return '执行单表比较'
    case 'completed':
      return '已完成'
    default:
      return 'running'
  }
}

function getStructureCategoryDescription(category: StructureDetailCategory) {
  if (category === 'added') {
    return '这些表仅存在于源库。'
  }
  if (category === 'modified') {
    return '这些表在两端同名，但建表语句存在差异。'
  }
  return '这些表仅存在于目标库。'
}

function getStructureSelectionTotal(
  selectionByCategory: Record<StructureDetailCategory, string[]>,
) {
  return (
    selectionByCategory.added.length +
    selectionByCategory.modified.length +
    selectionByCategory.deleted.length
  )
}

function buildStructureCompareDetailKey(
  category: StructureDetailCategory,
  tableName: string,
) {
  return `${category}::${tableName}`
}

function createStructureSelectionState(result: StructureCompareResponse) {
  return {
    added: result.added_tables.map((item) => item.table_name),
    modified: result.modified_tables.map((item) => item.table_name),
    deleted: result.deleted_tables.map((item) => item.table_name),
  }
}

function buildDataCompareResultTableKey(item: TableCompareResult) {
  return `${item.source_table}__${item.target_table}`
}

function buildDataCompareTableSelections(
  result: DataCompareResponse,
  selectionByTable: Record<string, DataCompareSelectionItem>,
): TableSqlSelection[] {
  return result.table_results.map((item) => {
    const tableKey = buildDataCompareResultTableKey(item)
    const tableStats = getDataCompareTableSelectionStats(item, selectionByTable)

    return {
      source_table: item.source_table,
      target_table: item.target_table,
      table_enabled: tableStats.selected_total > 0,
      insert_enabled: tableStats.insert_selected > 0,
      update_enabled: tableStats.update_selected > 0,
      delete_enabled: tableStats.delete_selected > 0,
      excluded_insert_signatures: getDataCompareExcludedSignatures(
        selectionByTable,
        tableKey,
        'insert',
      ),
      excluded_update_signatures: getDataCompareExcludedSignatures(
        selectionByTable,
        tableKey,
        'update',
      ),
      excluded_delete_signatures: getDataCompareExcludedSignatures(
        selectionByTable,
        tableKey,
        'delete',
      ),
    }
  })
}

function buildStructureSqlSelection(
  selectionByCategory: Record<StructureDetailCategory, string[]>,
): StructureSqlSelection {
  return {
    added_tables: selectionByCategory.added,
    modified_tables: selectionByCategory.modified,
    deleted_tables: selectionByCategory.deleted,
  }
}

function createEmptyDataCompareSelectionItem(): DataCompareSelectionItem {
  return {
    table_enabled: true,
    insert_enabled: true,
    update_enabled: true,
    delete_enabled: true,
    excluded_insert_signatures: [],
    excluded_update_signatures: [],
    excluded_delete_signatures: [],
  }
}

function createDataCompareSelectionState(result: DataCompareResponse) {
  return Object.fromEntries(
    result.table_results.map((item) => [
      buildDataCompareResultTableKey(item),
      createEmptyDataCompareSelectionItem(),
    ]),
  ) as Record<string, DataCompareSelectionItem>
}

function createEmptyDataCompareDetailState(): DataCompareDetailState {
  return {
    row_columns: [],
    row_items: [],
    update_items: [],
    total: 0,
    fetched: 0,
    has_more: false,
    loading: false,
    loaded: false,
    error: '',
  }
}

function buildPrunedDataCompareDetailPages(
  previousPages: DataCompareState['detail_pages'],
  tableKey: string,
  detailType: CompareDetailType,
  detailPage: CompareDetailPageResponse,
  reset: boolean,
) {
  const currentTablePages = {
    insert: previousPages[tableKey]?.insert ?? createEmptyDataCompareDetailState(),
    update: previousPages[tableKey]?.update ?? createEmptyDataCompareDetailState(),
    delete: previousPages[tableKey]?.delete ?? createEmptyDataCompareDetailState(),
  }

  const nextDetailState: DataCompareDetailState = {
    ...(currentTablePages[detailType] ?? createEmptyDataCompareDetailState()),
    row_columns: detailPage.row_columns,
    row_items:
      detailType === 'update'
        ? []
        : limitDataCompareDetailRows([
            ...(reset ? [] : currentTablePages[detailType].row_items),
            ...detailPage.row_items,
          ]),
    update_items:
      detailType === 'update'
        ? limitDataCompareDetailUpdates([
            ...(reset ? [] : currentTablePages[detailType].update_items),
            ...detailPage.update_items,
          ])
        : [],
    total: detailPage.total,
    fetched:
      (reset ? 0 : currentTablePages[detailType].fetched) +
      (detailType === 'update'
        ? detailPage.update_items.length
        : detailPage.row_items.length),
    has_more: detailPage.has_more,
    loading: false,
    loaded: true,
    error: '',
  }

  return {
    [tableKey]: {
      insert:
        detailType === 'insert'
          ? nextDetailState
          : createEmptyDataCompareDetailState(),
      update:
        detailType === 'update'
          ? nextDetailState
          : createEmptyDataCompareDetailState(),
      delete:
        detailType === 'delete'
          ? nextDetailState
          : createEmptyDataCompareDetailState(),
    },
  }
}

function limitDataCompareDetailRows(rows: CompareDetailPageResponse['row_items']) {
  return rows.length <= dataCompareDetailCacheLimit
    ? rows
    : rows.slice(-dataCompareDetailCacheLimit)
}

function limitDataCompareDetailUpdates(updates: CompareDetailPageResponse['update_items']) {
  return updates.length <= dataCompareDetailCacheLimit
    ? updates
    : updates.slice(-dataCompareDetailCacheLimit)
}

function getDataCompareActionTotalCount(
  item: TableCompareResult,
  detailType: CompareDetailType,
) {
  if (detailType === 'update') {
    return item.update_count
  }
  if (detailType === 'delete') {
    return item.delete_count
  }
  return item.insert_count
}

function getDataCompareExcludedSignatures(
  selectionByTable: Record<string, DataCompareSelectionItem>,
  tableKey: string,
  detailType: CompareDetailType,
) {
  const selection =
    selectionByTable[tableKey] ?? createEmptyDataCompareSelectionItem()

  if (detailType === 'update') {
    return selection.excluded_update_signatures
  }
  if (detailType === 'delete') {
    return selection.excluded_delete_signatures
  }
  return selection.excluded_insert_signatures
}

function getDataCompareActionSelectionStats(
  item: TableCompareResult,
  selectionByTable: Record<string, DataCompareSelectionItem>,
  detailType: CompareDetailType,
) {
  const tableKey = buildDataCompareResultTableKey(item)
  const selection =
    selectionByTable[tableKey] ?? createEmptyDataCompareSelectionItem()
  const total = getDataCompareActionTotalCount(item, detailType)
  const actionEnabled =
    selection.table_enabled &&
    (detailType === 'insert'
      ? selection.insert_enabled
      : detailType === 'update'
        ? selection.update_enabled
        : selection.delete_enabled)

  if (!actionEnabled) {
    return {
      selected: 0,
      total,
      checked: false,
      indeterminate: false,
    }
  }

  const selected = Math.max(
    total - getDataCompareExcludedSignatures(selectionByTable, tableKey, detailType).length,
    0,
  )

  return {
    selected,
    total,
    checked: total > 0 && selected === total,
    indeterminate: selected > 0 && selected < total,
  }
}

function getDataCompareTableSelectionStats(
  item: TableCompareResult,
  selectionByTable: Record<string, DataCompareSelectionItem>,
) {
  const insertStats = getDataCompareActionSelectionStats(item, selectionByTable, 'insert')
  const updateStats = getDataCompareActionSelectionStats(item, selectionByTable, 'update')
  const deleteStats = getDataCompareActionSelectionStats(item, selectionByTable, 'delete')
  const selectedTotal = insertStats.selected + updateStats.selected + deleteStats.selected
  const totalTotal = insertStats.total + updateStats.total + deleteStats.total

  return {
    selected_total: selectedTotal,
    total_total: totalTotal,
    table_checked: totalTotal > 0 && selectedTotal === totalTotal,
    table_indeterminate: selectedTotal > 0 && selectedTotal < totalTotal,
    insert_selected: insertStats.selected,
    insert_total: insertStats.total,
    insert_checked: insertStats.checked,
    insert_indeterminate: insertStats.indeterminate,
    update_selected: updateStats.selected,
    update_total: updateStats.total,
    update_checked: updateStats.checked,
    update_indeterminate: updateStats.indeterminate,
    delete_selected: deleteStats.selected,
    delete_total: deleteStats.total,
    delete_checked: deleteStats.checked,
    delete_indeterminate: deleteStats.indeterminate,
  }
}

function getDataCompareSelectionSummary(
  result: DataCompareResponse | null,
  selectionByTable: Record<string, DataCompareSelectionItem>,
) {
  return (result?.table_results ?? []).reduce(
    (summary, item) => {
      const tableStats = getDataCompareTableSelectionStats(item, selectionByTable)
      if (tableStats.selected_total > 0) {
        summary.selected_tables += 1
      }
      summary.insert_selected += tableStats.insert_selected
      summary.update_selected += tableStats.update_selected
      summary.delete_selected += tableStats.delete_selected
      return summary
    },
    {
      selected_tables: 0,
      insert_selected: 0,
      update_selected: 0,
      delete_selected: 0,
    },
  )
}

function isDataCompareDetailSelected(
  item: TableCompareResult,
  selectionByTable: Record<string, DataCompareSelectionItem>,
  detailType: CompareDetailType,
  signature: string,
) {
  const tableKey = buildDataCompareResultTableKey(item)
  const selection =
    selectionByTable[tableKey] ?? createEmptyDataCompareSelectionItem()
  const actionEnabled =
    selection.table_enabled &&
    (detailType === 'insert'
      ? selection.insert_enabled
      : detailType === 'update'
        ? selection.update_enabled
        : selection.delete_enabled)

  if (!actionEnabled) {
    return false
  }

  return !getDataCompareExcludedSignatures(selectionByTable, tableKey, detailType).includes(
    signature,
  )
}

function toggleExcludedSignature(
  signatures: string[],
  signature: string,
  checked: boolean,
) {
  const next = new Set(signatures)
  if (checked) {
    next.delete(signature)
  } else {
    next.add(signature)
  }
  return Array.from(next)
}

function CompareHistoryWorkspace({
  historyItems,
  selectedHistoryItem,
  historyType,
  onSelect,
}: {
  historyItems: CompareHistoryItem[]
  selectedHistoryItem: CompareHistoryItem | null
  historyType: CompareHistoryType
  onSelect: (historyId: number) => void
}) {
  return (
    <div className="compare-workspace">
      <div className="compare-page-header">
        <div>
          <strong>对比记录</strong>
          <p>查看本地保存的 {historyType === 'data' ? '数据对比' : '结构对比'} 历史记录。</p>
        </div>
      </div>

      <div className="compare-main-grid">
        <div className="glass-card compare-results-card">
          <div className="section-head">
            <div>
              <h2>记录列表</h2>
              <p>点击左侧记录，在右侧查看具体统计和涉及表。</p>
            </div>
          </div>
          <div className="compare-detail-list">
            {historyItems.length === 0 ? (
              <EmptyNotice title="暂无记录" text="完成一次对比后会自动写入本地记录。" />
            ) : (
              historyItems.map((item) => (
                <button
                  className={`compare-list-button ${selectedHistoryItem?.id === item.id ? 'active' : ''}`}
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                >
                  <strong>{item.source_data_source_name}</strong>
                  <span>
                    {item.source_database} {'->'} {item.target_database}
                  </span>
                  <span>{formatDateTime(item.created_at)}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="glass-card compare-detail-card">
          <div className="section-head">
            <div>
              <h2>记录详情</h2>
              <p>{selectedHistoryItem ? '展示表范围、统计和耗时信息。' : '请选择一条记录。'}</p>
            </div>
          </div>
          {selectedHistoryItem ? (
            <div className="compare-detail-list">
              <SummaryCards
                items={
                  selectedHistoryItem.history_type === 'data'
                    ? [
                        ['已对比表', String(selectedHistoryItem.compared_tables)],
                        ['INSERT', String(selectedHistoryItem.insert_count)],
                        ['UPDATE', String(selectedHistoryItem.update_count)],
                        ['DELETE', String(selectedHistoryItem.delete_count)],
                      ]
                    : [
                        ['源端表数', String(selectedHistoryItem.source_table_count)],
                        ['新增表', String(selectedHistoryItem.structure_added_count)],
                        ['修改表', String(selectedHistoryItem.structure_modified_count)],
                        ['删除表', String(selectedHistoryItem.structure_deleted_count)],
                      ]
                }
              />
              <div className="status-panel">
                {selectedHistoryItem.source_data_source_name} / {selectedHistoryItem.source_database}
                {' -> '}
                {selectedHistoryItem.target_data_source_name} / {selectedHistoryItem.target_database}
              </div>
              <div className="compare-summary-list">
                <span>表范围：{selectedHistoryItem.table_mode === 'all' ? '全部同名表' : '手动选择'}</span>
                <span>记录时间：{formatDateTime(selectedHistoryItem.created_at)}</span>
                <span>总耗时：{selectedHistoryItem.performance.total_elapsed_ms} ms</span>
                <span>涉及表数：{selectedHistoryItem.total_tables}</span>
              </div>
              <pre className="code-block">
                {JSON.stringify(selectedHistoryItem.table_detail, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SummaryCards({ items }: { items: [string, string][] }) {
  return (
    <div className="compare-summary-grid">
      {items.map(([label, value]) => (
        <div className="compare-summary-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  )
}

function DatabaseGlyph() {
  return (
    <span className="glyph-badge">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <ellipse cx="12" cy="6" rx="6.5" ry="2.8" />
        <path d="M5.5 6v8c0 1.6 2.9 2.9 6.5 2.9s6.5-1.3 6.5-2.9V6" />
        <path d="M5.5 10c0 1.6 2.9 2.9 6.5 2.9s6.5-1.3 6.5-2.9" />
      </svg>
    </span>
  )
}

function DatabaseSettingsGlyph() {
  return (
    <svg className="settings-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="11" cy="6" rx="6" ry="2.6" />
      <path d="M5 6v7c0 1.5 2.7 2.8 6 2.8s6-1.3 6-2.8V6" />
      <path d="M5 9.5c0 1.5 2.7 2.8 6 2.8 1 0 1.9-.1 2.7-.3" />
      <path d="M18.7 15.1l.6.4.8-.4.8 1.4-.6.5v.8l.6.5-.8 1.4-.8-.4-.6.4-.2.9h-1.6l-.2-.9-.6-.4-.8.4-.8-1.4.6-.5v-.8l-.6-.5.8-1.4.8.4.6-.4.2-.9h1.6z" />
      <circle cx="18" cy="17.5" r="1.2" />
    </svg>
  )
}

function TreeDatabaseGlyph() {
  return (
    <span className="tree-node-glyph tree-database-glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <ellipse cx="12" cy="6" rx="6.5" ry="2.8" />
        <path d="M5.5 6v8c0 1.6 2.9 2.9 6.5 2.9s6.5-1.3 6.5-2.9V6" />
        <path d="M5.5 10c0 1.6 2.9 2.9 6.5 2.9s6.5-1.3 6.5-2.9" />
      </svg>
    </span>
  )
}

function TreeTableGlyph() {
  return (
    <span className="tree-node-glyph tree-table-glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <rect x="4.5" y="5" width="15" height="14" rx="1.8" />
        <path d="M4.5 9.5h15" />
        <path d="M9.5 5v14" />
        <path d="M14.5 9.5v9.5" />
      </svg>
    </span>
  )
}

function buildGroupedProfiles(profiles: ConnectionProfile[]): GroupedProfiles {
  const grouped = new Map<string, ConnectionProfile[]>()

  profiles.forEach((profile) => {
    const groupName = normalizeGroupName(profile.group_name)
    if (!grouped.has(groupName)) {
      grouped.set(groupName, [])
    }
    grouped.get(groupName)!.push(profile)
  })

  return Array.from(grouped.entries()).sort(([left], [right]) =>
    compareGroupName(left, right),
  )
}

function compareGroupName(left: string, right: string) {
  if (left === ungroupedGroupName) {
    return 1
  }
  if (right === ungroupedGroupName) {
    return -1
  }
  return left.localeCompare(right, 'zh-CN')
}

function getProfileCompareUsageCount(
  profileId: string,
  compareHistoryItems: CompareHistoryItem[],
) {
  return compareHistoryItems.reduce((count, item) => {
    const sourceHit = item.source_profile_id === profileId ? 1 : 0
    const targetHit = item.target_profile_id === profileId ? 1 : 0
    return count + sourceHit + targetHit
  }, 0)
}

function getDatabaseCompareUsageCount(
  profileId: string,
  databaseName: string,
  compareHistoryItems: CompareHistoryItem[],
) {
  return compareHistoryItems.reduce((count, item) => {
    const sourceHit =
      item.source_profile_id === profileId && item.source_database === databaseName ? 1 : 0
    const targetHit =
      item.target_profile_id === profileId && item.target_database === databaseName ? 1 : 0
    return count + sourceHit + targetHit
  }, 0)
}

function matchCompareFormSearch(searchTexts: string[], query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return true
  }

  return searchTexts.some((text) => text.toLowerCase().includes(normalized))
}

function sortCompareProfilesForSelection(
  profiles: ConnectionProfile[],
  compareHistoryItems: CompareHistoryItem[],
) {
  return [...profiles].sort((left, right) => {
    const usageDelta =
      getProfileCompareUsageCount(right.id, compareHistoryItems) -
      getProfileCompareUsageCount(left.id, compareHistoryItems)
    if (usageDelta !== 0) {
      return usageDelta
    }

    const groupCompare = compareGroupName(
      normalizeGroupName(left.group_name),
      normalizeGroupName(right.group_name),
    )
    if (groupCompare !== 0) {
      return groupCompare
    }

    return left.data_source_name.localeCompare(right.data_source_name, 'zh-CN')
  })
}

function sortCompareDatabasesForSelection(
  profileId: string,
  databases: DatabaseEntry[],
  compareHistoryItems: CompareHistoryItem[],
) {
  return [...databases].sort((left, right) => {
    const usageDelta =
      getDatabaseCompareUsageCount(profileId, right.name, compareHistoryItems) -
      getDatabaseCompareUsageCount(profileId, left.name, compareHistoryItems)
    if (usageDelta !== 0) {
      return usageDelta
    }

    return left.name.localeCompare(right.name, 'zh-CN')
  })
}

function sortProfiles(profiles: ConnectionProfile[]) {
  return [...profiles].sort((left, right) => {
    const groupCompare = compareGroupName(
      normalizeGroupName(left.group_name),
      normalizeGroupName(right.group_name),
    )
    if (groupCompare !== 0) {
      return groupCompare
    }

    return left.data_source_name.localeCompare(right.data_source_name, 'zh-CN')
  })
}

function sortDataSourceGroups(groups: DataSourceGroup[]) {
  return [...groups].sort((left, right) =>
    left.group_name.localeCompare(right.group_name, 'zh-CN'),
  )
}

function profileToForm(profile: ConnectionProfile): SaveConnectionProfilePayload {
  return {
    id: profile.id,
    group_name: profile.group_name,
    data_source_name: profile.data_source_name,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    password: profile.password,
  }
}

function normalizeProfileForm(
  form: SaveConnectionProfilePayload,
): SaveConnectionProfilePayload {
  return {
    id: form.id ?? null,
    group_name: form.group_name?.trim() ? form.group_name.trim() : null,
    data_source_name: form.data_source_name.trim(),
    host: form.host.trim(),
    port: form.port,
    username: form.username.trim(),
    password: form.password,
  }
}

function normalizeGroupName(groupName: string | null | undefined) {
  return groupName?.trim() || ungroupedGroupName
}

function expandAncestorsForProfile(previous: Set<string>, profile: ConnectionProfile) {
  const next = new Set(previous)
  next.add(`group:${normalizeGroupName(profile.group_name)}`)
  return next
}

function upsertProfile(previous: ConnectionProfile[], profile: ConnectionProfile) {
  const exists = previous.some((item) => item.id === profile.id)
  return exists
    ? previous.map((item) => (item.id === profile.id ? profile : item))
    : [...previous, profile]
}

function buildDataCompareHistoryInput(
  result: DataCompareResponse,
  request: DataCompareRequest,
  sourceDataSourceName: string,
  targetDataSourceName: string,
): CompareHistoryInput {
  return {
    history_type: 'data',
    source_profile_id: request.source_profile_id,
    source_data_source_name: sourceDataSourceName,
    source_database: request.source_database_name,
    target_profile_id: request.target_profile_id,
    target_data_source_name: targetDataSourceName,
    target_database: request.target_database_name,
    table_mode: request.table_mode,
    selected_tables:
      request.table_mode === 'selected' ? request.selected_tables : result.table_results.map((item) => item.source_table),
    table_detail: {
      data_tables: result.table_results.map((item) => ({
        source_table: item.source_table,
        target_table: item.target_table,
      })),
      added_tables: [],
      modified_tables: [],
      deleted_tables: [],
    },
    performance: {
      total_elapsed_ms: result.performance.total_elapsed_ms,
      stages: result.performance.stages,
      max_parallelism: result.performance.max_parallelism,
    },
    source_table_count: result.summary.total_tables,
    target_table_count: result.summary.total_tables,
    total_tables: result.summary.total_tables,
    compared_tables: result.summary.compared_tables,
    insert_count: result.summary.total_insert_count,
    update_count: result.summary.total_update_count,
    delete_count: result.summary.total_delete_count,
    structure_added_count: 0,
    structure_modified_count: 0,
    structure_deleted_count: 0,
  }
}

function buildStructureCompareHistoryInput(
  result: StructureCompareResponse,
  request: StructureCompareRequest,
  sourceDataSourceName: string,
  targetDataSourceName: string,
): CompareHistoryInput {
  return {
    history_type: 'structure',
    source_profile_id: request.source_profile_id,
    source_data_source_name: sourceDataSourceName,
    source_database: request.source_database_name,
    target_profile_id: request.target_profile_id,
    target_data_source_name: targetDataSourceName,
    target_database: request.target_database_name,
    table_mode: 'all',
    selected_tables: [],
    table_detail: {
      data_tables: [],
      added_tables: result.added_tables.map((item) => item.table_name),
      modified_tables: result.modified_tables.map((item) => item.table_name),
      deleted_tables: result.deleted_tables.map((item) => item.table_name),
    },
    performance: result.performance,
    source_table_count: result.summary.source_table_count,
    target_table_count: result.summary.target_table_count,
    total_tables:
      result.summary.added_table_count +
      result.summary.modified_table_count +
      result.summary.deleted_table_count,
    compared_tables:
      result.summary.added_table_count +
      result.summary.modified_table_count +
      result.summary.deleted_table_count,
    insert_count: 0,
    update_count: 0,
    delete_count: 0,
    structure_added_count: result.summary.added_table_count,
    structure_modified_count: result.summary.modified_table_count,
    structure_deleted_count: result.summary.deleted_table_count,
  }
}

function getStructureItemsByCategory(
  result: StructureCompareResponse | null,
  category: StructureDetailCategory,
) {
  if (!result) {
    return []
  }
  if (category === 'added') {
    return result.added_tables
  }
  if (category === 'modified') {
    return result.modified_tables
  }
  return result.deleted_tables
}

function pickFirstStructureCategory(result: StructureCompareResponse): StructureDetailCategory {
  if (result.added_tables.length > 0) {
    return 'added'
  }
  if (result.modified_tables.length > 0) {
    return 'modified'
  }
  return 'deleted'
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('zh-CN', { hour12: false })
}

function parsePositiveIntegerOrNull(value: string) {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

function buildDatabaseKey(profileId: string, databaseName: string) {
  return `${profileId}:${databaseName}`
}

function createClientId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function formatFileDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}_${hours}${minutes}${seconds}`
}

function buildDataCompareSqlFileName(compareForm: CompareFormState) {
  const source = compareForm.source_database_name || 'source'
  const target = compareForm.target_database_name || 'target'
  return `${source}_to_${target}_${formatFileDate(new Date())}.sql`
}

function buildStructureCompareSqlFileName(compareForm: CompareFormState) {
  const source = compareForm.source_database_name || 'source'
  const target = compareForm.target_database_name || 'target'
  return `${source}_to_${target}_structure_${formatFileDate(new Date())}.sql`
}

function formatOutputTimestamp(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function quoteIdentifier(raw: string) {
  return `\`${raw.replaceAll('`', '``')}\``
}

function buildTableDataSql(
  databaseName: string,
  tableName: string,
  whereClause: string,
  orderByClause: string,
  limit: number,
  offset: number,
) {
  const parts = [
    `SELECT * FROM ${quoteIdentifier(databaseName)}.${quoteIdentifier(tableName)}`,
  ]

  if (whereClause.trim()) {
    parts.push(`WHERE ${whereClause.trim()}`)
  }

  if (orderByClause.trim()) {
    parts.push(`ORDER BY ${orderByClause.trim()}`)
  }

  parts.push(`LIMIT ${limit}`)

  if (offset > 0) {
    parts.push(`OFFSET ${offset}`)
  }

  return parts.join('\n')
}

function buildCreateTablePreviewSql(tab: DesignTab) {
  const columns = tab.design.draft_columns.map((column) => stripDraftColumn(column))
  const primaryKeys = columns.filter((column) => column.primary_key)
  const columnSql = columns.map((column) => {
    const pieces = [
      quoteIdentifier(column.name),
      buildFullDataType(column),
      column.nullable ? 'NULL' : 'NOT NULL',
    ]
    if (column.auto_increment) {
      pieces.push('AUTO_INCREMENT')
    }
    if (column.default_value) {
      pieces.push(`DEFAULT '${column.default_value}'`)
    }
    return pieces.join(' ')
  })

  if (primaryKeys.length > 0) {
    columnSql.push(
      `PRIMARY KEY (${primaryKeys.map((column) => quoteIdentifier(column.name)).join(', ')})`,
    )
  }

  return `CREATE TABLE ${quoteIdentifier(tab.database_name)}.${quoteIdentifier(
    tab.design.draft_table_name || 'new_table',
  )} (\n  ${columnSql.join(',\n  ')}\n)`
}

function buildDataMutationPreviewSql(tab: DataTab) {
  return tab.data.rows
    .filter((row) => row.state !== 'clean')
    .map((row) => {
      if (row.state === 'new') {
        return `INSERT INTO ${quoteIdentifier(tab.database_name)}.${quoteIdentifier(tab.table_name)} (...) VALUES (...);`
      }
      if (row.state === 'updated') {
        return `UPDATE ${quoteIdentifier(tab.database_name)}.${quoteIdentifier(tab.table_name)} SET ... WHERE ...;`
      }
      return `DELETE FROM ${quoteIdentifier(tab.database_name)}.${quoteIdentifier(tab.table_name)} WHERE ...;`
    })
    .join('\n')
}

function prettifySql(rawSql: string) {
  const normalized = rawSql
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim()

  if (!normalized) {
    return ''
  }

  const formatted = normalized
    .replace(/\b(select)\b/gi, 'SELECT')
    .replace(/\b(from)\b/gi, '\nFROM')
    .replace(/\b(where)\b/gi, '\nWHERE')
    .replace(/\b(order by)\b/gi, '\nORDER BY')
    .replace(/\b(group by)\b/gi, '\nGROUP BY')
    .replace(/\b(limit)\b/gi, '\nLIMIT')
    .replace(/\b(values)\b/gi, '\nVALUES')
    .replace(/\b(set)\b/gi, '\nSET')
    .replace(/\b(left join|right join|inner join|outer join|join)\b/gi, '\n$1')
    .replace(/\b(and)\b/gi, '\n  AND')
    .replace(/\b(or)\b/gi, '\n  OR')

  return formatted
    .split('\n')
    .map((line, index) => (index === 0 ? line.trim() : line.trimStart()))
    .join('\n')
}

function createDraftColumn(
  column: TableColumn,
  originName: string | null = column.name,
): DesignDraftColumn {
  return {
    ...column,
    client_id: createClientId(),
    selected: false,
    origin_name: originName,
  }
}

function stripDraftColumn(column: DesignDraftColumn): TableColumn {
  return {
    name: column.name.trim(),
    data_type: column.data_type.trim(),
    full_data_type: buildFullDataType(column),
    length: column.length,
    scale: column.scale,
    nullable: column.nullable,
    primary_key: column.primary_key,
    auto_increment: column.auto_increment,
    default_value: column.default_value,
    comment: column.comment,
    ordinal_position: column.ordinal_position,
  }
}

function buildFullDataType(column: {
  data_type: string
  length: number | null
  scale: number | null
}) {
  const dataType = column.data_type.trim().toLowerCase()
  if (!column.length) {
    return dataType
  }
  if (column.scale == null) {
    return `${dataType}(${column.length})`
  }
  return `${dataType}(${column.length},${column.scale})`
}

function parseOptionalNumber(raw: string) {
  const normalized = raw.trim()
  if (!normalized) {
    return null
  }
  const parsed = Number.parseInt(normalized, 10)
  return Number.isNaN(parsed) ? null : parsed
}

function createGridRow(row: TableDataRow): DataGridRow {
  return {
    client_id: createClientId(),
    selected: false,
    state: 'clean',
    row_key: row.row_key ? { ...row.row_key } : null,
    original_values: { ...row.values },
    values: { ...row.values },
  }
}

function stringifyCellValue(value: CellValue) {
  if (value == null) {
    return 'NULL'
  }
  return String(value)
}

function parseCellValue(raw: string, column: TableDataColumn): CellValue {
  const normalized = raw.trim()
  if (!normalized) {
    return null
  }

  if (normalized.toUpperCase() === 'NULL') {
    return null
  }

  if (
    /(int|decimal|numeric|float|double|real)/i.test(column.data_type) &&
    !Number.isNaN(Number(normalized))
  ) {
    return Number(normalized)
  }

  if (/bool/i.test(column.data_type)) {
    if (normalized === 'true') {
      return true
    }
    if (normalized === 'false') {
      return false
    }
  }

  return raw
}

function inferDefaultCellValue(rawDefault: string): CellValue {
  if (rawDefault === 'CURRENT_TIMESTAMP') {
    return new Date().toISOString().slice(0, 19).replace('T', ' ')
  }
  if (!Number.isNaN(Number(rawDefault))) {
    return Number(rawDefault)
  }
  return rawDefault
}

function isCellValueEqual(left: CellValue | undefined, right: CellValue | undefined) {
  if (left === right) {
    return true
  }

  return (
    typeof left === 'number' &&
    typeof right === 'number' &&
    Number.isNaN(left) &&
    Number.isNaN(right)
  )
}

function buildChangedDataValues(row: DataGridRow): JsonRecord {
  return Object.fromEntries(
    Object.entries(row.values).filter(([columnName, value]) => {
      if (!Object.prototype.hasOwnProperty.call(row.original_values, columnName)) {
        return true
      }

      return !isCellValueEqual(value, row.original_values[columnName])
    }),
  ) as JsonRecord
}

function hasPendingDataMutations(tab: DataTab) {
  return tab.data.rows.some((row) => {
    if (row.state === 'new' || row.state === 'deleted') {
      return true
    }

    if (row.state !== 'updated' || !row.row_key) {
      return false
    }

    return Object.keys(buildChangedDataValues(row)).length > 0
  })
}

function hasSelectedDataRowsForDelete(tab: DataTab) {
  return tab.data.rows.some((row) => row.selected && row.state !== 'deleted')
}

function hasRestorableSelectedDataRows(tab: DataTab) {
  return tab.data.rows.some((row) => {
    if (!row.selected) {
      return false
    }

    if (row.state === 'new' || row.state === 'deleted') {
      return true
    }

    if (row.state !== 'updated') {
      return false
    }

    return Object.keys(buildChangedDataValues(row)).length > 0
  })
}

function buildDataMutationPayload(tab: DataTab): ApplyTableDataChangesPayload | null {
  const insertedRows = tab.data.rows
    .filter((row) => row.state === 'new')
    .map((row) => ({ values: row.values }))
  const updatedRows = tab.data.rows
    .filter((row) => row.state === 'updated' && row.row_key)
    .map((row) => ({ row_key: row.row_key!, values: buildChangedDataValues(row) }))
    .filter((row) => Object.keys(row.values).length > 0)
  const deletedRows = tab.data.rows
    .filter((row) => row.state === 'deleted' && row.row_key)
    .map((row) => ({ row_key: row.row_key! }))

  if (insertedRows.length + updatedRows.length + deletedRows.length === 0) {
    return null
  }

  return {
    profile_id: tab.profile_id,
    database_name: tab.database_name,
    table_name: tab.table_name,
    transaction_mode: tab.data.transaction_mode,
    inserted_rows: insertedRows,
    updated_rows: updatedRows,
    deleted_rows: deletedRows,
  }
}

export default App

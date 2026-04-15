import {
  Suspense,
  lazy,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from 'react'
import './App.css'
import {
  addCompareHistory,
  assignProfilesToDataSourceGroup,
  applyTableDataChanges,
  applyTableDesignChanges,
  cancelDataCompareTask,
  cancelStructureCompareTask,
  cleanupDataCompareCache,
  chooseExportPath,
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
  exportQueryResultFile,
  exportQueryResultSqlText,
  exportStructureCompareSqlFile,
  exportTableDataFile,
  exportTableDataSqlText,
  getAppBootstrap,
  getCompareHistoryDetail,
  getDataCompareTaskProgress,
  getDataCompareTaskResult,
  getRuntimeMetrics,
  getStructureCompareTaskProgress,
  getStructureCompareTaskResult,
  getTableDdl,
  installPluginFromDisk,
  importNavicatConnectionProfiles,
  listInstalledPlugins,
  listCompareHistory,
  listDatabaseTables,
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
  saveConnectionProfile,
  startDataCompareTask,
  startStructureCompareTask,
  testConnectionProfile,
  uninstallPlugin,
  writeClipboardText,
} from './api'
import {
  getDataCompareActionTotalCount,
  buildDataCompareResultTableKey,
  buildDataCompareTableSelections,
  buildPrunedDataCompareDetailPages,
  buildStructureCompareDetailKey,
  buildStructureSqlSelection,
  createDataCompareSelectionState,
  createEmptyDataCompareDetailState,
  createEmptyDataCompareSelectionItem,
  createStructureSelectionState,
  getStructureItemsByCategory,
  pickFirstStructureCategory,
  toggleExcludedSignature,
} from './features/compare/state'
import { waitForCompareTask } from './features/compare/taskRuntime'
import type {
  CompareFormState,
  CompareWorkflowStep,
  DataCompareSelectionItem,
  DataCompareState,
  StructureCompareState,
} from './features/compare/types'
import {
  buildChangedDataValues,
  buildDataMutationPayload,
  createGridRow,
} from './features/table-data/dataMutations'
import type { ConsoleTab, DataGridRow, DataTab } from './features/workspace/types'
import { WorkspaceSwitcher } from './features/workspace/WorkspaceSwitcher'
import { EmptyNotice } from './shared/components/EmptyNotice'
import { PluginManagerModal } from './features/plugins/PluginManagerModal'
import { PluginWorkspace } from './features/plugins/PluginWorkspace'
import type {
  AssignProfilesToDataSourceGroupResult,
  AppBootstrap,
  CellValue,
  CompareDetailType,
  ExecuteSqlPayload,
  ExportFileFormat,
  ExportScope,
  CompareHistoryInput,
  CompareHistoryItem,
  CompareHistorySummary,
  CompareHistoryType,
  ConnectionProfile,
  CreateDatabasePayload,
  DatabaseEntry,
  DataCompareRequest,
  DataCompareResponse,
  DataSourceGroup,
  InstalledPlugin,
  JsonRecord,
  LoadTableDataPayload,
  SaveConnectionProfilePayload,
  RuntimeMetrics,
  SqlAutocompleteSchema,
  StructureCompareRequest,
  StructureCompareResponse,
  StructureDetailCategory,
  TableColumn,
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

type GroupAssignmentTabState = {
  target_group_id: string
  filter_text: string
  selected_profile_ids: string[]
  submitting: boolean
}

type GroupAssignmentTab = {
  id: string
  kind: 'group_assignment'
  title: string
  subtitle: string
  status: 'ready' | 'busy'
  error: string
  assignment: GroupAssignmentTabState
}

type WorkspaceTab =
  | ProfileTab
  | DesignTab
  | DataTab
  | ConsoleTab
  | GroupAssignmentTab

type SqlPreviewState = {
  title: string
  statements: string[]
  confirm_label?: string
  busy: boolean
  on_confirm?: () => Promise<void>
}

type TreeContextMenuState =
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

type ExportDialogState =
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

type OutputLogEntry = {
  id: string
  tone: ToastTone
  timestamp: string
  scope: string
  message: string
  sql?: string
}

type DataSourceTreeGroup = {
  key: string
  group_id: string | null
  group_name: string
  profiles: ConnectionProfile[]
}

type NavigationTreeTable = {
  entry: TableEntry
}

type NavigationTreeDatabase = {
  entry: DatabaseEntry
  matched_by_name: boolean
  tables: NavigationTreeTable[]
}

type NavigationTreeProfile = {
  entry: ConnectionProfile
  matched_by_name: boolean
  databases: NavigationTreeDatabase[]
}

type NavigationTreeGroup = {
  key: string
  group_id: string | null
  group_name: string
  profiles: NavigationTreeProfile[]
}

const ungroupedGroupName = '未分组'
const databaseWorkspaceId = 'workspace:database'
const redisWorkspaceId = 'workspace:redis'
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

function createGroupAssignmentState(groupId: string): GroupAssignmentTabState {
  return {
    target_group_id: groupId,
    filter_text: '',
    selected_profile_ids: [],
    submitting: false,
  }
}

type RailSection = 'datasource' | 'structure_compare' | 'data_compare' | 'compare_history'
type WorkspacePanelKey = 'left' | 'right' | 'bottom'

const defaultCompareForm: CompareFormState = {
  source_profile_id: '',
  source_database_name: '',
  target_profile_id: '',
  target_database_name: '',
}

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

const DataEditorView = lazy(() =>
  import('./features/table-data/DataEditorView').then((module) => ({
    default: module.DataEditorView,
  })),
)

const ConsoleView = lazy(() =>
  import('./features/sql-console/ConsoleView').then((module) => ({
    default: module.ConsoleView,
  })),
)

const DataCompareWorkspace = lazy(() =>
  import('./features/compare/DataCompareWorkspace').then((module) => ({
    default: module.DataCompareWorkspace,
  })),
)

const StructureCompareWorkspace = lazy(() =>
  import('./features/compare/StructureCompareWorkspace').then((module) => ({
    default: module.StructureCompareWorkspace,
  })),
)

const CompareHistoryWorkspace = lazy(() =>
  import('./features/compare/CompareHistoryWorkspace').then((module) => ({
    default: module.CompareHistoryWorkspace,
  })),
)

const RedisWorkspace = lazy(() =>
  import('./features/redis/RedisWorkspace').then((module) => ({
    default: module.RedisWorkspace,
  })),
)

function App() {
  const [, setBootstrap] = useState<AppBootstrap | null>(null)
  const [bootstrapError, setBootstrapError] = useState('')
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetrics | null>(null)
  const [currentPlatform, setCurrentPlatform] = useState('')
  const [pluginPackageExtension, setPluginPackageExtension] = useState('zszc-plugin')
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(databaseWorkspaceId)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [pluginManagerVisible, setPluginManagerVisible] = useState(false)
  const [pluginManagerBusy, setPluginManagerBusy] = useState(false)
  const [uninstallingPluginId, setUninstallingPluginId] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<RailSection>('datasource')
  const [leftPanelVisible, setLeftPanelVisible] = useState(true)
  const [rightPanelVisible, setRightPanelVisible] = useState(true)
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
  const [compareHistoryItems, setCompareHistoryItems] = useState<CompareHistorySummary[]>([])
  const [compareHistoryDetailById, setCompareHistoryDetailById] = useState<
    Record<number, CompareHistoryItem>
  >({})
  const [historyDetailLoadingId, setHistoryDetailLoadingId] = useState<number | null>(null)
  const [compareHistoryType, setCompareHistoryType] =
    useState<CompareHistoryType>('data')
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null)
  const [selection, setSelection] = useState<SelectionState>({ kind: 'none' })
  const [selectedGroupKey, setSelectedGroupKey] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [navigationSearchText, setNavigationSearchText] = useState('')
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
  const [exportDialog, setExportDialog] = useState<ExportDialogState | null>(null)
  const [outputVisible, setOutputVisible] = useState(true)
  const [outputLogs, setOutputLogs] = useState<OutputLogEntry[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const outputBodyRef = useRef<HTMLDivElement | null>(null)
  const tabsRef = useRef<WorkspaceTab[]>([])
  const activeCompareCacheIdRef = useRef<string | null>(null)
  const sqlAutocompleteRequestsRef = useRef<
    Partial<Record<string, Promise<SqlAutocompleteSchema | null>>>
  >({})
  const tableLoadRequestsRef = useRef<Partial<Record<string, Promise<TableEntry[]>>>>({})
  const visibleHistoryItems = useMemo(
    () => compareHistoryItems.filter((item) => item.history_type === compareHistoryType),
    [compareHistoryItems, compareHistoryType],
  )
  const deferredNavigationSearchText = useDeferredValue(navigationSearchText)
  const normalizedNavigationSearchText = deferredNavigationSearchText.trim().toLowerCase()

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
        setCurrentPlatform(payload.current_platform)
        setPluginPackageExtension(payload.plugin_package_extension)
        setInstalledPlugins(payload.installed_plugins)
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
    let cancelled = false

    async function syncRuntimeMetrics() {
      try {
        const nextMetrics = await getRuntimeMetrics()
        if (!cancelled) {
          setRuntimeMetrics(nextMetrics)
        }
      } catch {
        if (!cancelled) {
          setRuntimeMetrics(null)
        }
      }
    }

    void syncRuntimeMetrics()
    const timer = window.setInterval(() => {
      void syncRuntimeMetrics()
    }, 2000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (activeWorkspaceId === databaseWorkspaceId || activeWorkspaceId === redisWorkspaceId) {
      return
    }

    const pluginId = activeWorkspaceId.replace('plugin:', '')
    if (!installedPlugins.some((plugin) => plugin.id === pluginId)) {
      setActiveWorkspaceId(databaseWorkspaceId)
    }
  }, [activeWorkspaceId, installedPlugins])

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
    if (visibleHistoryItems.length === 0) {
      setSelectedHistoryId(null)
      return
    }
    if (!visibleHistoryItems.some((item) => item.id === selectedHistoryId)) {
      setSelectedHistoryId(visibleHistoryItems[0].id)
    }
  }, [selectedHistoryId, visibleHistoryItems])

  useEffect(() => {
    if (activeSection !== 'compare_history' || selectedHistoryId == null) {
      return
    }
    if (compareHistoryDetailById[selectedHistoryId]) {
      return
    }

    let cancelled = false
    setHistoryDetailLoadingId(selectedHistoryId)

    void getCompareHistoryDetail(selectedHistoryId)
      .then((detail) => {
        if (cancelled || !detail) {
          return
        }

        setCompareHistoryDetailById((previous) => ({
          ...previous,
          [selectedHistoryId]: detail,
        }))
      })
      .catch((error) => {
        if (!cancelled) {
          pushToast(error instanceof Error ? error.message : '读取对比记录详情失败', 'error')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHistoryDetailLoadingId((previous) =>
            previous === selectedHistoryId ? null : previous,
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeSection, compareHistoryDetailById, selectedHistoryId])

  useEffect(() => {
    if (!outputVisible || !outputBodyRef.current) {
      return
    }

    outputBodyRef.current.scrollTop = outputBodyRef.current.scrollHeight
  }, [outputLogs, outputVisible])

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    const currentCompareId = dataCompareState.result?.compare_id ?? null
    const previousCompareId = activeCompareCacheIdRef.current

    if (previousCompareId && currentCompareId && previousCompareId !== currentCompareId) {
      void cleanupDataCompareCache(previousCompareId)
    }

    activeCompareCacheIdRef.current = currentCompareId
  }, [dataCompareState.result?.compare_id])

  useEffect(() => {
    return () => {
      const compareId = activeCompareCacheIdRef.current
      if (compareId) {
        void cleanupDataCompareCache(compareId)
      }
    }
  }, [])

  useEffect(() => {
    if (!normalizedNavigationSearchText) {
      return
    }

    const connectedProfiles = profiles.filter(
      (profile) => profileConnectionState[profile.id] === 'connected',
    )
    if (connectedProfiles.length === 0) {
      return
    }

    let cancelled = false

    async function warmConnectedDatabaseTables() {
      for (const profile of connectedProfiles) {
        const databases = databasesByProfile[profile.id] ?? []
        for (const database of databases) {
          if (cancelled) {
            return
          }

          const databaseKey = buildDatabaseKey(profile.id, database.name)
          if (tablesByDatabase[databaseKey] || tableLoadRequestsRef.current[databaseKey]) {
            continue
          }

          await ensureTablesLoaded(profile.id, database.name)
        }
      }
    }

    void warmConnectedDatabaseTables()

    return () => {
      cancelled = true
    }
  }, [
    databasesByProfile,
    normalizedNavigationSearchText,
    profileConnectionState,
    profiles,
    tablesByDatabase,
  ])

  function pushToast(message: string, tone: ToastTone) {
    setToasts((previous) => [
      ...previous,
      { id: `${Date.now()}-${previous.length}`, tone, message },
    ])
  }

  async function refreshInstalledPluginState() {
    const plugins = await listInstalledPlugins()
    setInstalledPlugins(plugins)
  }

  async function handleInstallPlugin() {
    setPluginManagerBusy(true)
    try {
      const result = await installPluginFromDisk()
      if (result.canceled || !result.plugin) {
        return
      }

      await refreshInstalledPluginState()
      setActiveWorkspaceId(`plugin:${result.plugin.id}`)
      setWorkspaceMenuOpen(false)
      setPluginManagerVisible(false)
      pushToast(`插件 ${result.plugin.name} 安装成功`, 'success')
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '插件安装失败', 'error')
    } finally {
      setPluginManagerBusy(false)
    }
  }

  async function handleUninstallPlugin(pluginId: string) {
    const plugin = installedPlugins.find((item) => item.id === pluginId)
    setUninstallingPluginId(pluginId)
    try {
      await uninstallPlugin(pluginId)
      await refreshInstalledPluginState()
      if (activeWorkspaceId === `plugin:${pluginId}`) {
        setActiveWorkspaceId(databaseWorkspaceId)
      }
      setWorkspaceMenuOpen(false)
      pushToast(`插件 ${plugin?.name ?? pluginId} 已卸载`, 'success')
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '插件卸载失败', 'error')
    } finally {
      setUninstallingPluginId(null)
    }
  }

  function handleSelectWorkspace(workspaceId: string) {
    setActiveWorkspaceId(workspaceId)
    setWorkspaceMenuOpen(false)
  }

  function handleOpenPluginManager() {
    setWorkspaceMenuOpen(false)
    setPluginManagerVisible(true)
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
    const remaining = tabsRef.current.filter((tab) => tab.id !== tabId)
    setTabs(remaining)
    setActiveTabId((previous) => {
      if (previous !== tabId) {
        return previous
      }
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

  function openGroupAssignmentTab(group: DataSourceGroup) {
    upsertTab({
      id: `group-assignment:${group.id}`,
      kind: 'group_assignment',
      title: `分组归类 · ${group.group_name}`,
      subtitle: '勾选数据源后批量加入当前分组',
      status: 'ready',
      error: '',
      assignment: createGroupAssignmentState(group.id),
    })
  }

  function updateGroupAssignmentFilter(tabId: string, value: string) {
    patchTab(tabId, (tab) =>
      tab.kind === 'group_assignment'
        ? {
            ...tab,
            assignment: {
              ...tab.assignment,
              filter_text: value,
            },
          }
        : tab,
    )
  }

  function toggleGroupAssignmentProfile(tabId: string, profileId: string, checked: boolean) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'group_assignment') {
        return tab
      }

      const selected = new Set(tab.assignment.selected_profile_ids)
      if (checked) {
        selected.add(profileId)
      } else {
        selected.delete(profileId)
      }

      return {
        ...tab,
        assignment: {
          ...tab.assignment,
          selected_profile_ids: Array.from(selected),
        },
      }
    })
  }

  function selectAllGroupAssignmentProfiles(tabId: string, profileIds: string[]) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'group_assignment') {
        return tab
      }

      const selected = new Set(tab.assignment.selected_profile_ids)
      profileIds.forEach((profileId) => selected.add(profileId))
      return {
        ...tab,
        assignment: {
          ...tab.assignment,
          selected_profile_ids: Array.from(selected),
        },
      }
    })
  }

  function clearGroupAssignmentSelection(tabId: string) {
    patchTab(tabId, (tab) =>
      tab.kind === 'group_assignment'
        ? {
            ...tab,
            assignment: {
              ...tab.assignment,
              selected_profile_ids: [],
            },
          }
        : tab,
    )
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
      setCompareHistoryDetailById((previous) => {
        const activeIds = new Set(history.map((item) => item.id))
        return Object.fromEntries(
          Object.entries(previous).filter(([historyId]) => activeIds.has(Number(historyId))),
        )
      })
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
      const response = await waitForCompareTask<DataCompareResponse>({
        compareId: task.compare_id,
        getProgress: getDataCompareTaskProgress,
        getResult: getDataCompareTaskResult,
        onProgress: (progress) => {
          setDataCompareState((previous) => ({
            ...previous,
            task_progress: progress,
          }))
        },
      })
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
        task_progress: null,
      }))

      const task = await startStructureCompareTask(request)
      const response = await waitForCompareTask<StructureCompareResponse>({
        compareId: task.compare_id,
        getProgress: getStructureCompareTaskProgress,
        getResult: getStructureCompareTaskResult,
        onProgress: (progress) => {
          setStructureCompareState((previous) => ({
            ...previous,
            task_progress: progress,
          }))
        },
      })
      if (!response.result) {
        throw new Error(response.error_message ?? '结构对比未返回结果')
      }
      const result = response.result
      const activeCategory = pickFirstStructureCategory(result)

      setStructureCompareState({
        current_step: 2,
        loading: false,
        task_progress: null,
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
      setStructureCompareState((previous) => ({
        ...previous,
        loading: false,
        task_progress: null,
      }))
      pushToast(error instanceof Error ? error.message : '结构对比失败', 'error')
    }
  }

  async function cancelRunningStructureCompare() {
    const compareId = structureCompareState.task_progress?.compare_id
    if (!compareId) {
      return
    }
    try {
      await cancelStructureCompareTask(compareId)
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '取消结构对比失败', 'error')
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

    if (!options?.force && tableLoadRequestsRef.current[databaseKey]) {
      return tableLoadRequestsRef.current[databaseKey]
    }

    setNodeLoading((previous) => ({ ...previous, [databaseKey]: true }))
    const request = (async () => {
      try {
        const tables = await listDatabaseTables(profileId, databaseName)
        setTablesByDatabase((previous) => ({ ...previous, [databaseKey]: tables }))
        return tables
      } catch (error) {
        pushToast(error instanceof Error ? error.message : '读取数据表失败', 'error')
        return []
      } finally {
        delete tableLoadRequestsRef.current[databaseKey]
        setNodeLoading((previous) => ({ ...previous, [databaseKey]: false }))
      }
    })()

    tableLoadRequestsRef.current[databaseKey] = request
    return request
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

  function syncGroupAssignmentTabs(groupId: string, nextGroupName: string | null) {
    setTabs((previous) => {
      if (nextGroupName == null) {
        return previous.filter(
          (tab) => !(tab.kind === 'group_assignment' && tab.assignment.target_group_id === groupId),
        )
      }

      return previous.map((tab) =>
        tab.kind === 'group_assignment' && tab.assignment.target_group_id === groupId
          ? {
              ...tab,
              title: `分组归类 · ${nextGroupName}`,
              subtitle: '勾选数据源后批量加入当前分组',
            }
          : tab,
      )
    })
    setActiveTabId((previous) => {
      if (nextGroupName == null && previous === `group-assignment:${groupId}`) {
        return ''
      }
      return previous
    })
  }

  function applyGroupAssignmentResult(
    result: AssignProfilesToDataSourceGroupResult,
    profileIds: string[],
  ) {
    const profileIdSet = new Set(profileIds)
    setProfiles((previous) =>
      sortProfiles(
        previous.map((profile) =>
          profileIdSet.has(profile.id)
            ? { ...profile, group_name: result.group_name }
            : profile,
        ),
      ),
    )
    setExpandedKeys((previous) => {
      const next = new Set(previous)
      next.add(`group:${normalizeGroupName(result.group_name)}`)
      return next
    })
    setTabs((previous) =>
      previous.map((tab) =>
        tab.kind === 'profile' && profileIdSet.has(tab.editor.form.id ?? '')
          ? {
              ...tab,
              editor: {
                ...tab.editor,
                form: {
                  ...tab.editor.form,
                  group_name: result.group_name,
                },
              },
            }
          : tab,
      ),
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
      syncGroupAssignmentTabs(groupId, result.group_name)
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
      syncGroupAssignmentTabs(group.id, null)
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

  async function applyProfilesToGroup(tab: GroupAssignmentTab) {
    const targetGroup = dataSourceGroups.find(
      (group) => group.id === tab.assignment.target_group_id,
    )
    if (!targetGroup) {
      pushToast('目标分组不存在', 'error')
      removeTab(tab.id)
      return
    }

    if (tab.assignment.selected_profile_ids.length === 0) {
      pushToast('请先勾选要加入分组的数据源', 'info')
      return
    }

    patchTab(tab.id, (currentTab) =>
      currentTab.kind === 'group_assignment'
        ? {
            ...currentTab,
            status: 'busy',
            error: '',
            assignment: {
              ...currentTab.assignment,
              submitting: true,
            },
          }
        : currentTab,
    )

    try {
      const result = await assignProfilesToDataSourceGroup({
        group_id: tab.assignment.target_group_id,
        profile_ids: tab.assignment.selected_profile_ids,
      })
      applyGroupAssignmentResult(result, tab.assignment.selected_profile_ids)
      patchTab(tab.id, (currentTab) =>
        currentTab.kind === 'group_assignment'
          ? {
              ...currentTab,
              status: 'ready',
              error: '',
              assignment: {
                ...currentTab.assignment,
                selected_profile_ids: [],
                submitting: false,
              },
            }
          : currentTab,
      )
      pushToast(
        `已将 ${result.affected_profile_count} 个数据源加入“${result.group_name}”`,
        'success',
      )
    } catch (error) {
      patchTab(tab.id, (currentTab) =>
        currentTab.kind === 'group_assignment'
          ? {
              ...currentTab,
              status: 'ready',
              error: error instanceof Error ? error.message : '批量设置分组失败',
              assignment: {
                ...currentTab.assignment,
                submitting: false,
              },
            }
          : currentTab,
      )
      pushToast(error instanceof Error ? error.message : '批量设置分组失败', 'error')
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

  function buildExportRows(rows: DataGridRow[], options?: { selected_only?: boolean }) {
    return rows
      .filter((row) => {
        if (row.state === 'deleted') {
          return false
        }
        return options?.selected_only ? row.selected : true
      })
      .map<TableDataRow>((row) => ({
        row_key: row.row_key ? { ...row.row_key } : null,
        values: { ...row.values },
      }))
  }

  function openDataExportDialog(tab: DataTab) {
    const rows = buildExportRows(tab.data.rows)
    const selectedRows = buildExportRows(tab.data.rows, { selected_only: true })

    setExportDialog({
      kind: 'table_data',
      title: '导出表数据',
      subtitle: `${tab.database_name}.${tab.table_name}`,
      busy: false,
      format: 'csv',
      scope:
        selectedRows.length > 0 ? 'selected_rows' : rows.length > 0 ? 'current_page' : 'all_rows',
      columns: tab.data.columns.map((column) => ({ ...column })),
      rows,
      selected_rows: selectedRows,
      load_payload: {
        profile_id: tab.profile_id,
        database_name: tab.database_name,
        table_name: tab.table_name,
        where_clause: tab.data.where_clause,
        order_by_clause: tab.data.order_by_clause,
        offset: tab.data.offset,
        limit: tab.data.limit,
      },
    })
  }

  function openTableExportDialog(
    profileId: string,
    databaseName: string,
    tableName: string,
  ) {
    const currentTab = tabs.find(
      (tab) =>
        tab.kind === 'data' &&
        tab.profile_id === profileId &&
        tab.database_name === databaseName &&
        tab.table_name === tableName,
    )

    if (currentTab?.kind === 'data') {
      openDataExportDialog(currentTab)
      return
    }

    setExportDialog({
      kind: 'table_data',
      title: '导出表数据',
      subtitle: `${databaseName}.${tableName}`,
      busy: false,
      format: 'csv',
      scope: 'all_rows',
      columns: [],
      rows: [],
      selected_rows: [],
      load_payload: {
        profile_id: profileId,
        database_name: databaseName,
        table_name: tableName,
        where_clause: '',
        order_by_clause: '',
      },
    })
  }

  function openQueryResultExportDialog(tab: ConsoleTab) {
    if (tab.console.columns.length === 0) {
      pushToast('当前没有可导出的查询结果', 'info')
      return
    }

    const executedSql = (tab.console.executed_sql || tab.console.sql).trim()
    if (!executedSql) {
      pushToast('请先执行查询后再导出结果', 'info')
      return
    }

    const rows = buildExportRows(tab.console.rows)
    const selectedRows = buildExportRows(tab.console.rows, { selected_only: true })

    setExportDialog({
      kind: 'query_result',
      title: '导出查询结果',
      subtitle: tab.subtitle,
      busy: false,
      format: 'csv',
      scope: selectedRows.length > 0 ? 'selected_rows' : 'current_page',
      columns: tab.console.columns.map((column) => ({ ...column })),
      rows,
      selected_rows: selectedRows,
      execute_payload: {
        profile_id: tab.profile_id,
        database_name: tab.database_name,
        sql: executedSql,
        offset: tab.console.offset,
        limit: tab.console.limit,
      },
    })
  }

  function updateExportDialogScope(scope: ExportScope) {
    setExportDialog((previous) => (previous ? { ...previous, scope } : previous))
  }

  function updateExportDialogFormat(format: ExportFileFormat) {
    setExportDialog((previous) => (previous ? { ...previous, format } : previous))
  }

  async function confirmExportDialog() {
    if (!exportDialog) {
      return
    }

    setExportDialog((previous) => (previous ? { ...previous, busy: true } : previous))

    try {
      const saveTarget = await chooseExportPath({
        default_file_name:
          exportDialog.kind === 'table_data'
            ? buildTableDataExportFileName(
                exportDialog.load_payload.database_name,
                exportDialog.load_payload.table_name,
                exportDialog.format,
              )
            : buildQueryResultExportFileName(
                exportDialog.execute_payload.database_name ?? null,
                exportDialog.format,
              ),
        filters: [
          {
            name: exportDialog.format.toUpperCase(),
            extensions: [exportDialog.format],
          },
        ],
      })

      if (saveTarget.canceled || !saveTarget.file_path) {
        setExportDialog((previous) => (previous ? { ...previous, busy: false } : previous))
        return
      }

      const rows =
        exportDialog.scope === 'selected_rows' ? exportDialog.selected_rows : exportDialog.rows

      const result =
        exportDialog.kind === 'table_data'
          ? await exportTableDataFile({
              load_payload: exportDialog.load_payload,
              file_path: saveTarget.file_path,
              export_format: exportDialog.format,
              scope: exportDialog.scope,
              columns: exportDialog.columns,
              rows,
            })
          : await exportQueryResultFile({
              execute_payload: exportDialog.execute_payload,
              file_path: saveTarget.file_path,
              export_format: exportDialog.format,
              scope: exportDialog.scope,
              columns: exportDialog.columns,
              rows,
            })

      const scopeLabel = getExportScopeText(exportDialog)
      pushToast(`${exportDialog.title}已完成`, 'success')
      appendOutputLog(
        exportDialog.title,
        `已导出 ${result.row_count} 行到 ${result.file_path}（${result.export_format.toUpperCase()}，${scopeLabel}）`,
        'success',
      )
      setExportDialog(null)
    } catch (error) {
      setExportDialog((previous) => (previous ? { ...previous, busy: false } : previous))
      pushToast(error instanceof Error ? error.message : '导出失败', 'error')
    }
  }

  async function copyExportDialogSql() {
    if (!exportDialog || exportDialog.format !== 'sql') {
      return
    }

    setExportDialog((previous) => (previous ? { ...previous, busy: true } : previous))

    try {
      const rows =
        exportDialog.scope === 'selected_rows' ? exportDialog.selected_rows : exportDialog.rows

      const result =
        exportDialog.kind === 'table_data'
          ? await exportTableDataSqlText({
              load_payload: exportDialog.load_payload,
              scope: exportDialog.scope,
              columns: exportDialog.columns,
              rows,
            })
          : await exportQueryResultSqlText({
              execute_payload: exportDialog.execute_payload,
              scope: exportDialog.scope,
              columns: exportDialog.columns,
              rows,
            })

      await copyTextToClipboard(result.content)

      const scopeLabel = getExportScopeText(exportDialog)
      pushToast('SQL 已复制到剪贴板', 'success')
      appendOutputLog(
        exportDialog.title,
        `已复制 ${result.row_count} 行对应的 SQL 到剪贴板（${scopeLabel}）`,
        'success',
      )
      setExportDialog(null)
    } catch (error) {
      setExportDialog((previous) => (previous ? { ...previous, busy: false } : previous))
      pushToast(error instanceof Error ? error.message : '复制 SQL 失败', 'error')
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

  function selectConsoleRowsRange(
    tabId: string,
    startClientId: string,
    endClientId: string,
    options?: { append?: boolean },
  ) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'console') {
        return tab
      }

      const startIndex = tab.console.rows.findIndex((row) => row.client_id === startClientId)
      const endIndex = tab.console.rows.findIndex((row) => row.client_id === endClientId)
      if (startIndex === -1 || endIndex === -1) {
        return tab
      }

      const rangeStart = Math.min(startIndex, endIndex)
      const rangeEnd = Math.max(startIndex, endIndex)
      return {
        ...tab,
        console: {
          ...tab.console,
          rows: tab.console.rows.map((row, index) => {
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
  const activeConsoleSchemas = useMemo(
    () =>
      activeTab?.kind === 'console'
        ? Object.entries(sqlAutocompleteByDatabase)
            .filter(([key]) => key.startsWith(`${activeTab.profile_id}:`))
            .map(([, schema]) => schema)
        : [],
    [activeTab, sqlAutocompleteByDatabase],
  )
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
  const dataSourceTreeGroups = useMemo(
    () => buildDataSourceTreeGroups(dataSourceGroups, profiles),
    [dataSourceGroups, profiles],
  )
  const connectedProfileIds = useMemo(
    () =>
      new Set(
        profiles
          .filter((profile) => profileConnectionState[profile.id] === 'connected')
          .map((profile) => profile.id),
      ),
    [profileConnectionState, profiles],
  )
  const navigationTreeGroups = useMemo(
    () =>
      buildNavigationTreeGroups(dataSourceTreeGroups, {
        search_keyword: normalizedNavigationSearchText,
        connected_profile_ids: connectedProfileIds,
        databases_by_profile: databasesByProfile,
        tables_by_database: tablesByDatabase,
      }),
    [
      connectedProfileIds,
      dataSourceTreeGroups,
      databasesByProfile,
      normalizedNavigationSearchText,
      tablesByDatabase,
    ],
  )
  const visibleExpandedKeys = useMemo(() => {
    if (!normalizedNavigationSearchText) {
      return expandedKeys
    }

    const next = new Set(expandedKeys)
    navigationTreeGroups.forEach((group) => {
      next.add(group.key)
      group.profiles.forEach((profileView) => {
        if (profileView.matched_by_name || profileView.databases.length > 0) {
          next.add(`profile:${profileView.entry.id}`)
        }

        profileView.databases.forEach((databaseView) => {
          if (databaseView.tables.length > 0) {
            next.add(`database:${buildDatabaseKey(profileView.entry.id, databaseView.entry.name)}`)
          }
        })
      })
    })

    return next
  }, [expandedKeys, navigationTreeGroups, normalizedNavigationSearchText])
  const filteredDataCompareTables = useMemo(() => {
    const commonTables = dataCompareState.discovery?.common_tables
    if (!commonTables) {
      return []
    }

    const normalizedFilter = dataCompareState.table_filter.trim().toLowerCase()
    if (!normalizedFilter) {
      return commonTables
    }

    return commonTables.filter((tableName) =>
      tableName.toLowerCase().includes(normalizedFilter),
    )
  }, [dataCompareState.discovery?.common_tables, dataCompareState.table_filter])
  const selectedHistorySummary = useMemo(
    () =>
      visibleHistoryItems.find((item) => item.id === selectedHistoryId) ??
      visibleHistoryItems[0] ??
      null,
    [selectedHistoryId, visibleHistoryItems],
  )
  const selectedHistoryItem =
    selectedHistorySummary ? compareHistoryDetailById[selectedHistorySummary.id] ?? null : null
  const workspaceOptions = useMemo(
    () => [
      { id: databaseWorkspaceId, label: 'MySQL客户端' },
      { id: redisWorkspaceId, label: 'Redis客户端' },
      ...installedPlugins.map((plugin) => ({
        id: `plugin:${plugin.id}`,
        label: plugin.name,
      })),
    ],
    [installedPlugins],
  )
  const activeWorkspaceLabel =
    workspaceOptions.find((workspace) => workspace.id === activeWorkspaceId)?.label ??
    'MySQL客户端'
  const activePlugin = useMemo(() => {
    if (!activeWorkspaceId.startsWith('plugin:')) {
      return null
    }

    return (
      installedPlugins.find(
        (plugin) => plugin.id === activeWorkspaceId.replace('plugin:', ''),
      ) ?? null
    )
  }, [activeWorkspaceId, installedPlugins])
  const cpuText =
    runtimeMetrics == null ? '--' : `${runtimeMetrics.cpu_percent.toFixed(1)}%`
  const memoryText =
    runtimeMetrics == null ? '--' : `${Math.max(0, Math.round(runtimeMetrics.memory_mb))} MB`
  const panelToggleItems: Array<{
    key: WorkspacePanelKey
    label: string
    active: boolean
    onClick: () => void
  }> = [
    {
      key: 'left',
      label: '左侧栏',
      active: leftPanelVisible,
      onClick: () => setLeftPanelVisible((previous) => !previous),
    },
    {
      key: 'right',
      label: '右侧栏',
      active: rightPanelVisible,
      onClick: () => setRightPanelVisible((previous) => !previous),
    },
    {
      key: 'bottom',
      label: '底部栏',
      active: outputVisible,
      onClick: () => setOutputVisible((previous) => !previous),
    },
  ]

  return (
    <main
      className="app-shell"
      onClick={() => {
        setTreeContextMenu(null)
        setWorkspaceMenuOpen(false)
      }}
    >
      <section className="workspace-shell">
        <header className="window-bar">
          <div className="window-bar-drag" data-tauri-drag-region></div>
          <div className="window-bar-content">
            <WorkspaceSwitcher
              activeWorkspaceId={activeWorkspaceId}
              activeWorkspaceLabel={activeWorkspaceLabel}
              databaseWorkspaceId={databaseWorkspaceId}
              installedPlugins={installedPlugins}
              onManagePlugins={handleOpenPluginManager}
              onSelectWorkspace={handleSelectWorkspace}
              onToggleMenu={() => setWorkspaceMenuOpen((previous) => !previous)}
              redisWorkspaceId={redisWorkspaceId}
              workspaceMenuOpen={workspaceMenuOpen}
            />
            <div className="window-bar-center" aria-label="布局面板开关">
              <div className="panel-visibility-group">
                {panelToggleItems.map((item) => (
                  <button
                    key={item.key}
                    className={`panel-visibility-button ${item.active ? 'active' : ''}`}
                    type="button"
                    onClick={item.onClick}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="window-bar-metrics" aria-label="运行指标">
              <div className="window-metric-chip">
                <span className="window-metric-label">CPU</span>
                <strong>{cpuText}</strong>
              </div>
              <div className="window-metric-chip">
                <span className="window-metric-label">内存</span>
                <strong>{memoryText}</strong>
              </div>
            </div>
          </div>
        </header>

        {activePlugin ? (
          <section className="plugin-full-pane">
            <PluginWorkspace plugin={activePlugin} />
          </section>
        ) : activeWorkspaceId === redisWorkspaceId ? (
          <section className="redis-full-pane">
            <Suspense
              fallback={
                <WorkspaceLoadingState
                  title="Redis客户端准备中"
                  text="正在挂载 Redis 内置工作区。"
                />
              }
            >
              <RedisWorkspace />
            </Suspense>
          </section>
        ) : (
        <div className="workspace-layout">
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

          <div className="workspace-main-shell">
            <div className="workspace-main-row">
              {leftPanelVisible ? (
                <aside className="workspace-side-dock workspace-side-dock-left">
                  <div className="navigation-pane">
                    {activeSection === 'datasource' ? (
                    <>
                    <div className="pane-header">
                      <div className="pane-title">
                        <DatabaseGlyph />
                        <strong>数据库导航</strong>
                      </div>

                      <div className="navigation-search-card">
                        <input
                          value={navigationSearchText}
                          onChange={(event) => setNavigationSearchText(event.target.value)}
                          placeholder="搜索连接名、数据库、表"
                        />
                        <small>数据库与表仅搜索已连接的数据源，表结果会逐步补齐。</small>
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
                      </div>
                    </div>

                    <div className="tree-pane">
                      {bootstrapError ? (
                        <EmptyNotice title="初始化失败" text={bootstrapError} />
                      ) : null}

                      {!bootstrapError && profiles.length === 0 && dataSourceGroups.length === 0 ? (
                        <EmptyNotice
                          title="暂无数据源"
                          text="点击左上角加号，在右侧工作区创建新的 MySQL 数据源。"
                        />
                      ) : null}

                      {!bootstrapError &&
                      navigationSearchText.trim() &&
                      navigationTreeGroups.length === 0 ? (
                        <EmptyNotice
                          title="未找到匹配项"
                          text="连接名可直接搜索；数据库和表仅在已连接的数据源中检索。"
                        />
                      ) : null}

                      {navigationTreeGroups.map((group) => {
                        const expanded = visibleExpandedKeys.has(group.key)

                        return (
                          <div className="tree-group" key={group.key}>
                            <button
                              className={`tree-row group-row ${selectedGroupKey === group.key ? 'selected' : ''}`}
                              type="button"
                              onClick={() => {
                                setSelectedGroupKey(group.key)
                                setSelection({ kind: 'none' })
                                setTreeContextMenu(null)
                              }}
                              onDoubleClick={() => void toggleNodeExpansion(group.key)}
                              onContextMenu={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                if (!group.group_id) {
                                  return
                                }

                                setSelectedGroupKey(group.key)
                                setSelection({ kind: 'none' })
                                setTreeContextMenu({
                                  kind: 'group',
                                  x: Math.min(event.clientX, window.innerWidth - 208),
                                  y: Math.min(event.clientY, window.innerHeight - 92),
                                  group_id: group.group_id,
                                  group_name: group.group_name,
                                })
                              }}
                            >
                              <span className="tree-caret">{expanded ? '▾' : '▸'}</span>
                              <span className="tree-node-label">{group.group_name}</span>
                              <span className="tree-node-meta">{group.profiles.length} 个数据源</span>
                            </button>

                            {expanded ? (
                              <div className="tree-children">
                                {group.profiles.length === 0 ? (
                                  <div className="tree-empty-note">暂无数据源</div>
                                ) : null}

                                {group.profiles.map((profileView) => {
                                  const profile = profileView.entry
                                  const datasourceKey = `profile:${profile.id}`
                                  const datasourceExpanded = visibleExpandedKeys.has(datasourceKey)
                                  const databases = profileView.databases

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
                                          setExpandedKeys((previous) =>
                                            expandAncestorsForProfile(previous, profile),
                                          )
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
                                              ? `${(databasesByProfile[profile.id] ?? []).length} 个数据库`
                                              : '待加载'}
                                        </span>
                                      </button>

                                      {datasourceExpanded ? (
                                        <div className="tree-children">
                                          {databases.map((databaseView) => {
                                            const database = databaseView.entry
                                            const databaseKey = buildDatabaseKey(
                                              profile.id,
                                              database.name,
                                            )
                                            const databaseNodeKey = `database:${databaseKey}`
                                            const databaseExpanded =
                                              visibleExpandedKeys.has(databaseNodeKey)
                                            const tables = databaseView.tables

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
                                                    setExpandedKeys((previous) =>
                                                      expandAncestorsForProfileNode(
                                                        previous,
                                                        profile,
                                                      ),
                                                    )
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
                                                    {navigationSearchText.trim() && tables.length > 0
                                                      ? `${tables.length} 个匹配表`
                                                      : nodeLoading[databaseKey] &&
                                                          !tablesByDatabase[databaseKey]
                                                        ? '搜索中'
                                                        : `${database.table_count} 张表`}
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
                                                          selection.table_name === table.entry.name
                                                            ? 'selected'
                                                            : ''
                                                        }`}
                                                        key={`${databaseKey}:${table.entry.name}`}
                                                        type="button"
                                                        onClick={() => {
                                                          selectTable(
                                                            profile.id,
                                                            database.name,
                                                            table.entry.name,
                                                          )
                                                          setExpandedKeys((previous) =>
                                                            expandAncestorsForTable(
                                                              previous,
                                                              profile,
                                                              database.name,
                                                            ),
                                                          )
                                                        }}
                                                        onDoubleClick={() => {
                                                          selectTable(
                                                            profile.id,
                                                            database.name,
                                                            table.entry.name,
                                                          )
                                                          void openTableTab(
                                                            'data',
                                                            profile.id,
                                                            database.name,
                                                            table.entry.name,
                                                          )
                                                        }}
                                                        onContextMenu={(event) => {
                                                          event.preventDefault()
                                                          event.stopPropagation()
                                                          selectTable(
                                                            profile.id,
                                                            database.name,
                                                            table.entry.name,
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
                                                            table_name: table.entry.name,
                                                          })
                                                        }}
                                                      >
                                                        <TreeTableGlyph />
                                                        <span className="tree-node-label">
                                                          {table.entry.name}
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
                      <WorkspacePanelPlaceholder
                        title="左侧面板"
                        description="这里预留为数据对比的筛选、目录或资源树区域，当前先完成可展示与隐藏的骨架。"
                        tone="accent"
                      />
                    ) : activeSection === 'structure_compare' ? (
                      <WorkspacePanelPlaceholder
                        title="左侧面板"
                        description="这里预留为结构对比的筛选、分类或导航区域，当前先完成可展示与隐藏的骨架。"
                        tone="accent"
                      />
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
                  </div>
                </aside>
              ) : null}

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
                <Suspense
                  fallback={
                    <WorkspaceLoadingState
                      title="正在加载数据表工作区"
                      text="正在初始化表数据编辑器。"
                    />
                  }
                >
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
                    onExport={() => openDataExportDialog(activeTab)}
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
                </Suspense>
              ) : null}

              {activeTab?.kind === 'console' ? (
                <Suspense
                  fallback={
                    <WorkspaceLoadingState
                      title="正在加载 SQL 控制台"
                      text="正在准备编辑器和结果面板。"
                    />
                  }
                >
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
                    onExport={() => openQueryResultExportDialog(activeTab)}
                    onFirstPage={() => void changeConsolePage(activeTab, 'first')}
                    onPrevPage={() => void changeConsolePage(activeTab, 'prev')}
                    onNextPage={() => void changeConsolePage(activeTab, 'next')}
                    onLastPage={() => void changeConsolePage(activeTab, 'last')}
                    onSelectRowsRange={(startClientId, endClientId, options) =>
                      selectConsoleRowsRange(activeTab.id, startClientId, endClientId, options)
                    }
                  />
                </Suspense>
              ) : null}

              {activeTab?.kind === 'group_assignment' ? (
                <GroupAssignmentView
                  tab={activeTab}
                  profiles={profiles}
                  dataSourceGroups={dataSourceGroups}
                  onFilterChange={updateGroupAssignmentFilter}
                  onToggleProfile={toggleGroupAssignmentProfile}
                  onSelectAll={selectAllGroupAssignmentProfiles}
                  onClearSelection={clearGroupAssignmentSelection}
                  onApply={applyProfilesToGroup}
                />
              ) : null}

              {!activeTab ? <EmptyWorkspace /> : null}
            </div>
            </>
            ) : activeSection === 'data_compare' ? (
              <Suspense
                fallback={
                  <WorkspaceLoadingState
                    title="正在加载数据对比"
                    text="正在准备对比流程与结果面板。"
                  />
                }
              >
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
              </Suspense>
            ) : activeSection === 'structure_compare' ? (
              <Suspense
                fallback={
                  <WorkspaceLoadingState
                    title="正在加载结构对比"
                    text="正在准备结构差异筛选与详情面板。"
                  />
                }
              >
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
                  onCancelCompare={() => void cancelRunningStructureCompare()}
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
              </Suspense>
            ) : (
              <Suspense
                fallback={
                  <WorkspaceLoadingState
                    title="正在加载对比记录"
                    text="正在读取记录视图。"
                  />
                }
              >
                <CompareHistoryWorkspace
                  historyItems={visibleHistoryItems}
                  selectedHistoryItem={selectedHistoryItem}
                  selectedHistorySummary={selectedHistorySummary}
                  loadingHistoryDetail={historyDetailLoadingId === selectedHistorySummary?.id}
                  historyType={compareHistoryType}
                  onSelect={(historyId) => setSelectedHistoryId(historyId)}
                />
              </Suspense>
            )}
              </section>

              {rightPanelVisible ? (
                <aside className="workspace-side-dock workspace-side-dock-right">
                  <WorkspacePanelPlaceholder
                    title="右侧面板"
                    description="这里预留为属性、结果摘要或辅助信息区域，当前先完成可展示与隐藏的布局行为。"
                  />
                </aside>
              ) : null}
            </div>

            {outputVisible ? (
              <section className="workspace-bottom-dock">
                {activeSection === 'datasource' ? (
                  <OutputDock
                    logs={outputLogs}
                    outputBodyRef={outputBodyRef}
                    onClear={() => setOutputLogs([])}
                  />
                ) : (
                  <WorkspacePanelPlaceholder
                    title="底部面板"
                    description="这里预留为日志、问题、结果或终端区域，当前先完成可展示与隐藏的布局行为。"
                  />
                )}
              </section>
            ) : null}
          </div>
        </div>
        )}
      </section>

      {pluginManagerVisible ? (
        <PluginManagerModal
          currentPlatform={currentPlatform}
          installedPlugins={installedPlugins}
          packageExtension={pluginPackageExtension}
          selectedWorkspaceId={activeWorkspaceId}
          busy={pluginManagerBusy}
          uninstallingPluginId={uninstallingPluginId}
          onClose={() => setPluginManagerVisible(false)}
          onInstall={handleInstallPlugin}
          onOpenPlugin={(pluginId) => {
            setActiveWorkspaceId(`plugin:${pluginId}`)
            setPluginManagerVisible(false)
          }}
          onUninstallPlugin={handleUninstallPlugin}
        />
      ) : null}

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

      {exportDialog ? (
        <Modal
          title={exportDialog.title}
          subtitle={exportDialog.subtitle}
          onClose={() => {
            if (!exportDialog.busy) {
              setExportDialog(null)
            }
          }}
          actions={
            <>
              <button
                className="flat-button"
                disabled={exportDialog.busy}
                type="button"
                onClick={() => setExportDialog(null)}
              >
                取消
              </button>
              {exportDialog.format === 'sql' ? (
                <button
                  className="flat-button"
                  disabled={exportDialog.busy}
                  type="button"
                  onClick={() => void copyExportDialogSql()}
                >
                  {exportDialog.busy ? '处理中...' : '复制到剪贴板'}
                </button>
              ) : null}
              <button
                className="flat-button primary"
                disabled={exportDialog.busy}
                type="button"
                onClick={() => void confirmExportDialog()}
              >
                {exportDialog.busy ? '处理中...' : '下载文件'}
              </button>
            </>
          }
        >
          <div className="form-card compact-form-card export-dialog-card">
            <label className="form-item">
              <span>导出格式</span>
              <select
                value={exportDialog.format}
                disabled={exportDialog.busy}
                onChange={(event) =>
                  updateExportDialogFormat(event.target.value as ExportFileFormat)
                }
              >
                <option value="csv">CSV</option>
                <option value="sql">SQL</option>
                {exportDialog.kind === 'query_result' ? (
                  <option value="json">JSON</option>
                ) : null}
              </select>
            </label>

            <div className="form-item">
              <span>导出范围</span>
              <div className="export-scope-list">
                {getExportScopeOptions(exportDialog).map((option) => (
                  <label
                    className={`export-scope-item ${option.disabled ? 'disabled' : ''}`}
                    key={option.value}
                  >
                    <input
                      checked={exportDialog.scope === option.value}
                      disabled={exportDialog.busy || option.disabled}
                      name="export_scope"
                      type="radio"
                      value={option.value}
                      onChange={() => updateExportDialogScope(option.value)}
                    />
                    <div className="export-scope-copy">
                      <strong>{option.label}</strong>
                      <p>{option.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="status-panel export-summary">
              当前将以 {exportDialog.format.toUpperCase()} 格式导出
              {getExportScopeText(exportDialog)}。
              {exportDialog.format === 'sql'
                ? ' 可直接下载文件，也可复制到剪贴板。'
                : null}
            </div>
          </div>
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
          {treeContextMenu.kind === 'group' ? (
            <button
              className="context-menu-item"
              type="button"
              onClick={() => {
                const targetGroup = dataSourceGroups.find(
                  (group) => group.id === treeContextMenu.group_id,
                )
                if (targetGroup) {
                  openGroupAssignmentTab(targetGroup)
                } else {
                  pushToast('目标分组不存在', 'error')
                }
                setTreeContextMenu(null)
              }}
            >
              添加数据源到分组
            </button>
          ) : null}

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
                  openTableExportDialog(
                    treeContextMenu.profile_id,
                    treeContextMenu.database_name,
                    treeContextMenu.table_name,
                  )
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

function GroupAssignmentView({
  tab,
  profiles,
  dataSourceGroups,
  onFilterChange,
  onToggleProfile,
  onSelectAll,
  onClearSelection,
  onApply,
}: {
  tab: GroupAssignmentTab
  profiles: ConnectionProfile[]
  dataSourceGroups: DataSourceGroup[]
  onFilterChange: (tabId: string, value: string) => void
  onToggleProfile: (tabId: string, profileId: string, checked: boolean) => void
  onSelectAll: (tabId: string, profileIds: string[]) => void
  onClearSelection: (tabId: string) => void
  onApply: (tab: GroupAssignmentTab) => Promise<void>
}) {
  const targetGroup =
    dataSourceGroups.find((group) => group.id === tab.assignment.target_group_id) ?? null
  const selectedProfileIdSet = new Set(tab.assignment.selected_profile_ids)
  const validSelectedCount = profiles.filter((profile) =>
    selectedProfileIdSet.has(profile.id),
  ).length
  const filterText = tab.assignment.filter_text.trim().toLowerCase()
  const filteredProfiles = profiles.filter((profile) => {
    if (!filterText) {
      return true
    }

    const currentGroupName = normalizeGroupName(profile.group_name)
    return [
      profile.data_source_name,
      profile.host,
      `${profile.host}:${profile.port}`,
      currentGroupName,
    ].some((value) => value.toLowerCase().includes(filterText))
  })
  const filteredProfileIds = filteredProfiles.map((profile) => profile.id)
  const allFilteredSelected =
    filteredProfiles.length > 0 &&
    filteredProfiles.every((profile) => selectedProfileIdSet.has(profile.id))

  return (
    <div className="editor-page group-assignment-page">
      <div className="editor-header">
        <div>
          <strong>{targetGroup ? `添加数据源到 ${targetGroup.group_name} 分组` : '分组归类'}</strong>
          <p>
            右侧展示全部数据源和当前所属分组。勾选后可一次性加入当前目标分组。
          </p>
        </div>

        <div className="editor-actions">
          <button
            className="flat-button"
            disabled={filteredProfiles.length === 0 || allFilteredSelected || tab.assignment.submitting}
            type="button"
            onClick={() => onSelectAll(tab.id, filteredProfileIds)}
          >
            全选当前列表
          </button>
          <button
            className="flat-button"
            disabled={validSelectedCount === 0 || tab.assignment.submitting}
            type="button"
            onClick={() => onClearSelection(tab.id)}
          >
            清空选择
          </button>
        </div>
      </div>

      <div className="form-card">
        <div className="group-assignment-toolbar">
          <label className="form-item">
            <span>筛选数据源</span>
            <input
              value={tab.assignment.filter_text}
              onChange={(event) => onFilterChange(tab.id, event.target.value)}
              placeholder="按数据源名称、主机或当前分组筛选"
            />
          </label>

          <div className="group-assignment-summary">
            <span>目标分组</span>
            <strong>{targetGroup?.group_name ?? '分组不存在'}</strong>
            <small>当前共 {profiles.length} 个数据源，已选择 {validSelectedCount} 个</small>
          </div>
        </div>
      </div>

      {tab.error ? <div className="status-panel warning">{tab.error}</div> : null}

      <div className="form-card group-assignment-card">
        <div className="group-assignment-list">
          {filteredProfiles.length === 0 ? (
            <div className="group-manager-empty">暂无匹配的数据源。</div>
          ) : (
            filteredProfiles.map((profile) => {
              const checked = selectedProfileIdSet.has(profile.id)

              return (
                <label
                  className={`group-assignment-row ${checked ? 'selected' : ''}`}
                  key={profile.id}
                >
                  <input
                    checked={checked}
                    disabled={tab.assignment.submitting}
                    type="checkbox"
                    onChange={(event) =>
                      onToggleProfile(tab.id, profile.id, event.target.checked)
                    }
                  />

                  <div className="group-assignment-main">
                    <strong>{profile.data_source_name}</strong>
                    <span>
                      {profile.host}:{profile.port}
                    </span>
                  </div>

                  <div className="group-assignment-meta">
                    <span>当前分组</span>
                    <strong>{normalizeGroupName(profile.group_name)}</strong>
                  </div>
                </label>
              )
            })
          )}
        </div>

        <div className="group-assignment-footer">
          <span>勾选后会覆盖所选数据源原有的分组归属。</span>
          <button
            className="flat-button primary"
            disabled={!targetGroup || validSelectedCount === 0 || tab.assignment.submitting}
            type="button"
            onClick={() => void onApply(tab)}
          >
            {tab.assignment.submitting
              ? '处理中...'
              : `添加 ${validSelectedCount} 个数据源到 ${targetGroup?.group_name ?? ''} 分组`}
          </button>
        </div>
      </div>
    </div>
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
              placeholder={
                tab.editor.mode === 'edit' ? '留空表示保持当前密码' : '请输入密码'
              }
            />
            <small className="form-hint">
              {tab.editor.mode === 'edit'
                ? '编辑已有数据源时，留空会继续使用本地已保存密码；只有输入新值时才会更新。'
                : '首次保存时必须输入密码。'}
            </small>
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

function WorkspacePanelPlaceholder({
  title,
  description,
  tone = 'default',
}: {
  title: string
  description: string
  tone?: 'default' | 'accent'
}) {
  return (
    <div className={`workspace-panel-placeholder workspace-panel-placeholder-${tone}`}>
      <div className="workspace-panel-placeholder-badge">Layout</div>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  )
}

function EmptyWorkspace() {
  return <div className="empty-workspace" />
}

function WorkspaceLoadingState({
  title,
  text,
}: {
  title: string
  text: string
}) {
  return (
    <div className="empty-workspace">
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

function buildDataSourceTreeGroups(
  groups: DataSourceGroup[],
  profiles: ConnectionProfile[],
): DataSourceTreeGroup[] {
  const profilesByGroup = new Map<string, ConnectionProfile[]>()

  profiles.forEach((profile) => {
    const groupName = normalizeGroupName(profile.group_name)
    if (!profilesByGroup.has(groupName)) {
      profilesByGroup.set(groupName, [])
    }
    profilesByGroup.get(groupName)!.push(profile)
  })

  const treeGroups = sortDataSourceGroups(groups).map((group) => {
    const groupName = normalizeGroupName(group.group_name)
    const groupProfiles = profilesByGroup.get(groupName) ?? []
    profilesByGroup.delete(groupName)

    return {
      key: `group:${groupName}`,
      group_id: group.id,
      group_name: group.group_name,
      profiles: groupProfiles,
    }
  })

  const leftoverGroups = Array.from(profilesByGroup.entries())
    .sort(([left], [right]) => compareGroupName(left, right))
    .map(([groupName, groupProfiles]) => ({
      key: `group:${groupName}`,
      group_id: null,
      group_name: groupName,
      profiles: groupProfiles,
    }))

  return [...treeGroups, ...leftoverGroups]
}

function buildNavigationTreeGroups(
  groups: DataSourceTreeGroup[],
  options: {
    search_keyword: string
    connected_profile_ids: Set<string>
    databases_by_profile: Record<string, DatabaseEntry[]>
    tables_by_database: Record<string, TableEntry[]>
  },
): NavigationTreeGroup[] {
  const {
    search_keyword: searchKeyword,
    connected_profile_ids: connectedProfileIds,
    databases_by_profile: databasesByProfile,
    tables_by_database: tablesByDatabase,
  } = options

  return groups
    .map((group) => {
      const profiles = group.profiles
        .map((profile) => {
          const matchedByName = searchKeyword
            ? matchesNavigationSearch(profile.data_source_name, searchKeyword)
            : false
          const shouldSearchDatabases = searchKeyword
            ? connectedProfileIds.has(profile.id)
            : true

          const visibleDatabases = shouldSearchDatabases
            ? (databasesByProfile[profile.id] ?? [])
                .map((database) => {
                  const matchedDatabase = searchKeyword
                    ? matchesNavigationSearch(database.name, searchKeyword)
                    : false
                  const databaseKey = buildDatabaseKey(profile.id, database.name)
                  const visibleTables = searchKeyword
                    ? (tablesByDatabase[databaseKey] ?? [])
                        .filter((table) => matchesNavigationSearch(table.name, searchKeyword))
                        .map((table) => ({ entry: table }))
                    : (tablesByDatabase[databaseKey] ?? []).map((table) => ({ entry: table }))

                  if (searchKeyword && !matchedDatabase && visibleTables.length === 0) {
                    return null
                  }

                  return {
                    entry: database,
                    matched_by_name: matchedDatabase,
                    tables: visibleTables,
                  }
                })
                .filter((database): database is NavigationTreeDatabase => database !== null)
            : []

          if (searchKeyword && !matchedByName && visibleDatabases.length === 0) {
            return null
          }

          return {
            entry: profile,
            matched_by_name: matchedByName,
            databases: visibleDatabases,
          }
        })
        .filter((profile): profile is NavigationTreeProfile => profile !== null)

      if (searchKeyword && profiles.length === 0) {
        return null
      }

      return {
        key: group.key,
        group_id: group.group_id,
        group_name: group.group_name,
        profiles,
      }
    })
    .filter((group): group is NavigationTreeGroup => group !== null)
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

function expandAncestorsForDatabase(
  previous: Set<string>,
  profile: ConnectionProfile,
  databaseName: string,
) {
  const next = expandAncestorsForProfile(previous, profile)
  next.add(`profile:${profile.id}`)
  next.add(`database:${buildDatabaseKey(profile.id, databaseName)}`)
  return next
}

function expandAncestorsForProfileNode(previous: Set<string>, profile: ConnectionProfile) {
  const next = expandAncestorsForProfile(previous, profile)
  next.add(`profile:${profile.id}`)
  return next
}

function expandAncestorsForTable(
  previous: Set<string>,
  profile: ConnectionProfile,
  databaseName: string,
) {
  return expandAncestorsForDatabase(previous, profile, databaseName)
}

function matchesNavigationSearch(value: string, keyword: string) {
  if (!keyword) {
    return true
  }

  return value.toLowerCase().includes(keyword)
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

function buildTableDataExportFileName(
  databaseName: string,
  tableName: string,
  format: ExportFileFormat,
) {
  return `${databaseName}_${tableName}_${formatFileDate(new Date())}.${format}`
}

function buildQueryResultExportFileName(
  databaseName: string | null,
  format: ExportFileFormat,
) {
  const prefix = databaseName || 'query_result'
  return `${prefix}_${formatFileDate(new Date())}.${format}`
}

function getExportScopeText(dialog: ExportDialogState) {
  if (dialog.kind === 'table_data') {
    if (dialog.scope === 'all_rows') {
      const hasFilter =
        Boolean(dialog.load_payload.where_clause?.trim()) ||
        Boolean(dialog.load_payload.order_by_clause?.trim())
      return hasFilter ? '当前筛选结果' : '整表数据'
    }
    if (dialog.scope === 'selected_rows') {
      return '所选行'
    }
    return '当前页'
  }

  if (dialog.scope === 'all_rows') {
    return '完整查询结果'
  }
  if (dialog.scope === 'selected_rows') {
    return '所选行'
  }
  return '当前页'
}

function getExportScopeOptions(dialog: ExportDialogState) {
  const currentRows = dialog.rows.length
  const selectedRows = dialog.selected_rows.length

  if (dialog.kind === 'table_data') {
    const hasFilter =
      Boolean(dialog.load_payload.where_clause?.trim()) ||
      Boolean(dialog.load_payload.order_by_clause?.trim())

    return [
      {
        value: 'current_page' as ExportScope,
        label: '当前页',
        description:
          currentRows > 0
            ? `导出当前页已加载的 ${currentRows} 行数据`
            : '当前页暂无行数据，将仅导出表头',
        disabled: dialog.columns.length === 0,
      },
      {
        value: 'all_rows' as ExportScope,
        label: hasFilter ? '当前筛选结果' : '整表数据',
        description: hasFilter
          ? '按当前 WHERE / ORDER BY 重新查询并导出全部结果'
          : '重新查询整张表并导出全部结果',
        disabled: false,
      },
      {
        value: 'selected_rows' as ExportScope,
        label: '所选行',
        description:
          selectedRows > 0
            ? `导出当前表格中已选中的 ${selectedRows} 行`
            : '请先在表格中框选需要导出的行',
        disabled: selectedRows === 0,
      },
    ]
  }

  return [
    {
      value: 'current_page' as ExportScope,
      label: '当前页',
      description:
        currentRows > 0
          ? `导出当前页已加载的 ${currentRows} 行结果`
          : '当前页暂无行数据，将仅导出表头',
      disabled: dialog.columns.length === 0,
    },
    {
      value: 'all_rows' as ExportScope,
      label: '完整查询结果',
      description: '重新执行当前 SQL，并导出完整结果集',
      disabled: false,
    },
    {
      value: 'selected_rows' as ExportScope,
      label: '所选行',
      description:
        selectedRows > 0
          ? `导出当前结果表格中已选中的 ${selectedRows} 行`
          : '请先在结果表格中框选需要导出的行',
      disabled: selectedRows === 0,
    },
  ]
}

async function copyTextToClipboard(text: string) {
  if ('__TAURI_INTERNALS__' in window) {
    await writeClipboardText(text)
    return
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  const succeeded = document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!succeeded) {
    throw new Error('当前环境不支持写入剪贴板')
  }
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

function inferDefaultCellValue(rawDefault: string): CellValue {
  if (rawDefault === 'CURRENT_TIMESTAMP') {
    return new Date().toISOString().slice(0, 19).replace('T', ' ')
  }
  if (!Number.isNaN(Number(rawDefault))) {
    return Number(rawDefault)
  }
  return rawDefault
}

export default App

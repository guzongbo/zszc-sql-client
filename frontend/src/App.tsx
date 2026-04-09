import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type ReactNode,
} from 'react'
import './App.css'
import {
  applyTableDataChanges,
  applyTableDesignChanges,
  createDatabase,
  createTable,
  deleteConnectionProfile,
  disconnectConnectionProfile,
  executeSql,
  getAppBootstrap,
  getTableDdl,
  listDatabaseTables,
  listProfileDatabases,
  loadTableData,
  loadTableDesign,
  previewCreateTableSql,
  previewTableDataChanges,
  previewTableDesignSql,
  saveConnectionProfile,
  testConnectionProfile,
} from './api'
import type {
  AppBootstrap,
  ApplyTableDataChangesPayload,
  CellValue,
  ConnectionProfile,
  CreateDatabasePayload,
  DatabaseEntry,
  JsonRecord,
  SaveConnectionProfilePayload,
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

function App() {
  const [, setBootstrap] = useState<AppBootstrap | null>(null)
  const [bootstrapError, setBootstrapError] = useState('')
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [selection, setSelection] = useState<SelectionState>({ kind: 'none' })
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [databasesByProfile, setDatabasesByProfile] = useState<Record<string, DatabaseEntry[]>>(
    {},
  )
  const [tablesByDatabase, setTablesByDatabase] = useState<Record<string, TableEntry[]>>({})
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

  useEffect(() => {
    let cancelled = false

    async function bootstrapApp() {
      try {
        const payload = await getAppBootstrap()
        if (cancelled) {
          return
        }

        const nextProfiles = sortProfiles(payload.connection_profiles)
        setBootstrap(payload)
        setProfiles(nextProfiles)
        setExpandedKeys(buildInitialExpandedKeys(nextProfiles))
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
    if (profiles.length === 0) {
      return
    }

    profiles.forEach((profile) => {
      if (!databasesByProfile[profile.id] && !nodeLoading[profile.id]) {
        void ensureDatabasesLoaded(profile.id, { silent: true })
      }
    })
  }, [profiles])

  useEffect(() => {
    setTabs((previous) =>
      previous.map((tab) =>
        tab.kind === 'console'
          ? {
              ...tab,
              console: {
                ...tab.console,
                database_loading: !Boolean(databasesByProfile[tab.profile_id]),
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
    setSelection({
      kind: 'table',
      profile_id: profileId,
      database_name: databaseName,
      table_name: tableName,
    })
    setTreeContextMenu(null)
  }

  function selectProfile(profileId: string) {
    setSelection({ kind: 'profile', profile_id: profileId })
    setTreeContextMenu(null)
  }

  function selectDatabase(profileId: string, databaseName: string) {
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
      editor: {
        mode: profile ? 'edit' : 'create',
        saving: false,
        testing: false,
        test_result: '',
        form: profile ? profileToForm(profile) : { ...defaultConnectionForm },
      },
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
          mode: 'edit',
          saving: false,
          testing: false,
          test_result: '数据源已保存',
          form: profileToForm(savedProfile),
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
        affected_rows: 0,
        truncated: false,
        database_loading: !Boolean(databasesByProfile[scope.profile_id]),
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
                editable: data.editable,
                transaction_mode: tab.data.transaction_mode,
              },
            }
          : tab,
      )

      appendOutputLog(
        databaseName,
        `在 ${Math.max(1, Math.round(performance.now() - startedAt))} ms 内读取了 ${data.rows.length} 行数据`,
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
            const nextState =
              row.state === 'new'
                ? 'new'
                : JSON.stringify(nextValues) === JSON.stringify(row.original_values)
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

  function selectDataRow(
    tabId: string,
    clientId: string,
    options?: { append?: boolean },
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
            if (row.client_id === clientId) {
              return {
                ...row,
                selected: options?.append ? !row.selected : true,
              }
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
    const lastOffset = Math.max(
      Math.ceil(tab.data.total_rows / Math.max(tab.data.limit, 1)) - 1,
      0,
    ) * tab.data.limit

    let nextOffset = tab.data.offset
    if (direction === 'first') {
      nextOffset = 0
    } else if (direction === 'prev') {
      nextOffset = Math.max(tab.data.offset - tab.data.limit, 0)
    } else if (direction === 'next') {
      nextOffset = Math.min(tab.data.offset + tab.data.limit, lastOffset)
    } else if (direction === 'last') {
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
      setSqlPreview({
        title: `${tab.title} 数据变更 SQL`,
        statements:
          preview.statements.length > 0
            ? preview.statements
            : ['-- 当前没有待提交的数据改动'],
        confirm_label: preview.statements.length > 0 ? '确认提交数据改动' : undefined,
        busy: false,
        on_confirm:
          preview.statements.length > 0
            ? async () => {
                setSqlPreview((previous) =>
                  previous ? { ...previous, busy: true } : previous,
                )
                const startedAt = performance.now()
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
                affected_rows: result.affected_rows,
                truncated: result.truncated,
              },
            }
          : currentTab,
      )

      appendOutputLog(
        tab.database_name ?? 'console',
        result.result_kind === 'query'
          ? `在 ${Math.max(1, Math.round(performance.now() - startedAt))} ms 内检索到 ${result.total_rows} 行${result.truncated ? '（结果已截断）' : ''}`
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
    const lastOffset = Math.max(
      Math.ceil(tab.console.total_rows / Math.max(tab.console.limit, 1)) - 1,
      0,
    ) * tab.console.limit

    let nextOffset = tab.console.offset
    if (direction === 'first') {
      nextOffset = 0
    } else if (direction === 'prev') {
      nextOffset = Math.max(tab.console.offset - tab.console.limit, 0)
    } else if (direction === 'next') {
      nextOffset = Math.min(tab.console.offset + tab.console.limit, lastOffset)
    } else if (direction === 'last') {
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

  return (
    <main className="app-shell" onClick={() => setTreeContextMenu(null)}>
      <div className="titlebar" data-tauri-drag-region></div>
      <section className="workspace-shell">
        <header
          className="window-bar"
        />

        <div className="workspace-layout">
          <aside className="tool-rail">
            <button className="rail-item active" type="button">
              <span>数</span>
              <span>据</span>
              <span>源</span>
            </button>
            <button
              className="rail-item"
              type="button"
              onClick={() => pushToast('结构对比页未纳入本轮范围', 'info')}
            >
              <span>结</span>
              <span>构</span>
              <span>对</span>
              <span>比</span>
            </button>
            <button
              className="rail-item"
              type="button"
              onClick={() => pushToast('数据对比页未纳入本轮范围', 'info')}
            >
              <span>数</span>
              <span>据</span>
              <span>对</span>
              <span>比</span>
            </button>
            <button
              className="rail-item"
              type="button"
              onClick={() => pushToast('对比记录页未纳入本轮范围', 'info')}
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

          <aside className="navigation-pane">
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
                      className="tree-row group-row"
                      type="button"
                      onClick={() => void toggleNodeExpansion(groupKey)}
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
                                onClick={async () => {
                                  selectProfile(profile.id)
                                  await toggleNodeExpansion(datasourceKey, async () => {
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
                                          onClick={async () => {
                                            selectDatabase(profile.id, database.name)
                                            await toggleNodeExpansion(
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
          </aside>

          <section className="content-pane">
            <div className="tab-bar">
              {tabs.length === 0 ? (
                <span className="tab-hint">
                  右侧用于编辑数据源；左侧支持数据源、数据库、表三级右键菜单，顶部按钮可打开控制台。
                </span>
              ) : null}

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
                  onFieldChange={updateProfileTabField}
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
                  onSelectRow={(clientId, event) =>
                    selectDataRow(activeTab.id, clientId, {
                      append: event.metaKey || event.ctrlKey,
                    })
                  }
                  onValueChange={updateDataRow}
                />
              ) : null}

              {activeTab?.kind === 'console' ? (
                <ConsoleView
                  tab={activeTab}
                  databaseOptions={databasesByProfile[activeTab.profile_id] ?? []}
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

              {!activeTab ? (
                <EmptyWorkspace onAddSource={() => openProfileEditorTab()} />
              ) : null}
            </div>

            {outputVisible ? (
              <OutputDock
                logs={outputLogs}
                outputBodyRef={outputBodyRef}
                onClear={() => setOutputLogs([])}
              />
            ) : null}
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
  onFieldChange,
  onSave,
  onTest,
  onDelete,
}: {
  tab: ProfileTab
  onFieldChange: (
    tabId: string,
    field: keyof SaveConnectionProfilePayload,
    value: string | number | null,
  ) => void
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
            新增时不强制归组，保存后可在这里补充分组名称。整个结构为：分组 -
            数据源 - 数据库 - 表。
          </p>
        </div>

        <div className="editor-actions">
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
          {tab.editor.mode === 'edit' ? (
            <label className="form-item">
              <span>分组名称</span>
              <input
                value={tab.editor.form.group_name ?? ''}
                onChange={(event) =>
                  onFieldChange(tab.id, 'group_name', event.target.value || null)
                }
                placeholder="留空则显示在未分组"
              />
            </label>
          ) : null}

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
        <span>power by wx_guzb_7558</span>
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
  onSelectRow,
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
  onSelectRow: (clientId: string, event: ReactMouseEvent<HTMLTableRowElement>) => void
  onValueChange: (
    tabId: string,
    clientId: string,
    columnName: string,
    value: CellValue,
  ) => void
}) {
  const rangeStart = tab.data.total_rows === 0 ? 0 : tab.data.offset + 1
  const rangeEnd =
    tab.data.total_rows === 0
      ? 0
      : Math.min(tab.data.offset + tab.data.rows.length, tab.data.total_rows)
  const atFirstPage = tab.data.offset <= 0 || tab.data.total_rows === 0
  const atLastPage = rangeEnd >= tab.data.total_rows

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
              disabled={!tab.data.editable}
              type="button"
              onClick={onDeleteRows}
            >
              删除行
            </button>
            <button
              className="flat-button"
              disabled={!tab.data.editable}
              type="button"
              onClick={onRestoreRows}
            >
              恢复所选
            </button>
            <button
              className="flat-button primary"
              disabled={!tab.data.editable}
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
            <input
              value={tab.data.where_clause}
              onChange={(event) =>
                onQueryFieldChange(tab.id, 'where_clause', event.target.value)
              }
              placeholder="例如：assess_type = 3"
            />
          </label>

          <label className="inline-query-field">
            <span>ORDER BY</span>
            <input
              value={tab.data.order_by_clause}
              onChange={(event) =>
                onQueryFieldChange(tab.id, 'order_by_clause', event.target.value)
              }
              placeholder="例如：insert_time desc"
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
          onSelectRow={onSelectRow}
          onValueChange={(clientId, columnName, value) =>
            onValueChange(tab.id, clientId, columnName, value)
          }
        />
      </div>

      <footer className="page-footer">
        <span className="page-footer-meta">
          已加载 {tab.data.rows.length} 行，共 {tab.data.total_rows} 行
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
              {rangeStart}-{rangeEnd} / {tab.data.total_rows}
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
              disabled={tab.data.loading || atLastPage}
              type="button"
              onClick={onLastPage}
            >
              &gt;|
            </button>
          </div>
        </div>
        <span className="page-footer-brand">power by wx_guzb_7558</span>
      </footer>
    </div>
  )
}

function DataGridTable({
  columns,
  rows,
  editable,
  rowNumberOffset,
  onSelectRow,
  onValueChange,
}: {
  columns: TableDataColumn[]
  rows: DataGridRow[]
  editable: boolean
  rowNumberOffset?: number
  onSelectRow?: (clientId: string, event: ReactMouseEvent<HTMLTableRowElement>) => void
  onValueChange?: (clientId: string, columnName: string, value: CellValue) => void
}) {
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
              onClick={(event) => onSelectRow?.(row.client_id, event)}
            >
              <td className="center-cell">{(rowNumberOffset ?? 0) + index + 1}</td>

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
  onDatabaseChange: (tabId: string, databaseName: string | null) => void
  onFormat: (tabId: string) => void
  onSqlChange: (tabId: string, value: string) => void
  onExecute: () => void
  onFirstPage: () => void
  onPrevPage: () => void
  onNextPage: () => void
  onLastPage: () => void
}) {
  const lineCount = Math.max(tab.console.sql.split('\n').length, 8)
  const rangeStart = tab.console.total_rows === 0 ? 0 : tab.console.offset + 1
  const rangeEnd =
    tab.console.total_rows === 0
      ? 0
      : Math.min(tab.console.offset + tab.console.rows.length, tab.console.total_rows)
  const atFirstPage = tab.console.offset <= 0 || tab.console.total_rows === 0
  const atLastPage = rangeEnd >= tab.console.total_rows

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
          <div className="console-gutter" aria-hidden="true">
            {Array.from({ length: lineCount }, (_, index) => (
              <span key={index + 1}>{index + 1}</span>
            ))}
          </div>
          <textarea
            className="console-textarea"
            value={tab.console.sql}
            onChange={(event) => onSqlChange(tab.id, event.target.value)}
            placeholder="请输入单条 SQL，当前控制台暂不支持一次执行多条语句"
            spellCheck={false}
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
            已加载 {tab.console.rows.length} 行，共 {tab.console.total_rows} 行
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
                {rangeStart}-{rangeEnd} / {tab.console.total_rows}
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
                disabled={tab.console.loading || atLastPage}
                type="button"
                onClick={onLastPage}
              >
                &gt;|
              </button>
            </div>
          </div>
          <span className="page-footer-brand">power by wx_guzb_7558</span>
        </footer>
      ) : null}
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

function EmptyWorkspace({ onAddSource }: { onAddSource: () => void }) {
  return (
    <div className="empty-workspace">
      <div className="empty-panel">
        <strong>MySQL 桌面客户端工作区</strong>
        <p>
          点击左上角加号在右侧创建数据源。左侧支持数据源、数据库、表三级右键菜单，顶部按钮可打开控制台。
        </p>
        <div className="editor-actions">
          <button className="flat-button primary" type="button" onClick={onAddSource}>
            新增数据源
          </button>
        </div>
      </div>
    </div>
  )
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

function buildInitialExpandedKeys(profiles: ConnectionProfile[]) {
  const keys = new Set<string>()
  profiles.forEach((profile) => {
    keys.add(`group:${normalizeGroupName(profile.group_name)}`)
  })
  return keys
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

function buildDatabaseKey(profileId: string, databaseName: string) {
  return `${profileId}:${databaseName}`
}

function createClientId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
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

function buildDataMutationPayload(tab: DataTab): ApplyTableDataChangesPayload | null {
  const insertedRows = tab.data.rows
    .filter((row) => row.state === 'new')
    .map((row) => ({ values: row.values }))
  const updatedRows = tab.data.rows
    .filter((row) => row.state === 'updated' && row.row_key)
    .map((row) => ({ row_key: row.row_key!, values: row.values }))
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

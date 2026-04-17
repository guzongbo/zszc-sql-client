import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import './App.css'
import {
  getAppBootstrap,
  getRuntimeMetrics,
  installPluginFromDisk,
  listInstalledPlugins,
  uninstallPlugin,
} from './api'
import {
  dataTransferWorkspaceId,
  databaseWorkspaceId,
  type ConfirmDialogState,
  type OutputLogEntry,
  type RailSection,
  type ToastItem,
  type ToastTone,
  type TreeContextMenuState,
  type WorkspacePanelKey,
  redisWorkspaceId,
} from './features/workspace/appTypes'
import {
  buildDatabaseKey,
  expandAncestorsForProfile,
  expandAncestorsForProfileNode,
  expandAncestorsForTable,
  normalizeGroupName,
  sortDataSourceGroups,
  sortProfiles,
} from './features/workspace/navigation'
import {
  createClientId,
  formatOutputTimestamp,
} from './features/workspace/appHelpers'
import { AppOverlays } from './features/workspace/AppOverlays'
import { AppWindowBar } from './features/workspace/AppWindowBar'
import { useCompareDomain } from './features/workspace/useCompareDomain'
import { DatabaseNavigationPane } from './features/workspace/DatabaseNavigationPane'
import { useCompareHistoryState } from './features/workspace/useCompareHistoryState'
import { useDatasourceManagement } from './features/workspace/useDatasourceManagement'
import { useTableWorkspaceDomain } from './features/workspace/useTableWorkspaceDomain'
import { useWorkspaceNavigationState } from './features/workspace/useWorkspaceNavigationState'
import { useWorkspaceTabsState } from './features/workspace/useWorkspaceTabsState'
import { WorkspaceDatasourceTabs } from './features/workspace/WorkspaceDatasourceTabs'
import {
  OutputDock,
  WorkspaceLoadingState,
  WorkspacePanelPlaceholder,
} from './shared/components/AppChrome'
import { PluginWorkspace } from './features/plugins/PluginWorkspace'
import {
  shouldIgnoreWindowDragTarget,
  startDesktopWindowDragging,
  toggleDesktopWindowMaximize,
} from './shared/utils/desktopWindow'
import type {
  AppBootstrap,
  ConnectionProfile,
  DataSourceGroup,
  InstalledPlugin,
  RuntimeMetrics,
} from './types'

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

const DataTransferWorkspace = lazy(() =>
  import('./features/data-transfer/DataTransferWorkspace').then((module) => ({
    default: module.DataTransferWorkspace,
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
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(
    null,
  )
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [outputVisible, setOutputVisible] = useState(true)
  const [outputLogs, setOutputLogs] = useState<OutputLogEntry[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const outputBodyRef = useRef<HTMLDivElement | null>(null)
  const {
    compareHistoryItems,
    compareHistoryType,
    historyDetailLoadingId,
    refreshCompareHistoryState,
    selectedHistoryItem,
    selectedHistorySummary,
    setCompareHistoryType,
    setSelectedHistoryId,
    visibleHistoryItems,
  } = useCompareHistoryState({
    activeSection,
    pushToast,
  })
  const {
    clearExpandedKeys,
    clearTablesCache,
    clearProfileCaches,
    clearSqlAutocompleteCache,
    databasesByProfile,
    ensureDatabasesLoaded,
    ensureSqlAutocompleteLoaded,
    ensureTablesLoaded,
    navigationSearchText,
    navigationTreeGroups,
    nodeLoading,
    profileConnectionState,
    selectDatabase: selectNavigationDatabase,
    selectGroup: selectNavigationGroup,
    selectProfile: selectNavigationProfile,
    selectTable: selectNavigationTable,
    selectedGroupKey,
    selectedProfile,
    selection,
    setExpandedKeys,
    setNavigationSearchText,
    setProfileConnectionStatus,
    setSelectedGroupKey,
    setSelection,
    sqlAutocompleteByDatabase,
    tablesByDatabase,
    toggleNodeExpansion,
    visibleExpandedKeys,
  } = useWorkspaceNavigationState({
    dataSourceGroups,
    profiles,
    pushToast,
  })
  const {
    activeTab,
    activeTabId,
    patchTab,
    removeTab,
    replaceTab,
    setActiveTabId,
    setTabs,
    tabs,
    upsertTab,
  } = useWorkspaceTabsState()
  const {
    applyProfilesToGroup,
    cancelRenameProfileGroup,
    clearGroupAssignmentSelection,
    createDatabaseDialog,
    createProfileGroupFromTab,
    deleteProfileFromTab,
    deleteProfileGroupFromTab,
    disconnectSelectedProfile,
    importNavicatProfiles,
    openCreateDatabaseDialog,
    openGroupAssignmentTab,
    openProfileEditorTab,
    renameProfileGroupFromTab,
    saveCreateDatabaseDialog,
    saveProfileTab,
    setCreateDatabaseDialog,
    selectAllGroupAssignmentProfiles,
    startRenameProfileGroup,
    testProfileTab,
    toggleGroupAssignmentProfile,
    toggleProfileGroupManager,
    updateCreateDatabaseField,
    updateGroupAssignmentFilter,
    updateProfileEditingGroupName,
    updateProfileGroupCreateName,
    updateProfileTabField,
  } = useDatasourceManagement({
    appendOutputLog,
    clearExpandedKeys,
    clearProfileCaches,
    clearSqlAutocompleteCache,
    dataSourceGroups,
    ensureDatabasesLoaded,
    patchTab,
    profiles,
    pushToast,
    removeTab,
    replaceTab,
    setActiveTabId,
    setBootstrap,
    setDataSourceGroups,
    setExpandedKeys,
    setProfileConnectionStatus,
    setProfiles,
    setSelectedGroupKey,
    setSelection,
    setTabs,
    upsertTab,
  })
  const {
    cancelRunningDataCompare,
    cancelRunningStructureCompare,
    clearAllDataCompareTables,
    compareForm,
    dataCompareState,
    discoverCompareTables,
    ensureDataCompareDetailLoaded,
    exportSelectedDataCompareSql,
    exportSelectedStructureCompareSql,
    filteredDataCompareTables,
    runDataCompareFlow,
    runStructureCompareFlow,
    setActiveStructureCategory,
    setDataCompareStep,
    setStructureCompareStep,
    setStructureDetailConcurrencyInput,
    structureCompareState,
    structureDetailConcurrencyInput,
    switchDataCompareDetailType,
    toggleDataCompareDetailSelection,
    toggleDataCompareResultActionSelection,
    toggleDataCompareResultTableSelection,
    toggleDataCompareTable,
    toggleStructureCategorySelection,
    toggleStructureDetail,
    toggleStructureTableSelection,
    selectAllDataCompareTables,
    selectDataCompareResultTable,
    updateCompareDatabase,
    updateCompareProfile,
    updateDataCompareTableFilter,
  } = useCompareDomain({
    appendOutputLog,
    ensureDatabasesLoaded,
    profiles,
    pushToast,
    refreshCompareHistoryState,
  })
  const {
    activeConsoleAutocomplete,
    activeConsoleSchemas,
    addDataRow,
    addDesignRow,
    changeConsolePage,
    changeDataPage,
    commitDataChanges,
    commitDesignChanges,
    confirmExportDialog,
    copyExportDialogSql,
    ddlDialog,
    deleteSelectedDataRows,
    deleteSelectedDesignRows,
    exportDialog,
    formatConsoleSql,
    openConsoleFromSelection,
    openCreateTableTab,
    openDataExportDialog,
    openQueryResultExportDialog,
    openTableDdl,
    openTableExportDialog,
    openTableTab,
    previewDesignSql,
    refreshCurrentSelection,
    refreshDataTab,
    refreshDesignTab,
    restoreSelectedDataRows,
    restoreSelectedDesignRows,
    runConsoleSql,
    selectConsoleRowsRange,
    selectDataRowsRange,
    setDdlDialog,
    setExportDialog,
    setSqlPreview,
    sqlPreview,
    toggleAllDesignRows,
    toggleDesignRowSelection,
    updateConsoleDatabase,
    updateConsoleSql,
    updateDataQueryField,
    updateDataRow,
    updateDesignDraftTableName,
    updateDesignRow,
    updateExportDialogFormat,
    updateExportDialogScope,
  } = useTableWorkspaceDomain({
    activeTab,
    appendOutputLog,
    clearProfileCaches,
    clearSqlAutocompleteCache,
    clearTablesCache,
    databasesByProfile,
    ensureDatabasesLoaded,
    ensureSqlAutocompleteLoaded,
    ensureTablesLoaded,
    patchTab,
    profiles,
    pushToast,
    selectTable,
    setTabs,
    sqlAutocompleteByDatabase,
    tabs,
    upsertTab,
  })

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
        setCurrentPlatform(payload.current_platform)
        setPluginPackageExtension(payload.plugin_package_extension)
        setInstalledPlugins(payload.installed_plugins)
        setProfiles(nextProfiles)
        setDataSourceGroups(sortDataSourceGroups(payload.data_source_groups))
        setExpandedKeys(new Set())
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
  }, [setExpandedKeys])

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
    if (
      activeWorkspaceId === databaseWorkspaceId ||
      activeWorkspaceId === redisWorkspaceId ||
      activeWorkspaceId === dataTransferWorkspaceId
    ) {
      return
    }

    const pluginId = activeWorkspaceId.replace('plugin:', '')
    if (!installedPlugins.some((plugin) => plugin.id === pluginId)) {
      setActiveWorkspaceId(databaseWorkspaceId)
    }
  }, [activeWorkspaceId, installedPlugins])

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

  function selectTable(profileId: string, databaseName: string, tableName: string) {
    selectNavigationTable(profileId, databaseName, tableName)
    setTreeContextMenu(null)
  }

  function selectProfile(profileId: string) {
    selectNavigationProfile(profileId)
    setTreeContextMenu(null)
  }

  function selectDatabase(profileId: string, databaseName: string) {
    selectNavigationDatabase(profileId, databaseName)
    setTreeContextMenu(null)
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
  const workspaceOptions = useMemo(
    () => [
      { id: databaseWorkspaceId, label: 'MySQL客户端' },
      { id: dataTransferWorkspaceId, label: '数据传输' },
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

  const handleWindowBarPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') {
      return
    }

    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    // 避免点击按钮、菜单等交互控件时误触发窗口拖拽。
    if (shouldIgnoreWindowDragTarget(target)) {
      return
    }

    event.preventDefault()

    if (event.detail === 2) {
      void toggleDesktopWindowMaximize()
      return
    }

    void startDesktopWindowDragging()
  }

  return (
    <main
      className="app-shell"
      onClick={() => {
        setTreeContextMenu(null)
        setWorkspaceMenuOpen(false)
      }}
    >
      <section className="workspace-shell">
        <AppWindowBar
          activeWorkspaceId={activeWorkspaceId}
          activeWorkspaceLabel={activeWorkspaceLabel}
          databaseWorkspaceId={databaseWorkspaceId}
          dataTransferWorkspaceId={dataTransferWorkspaceId}
          installedPlugins={installedPlugins}
          onManagePlugins={handleOpenPluginManager}
          onPointerDown={handleWindowBarPointerDown}
          onSelectWorkspace={handleSelectWorkspace}
          onToggleMenu={() => setWorkspaceMenuOpen((previous) => !previous)}
          panelToggleItems={panelToggleItems}
          redisWorkspaceId={redisWorkspaceId}
          workspaceMenuOpen={workspaceMenuOpen}
          cpuText={cpuText}
          memoryText={memoryText}
        />

        {activePlugin ? (
          <section className="plugin-full-pane">
            <PluginWorkspace plugin={activePlugin} />
          </section>
        ) : activeWorkspaceId === dataTransferWorkspaceId ? (
          <section className="data-transfer-full-pane">
            <Suspense
              fallback={
                <WorkspaceLoadingState
                  title="数据传输工作区准备中"
                  text="正在挂载内网文件传输工作区。"
                />
              }
            >
              <DataTransferWorkspace />
            </Suspense>
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
                  <DatabaseNavigationPane
                    activeSection={activeSection}
                    bootstrapError={bootstrapError}
                    compareHistoryType={compareHistoryType}
                    dataSourceGroups={dataSourceGroups}
                    databasesByProfile={databasesByProfile}
                    navigationSearchText={navigationSearchText}
                    navigationTreeGroups={navigationTreeGroups}
                    nodeLoading={nodeLoading}
                    profileConnectionState={profileConnectionState}
                    profiles={profiles}
                    selectedGroupKey={selectedGroupKey}
                    selectedProfile={selectedProfile}
                    selection={selection}
                    tablesByDatabase={tablesByDatabase}
                    visibleExpandedKeys={visibleExpandedKeys}
                    visibleHistoryCount={visibleHistoryItems.length}
                    onCompareHistoryTypeChange={setCompareHistoryType}
                    onDisconnectSelectedProfile={() => void disconnectSelectedProfile(selection)}
                    onNavigationSearchTextChange={setNavigationSearchText}
                    onOpenConsole={() => openConsoleFromSelection(selection)}
                    onOpenProfileEditor={() => openProfileEditorTab()}
                    onOpenSelectedProfileEditor={() => {
                      if (selectedProfile) {
                        openProfileEditorTab(selectedProfile)
                      }
                    }}
                    onRefresh={() => void refreshCurrentSelection(selection)}
                    onSelectDatabase={(profileId, databaseName) => {
                      selectDatabase(profileId, databaseName)
                      const profile = profiles.find((item) => item.id === profileId)
                      if (profile) {
                        setExpandedKeys((previous) =>
                          expandAncestorsForProfileNode(previous, profile),
                        )
                      }
                    }}
                    onSelectGroup={(groupKey) => {
                      selectNavigationGroup(groupKey)
                      setTreeContextMenu(null)
                    }}
                    onSelectProfile={(profileId) => {
                      selectProfile(profileId)
                      const profile = profiles.find((item) => item.id === profileId)
                      if (profile) {
                        setExpandedKeys((previous) =>
                          expandAncestorsForProfile(previous, profile),
                        )
                      }
                    }}
                    onSelectTable={(profileId, databaseName, tableName) => {
                      selectTable(profileId, databaseName, tableName)
                      const profile = profiles.find((item) => item.id === profileId)
                      if (profile) {
                        setExpandedKeys((previous) =>
                          expandAncestorsForTable(previous, profile, databaseName),
                        )
                      }
                    }}
                    onToggleDatabaseNode={(profileId, databaseName) => {
                      void toggleNodeExpansion(
                        `database:${buildDatabaseKey(profileId, databaseName)}`,
                        async () => {
                          await ensureTablesLoaded(profileId, databaseName)
                        },
                      )
                    }}
                    onToggleGroupNode={(groupKey) => {
                      void toggleNodeExpansion(groupKey)
                    }}
                    onToggleProfileNode={(profileId) => {
                      void toggleNodeExpansion(`profile:${profileId}`, async () => {
                        await ensureDatabasesLoaded(profileId)
                      })
                    }}
                    onTreeGroupContextMenu={(event, groupId, groupName) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setSelectedGroupKey(`group:${normalizeGroupName(groupName)}`)
                      setSelection({ kind: 'none' })
                      setTreeContextMenu({
                        kind: 'group',
                        x: Math.min(event.clientX, window.innerWidth - 208),
                        y: Math.min(event.clientY, window.innerHeight - 92),
                        group_id: groupId,
                        group_name: groupName,
                      })
                    }}
                    onTreeDatabaseContextMenu={(event, profileId, databaseName) => {
                      event.preventDefault()
                      event.stopPropagation()
                      selectDatabase(profileId, databaseName)
                      setTreeContextMenu({
                        kind: 'database',
                        x: Math.min(event.clientX, window.innerWidth - 188),
                        y: Math.min(event.clientY, window.innerHeight - 140),
                        profile_id: profileId,
                        database_name: databaseName,
                      })
                    }}
                    onTreeProfileContextMenu={(event, profileId) => {
                      event.preventDefault()
                      event.stopPropagation()
                      selectProfile(profileId)
                      setTreeContextMenu({
                        kind: 'profile',
                        x: Math.min(event.clientX, window.innerWidth - 188),
                        y: Math.min(event.clientY, window.innerHeight - 140),
                        profile_id: profileId,
                      })
                    }}
                    onTreeTableContextMenu={(event, profileId, databaseName, tableName) => {
                      event.preventDefault()
                      event.stopPropagation()
                      selectTable(profileId, databaseName, tableName)
                      setTreeContextMenu({
                        kind: 'table',
                        x: Math.min(event.clientX, window.innerWidth - 188),
                        y: Math.min(event.clientY, window.innerHeight - 220),
                        profile_id: profileId,
                        database_name: databaseName,
                        table_name: tableName,
                      })
                    }}
                    onOpenTableData={(profileId, databaseName, tableName) => {
                      void openTableTab('data', profileId, databaseName, tableName)
                    }}
                  />
                </aside>
              ) : null}

              <section className="content-pane">
            {activeSection === 'datasource' ? (
              <WorkspaceDatasourceTabs
                activeTab={activeTab}
                activeTabId={activeTabId}
                activeConsoleAutocomplete={activeConsoleAutocomplete}
                activeConsoleSchemas={activeConsoleSchemas}
                dataSourceGroups={dataSourceGroups}
                databasesByProfile={databasesByProfile}
                profiles={profiles}
                tabs={tabs}
                onActivateTab={setActiveTabId}
                onAddDesignRow={addDesignRow}
                onAddDataRow={addDataRow}
                onApplyDataFilter={(tab) =>
                  void refreshDataTab(
                    tab.id,
                    tab.profile_id,
                    tab.database_name,
                    tab.table_name,
                    tab.data.where_clause,
                    tab.data.order_by_clause,
                    0,
                    tab.data.limit,
                  )
                }
                onChangeConsolePage={(tab, direction) => void changeConsolePage(tab, direction)}
                onChangeDataPage={(tab, direction) => void changeDataPage(tab, direction)}
                onClearGroupAssignmentSelection={clearGroupAssignmentSelection}
                onCloseTab={removeTab}
                onCommitDataChanges={(tab) => void commitDataChanges(tab)}
                onCommitDesignChanges={(tab) => void commitDesignChanges(tab)}
                onCreateProfileGroupFromTab={createProfileGroupFromTab}
                onDeleteProfileFromTab={deleteProfileFromTab}
                onDeleteProfileGroupFromTab={deleteProfileGroupFromTab}
                onDeleteSelectedDataRows={deleteSelectedDataRows}
                onDeleteSelectedDesignRows={deleteSelectedDesignRows}
                onFormatConsoleSql={formatConsoleSql}
                onImportNavicat={() => void importNavicatProfiles()}
                onOpenDataExportDialog={openDataExportDialog}
                onOpenQueryResultExportDialog={openQueryResultExportDialog}
                onPatchConsoleDatabase={updateConsoleDatabase}
                onPatchConsoleSql={updateConsoleSql}
                onPatchDesignDraftTableName={updateDesignDraftTableName}
                onPatchDesignRow={updateDesignRow}
                onPatchProfileEditingGroupName={updateProfileEditingGroupName}
                onPatchProfileField={updateProfileTabField}
                onPatchProfileGroupCreateName={updateProfileGroupCreateName}
                onPreviewDesignSql={(tab) => void previewDesignSql(tab)}
                onRefreshDataTab={(...args) => void refreshDataTab(...args)}
                onRefreshDesignTab={(...args) => void refreshDesignTab(...args)}
                onRenameProfileGroupFromTab={renameProfileGroupFromTab}
                onResolveConsoleSchema={(profileId, databaseName) =>
                  ensureSqlAutocompleteLoaded(profileId, databaseName, {
                    silent: true,
                  })
                }
                onRestoreSelectedDataRows={restoreSelectedDataRows}
                onRestoreSelectedDesignRows={restoreSelectedDesignRows}
                onRunConsoleSql={(tab, offset) => void runConsoleSql(tab, offset)}
                onSaveProfileTab={saveProfileTab}
                onSelectAllGroupAssignmentProfiles={selectAllGroupAssignmentProfiles}
                onSelectConsoleRowsRange={selectConsoleRowsRange}
                onSelectDataRowsRange={selectDataRowsRange}
                onStartRenameProfileGroup={startRenameProfileGroup}
                onSubmitProfilesToGroup={applyProfilesToGroup}
                onTestProfileTab={testProfileTab}
                onCancelRenameProfileGroup={cancelRenameProfileGroup}
                onToggleAllDesignRows={toggleAllDesignRows}
                onToggleDesignRowSelection={toggleDesignRowSelection}
                onToggleGroupAssignmentProfile={toggleGroupAssignmentProfile}
                onToggleProfileGroupManager={toggleProfileGroupManager}
                onUpdateDataQueryField={updateDataQueryField}
                onUpdateDataRow={updateDataRow}
                onUpdateGroupAssignmentFilter={updateGroupAssignmentFilter}
              />
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
                  onCategoryChange={setActiveStructureCategory}
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
      <AppOverlays
        activeWorkspaceId={activeWorkspaceId}
        confirmDialog={confirmDialog}
        createDatabaseDialog={createDatabaseDialog}
        currentPlatform={currentPlatform}
        dataSourceGroups={dataSourceGroups}
        ddlDialog={ddlDialog}
        exportDialog={exportDialog}
        installedPlugins={installedPlugins}
        packageExtension={pluginPackageExtension}
        pluginManagerBusy={pluginManagerBusy}
        pluginManagerVisible={pluginManagerVisible}
        sqlPreview={sqlPreview}
        toasts={toasts}
        treeContextMenu={treeContextMenu}
        uninstallingPluginId={uninstallingPluginId}
        onCloseConfirmDialog={() => setConfirmDialog(null)}
        onCloseCreateDatabaseDialog={() => setCreateDatabaseDialog(null)}
        onCloseDdlDialog={() => setDdlDialog(null)}
        onCloseExportDialog={() => setExportDialog(null)}
        onClosePluginManager={() => setPluginManagerVisible(false)}
        onCloseSqlPreview={() => setSqlPreview(null)}
        onCloseTreeContextMenu={() => setTreeContextMenu(null)}
        onConfirmExportDialog={() => void confirmExportDialog()}
        onConfirmSqlPreview={() => void sqlPreview?.on_confirm?.()}
        onConfirmUnimplementedAction={confirmUnimplementedAction}
        onCopyExportDialogSql={() => void copyExportDialogSql()}
        onInstallPlugin={handleInstallPlugin}
        onOpenCreateDatabaseDialog={openCreateDatabaseDialog}
        onOpenCreateTableTab={openCreateTableTab}
        onOpenGroupAssignmentTab={openGroupAssignmentTab}
        onOpenPluginWorkspace={(pluginId) => setActiveWorkspaceId(`plugin:${pluginId}`)}
        onOpenTableData={(profileId, databaseName, tableName) => {
          void openTableTab('data', profileId, databaseName, tableName)
        }}
        onOpenTableDesign={(profileId, databaseName, tableName) => {
          void openTableTab('design', profileId, databaseName, tableName)
        }}
        onOpenTableDdl={(profileId, databaseName, tableName) => {
          void openTableDdl(profileId, databaseName, tableName)
        }}
        onOpenTableExportDialog={openTableExportDialog}
        onUninstallPlugin={handleUninstallPlugin}
        onUpdateCreateDatabaseField={updateCreateDatabaseField}
        onUpdateExportDialogFormat={updateExportDialogFormat}
        onUpdateExportDialogScope={updateExportDialogScope}
        onSaveCreateDatabaseDialog={() => void saveCreateDatabaseDialog()}
        onShowToast={pushToast}
      />
    </main>
  )
}

export default App

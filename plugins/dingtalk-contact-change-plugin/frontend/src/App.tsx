import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { invokeHostMethod } from './hostBridge'

type NavView = 'config' | 'query' | 'history'
type PermissionCheckStatus = 'enabled' | 'disabled' | 'skipped'
type QueryStatus = 'success' | 'failed'
type ChangeType = 'none' | 'added' | 'removed'
type QueryUserTab = 'all' | 'added' | 'removed'

type PermissionStatus = {
  key: string
  label: string
  status: PermissionCheckStatus
  detail: string
}

type ConnectionTestResult = {
  tested_at: string
  success: boolean
  message: string
  permissions: PermissionStatus[]
}

type DingtalkConfig = {
  id: string
  name: string
  base_url: string
  app_id: string
  app_secret: string
  last_test_result?: ConnectionTestResult | null
  created_at: string
  updated_at: string
}

type QueryRecordSummary = {
  id: string
  config_id: string
  config_name: string
  queried_at: string
  status: QueryStatus
  total_count: number
  added_count: number
  removed_count: number
  previous_record_id?: string | null
  previous_queried_at?: string | null
  previous_total_count?: number | null
  error_message?: string | null
  compare_rate?: number | null
  compare_rate_label: string
}

type QueryUserItem = {
  user_id: string
  user_name: string
  change_type: ChangeType
}

type QueryDetailResponse = {
  record: QueryRecordSummary
  selected_tab: QueryUserTab
  keyword: string
  page: number
  page_size: number
  total_items: number
  total_pages: number
  users: QueryUserItem[]
}

type HistoryListResponse = {
  items: QueryRecordSummary[]
  page: number
  page_size: number
  total_items: number
  total_pages: number
  config_id?: string | null
  start_date?: string | null
  end_date?: string | null
}

type AppBootstrapResponse = {
  configs: DingtalkConfig[]
  history: HistoryListResponse
}

type ConfigDraft = DingtalkConfig & {
  local_key: string
  is_saved: boolean
  saved_snapshot: DraftSnapshot | null
}

type DraftSnapshot = {
  name: string
  base_url: string
  app_id: string
  app_secret: string
}

type QuerySourceState =
  | { mode: 'latest' }
  | { mode: 'record'; record_id: string }

type PaginationAction = {
  page: number
  label: string
  is_current: boolean
}

const DEFAULT_BASE_URL = 'https://oapi.dingtalk.com'
const HEATMAP_PAGE_SIZE = 500

export default function App() {
  const [navView, setNavView] = useState<NavView>('config')
  const [configDrafts, setConfigDrafts] = useState<ConfigDraft[]>([createDraft(1)])
  const [activeDraftKey, setActiveDraftKey] = useState(configDrafts[0]?.local_key ?? '')
  const [secretVisibleMap, setSecretVisibleMap] = useState<Record<string, boolean>>({})
  const [configSaving, setConfigSaving] = useState(false)
  const [configDeleting, setConfigDeleting] = useState(false)
  const [configDeleteConfirmOpen, setConfigDeleteConfirmOpen] = useState(false)
  const [configTesting, setConfigTesting] = useState(false)
  const [configFeedback, setConfigFeedback] = useState('')
  const [configError, setConfigError] = useState('')

  const [querySelectedConfigId, setQuerySelectedConfigId] = useState('')
  const [querySource, setQuerySource] = useState<QuerySourceState>({ mode: 'latest' })
  const [queryResult, setQueryResult] = useState<QueryDetailResponse | null>(null)
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryError, setQueryError] = useState('')
  const [querySearchInput, setQuerySearchInput] = useState('')

  const [historyData, setHistoryData] = useState<HistoryListResponse>(createEmptyHistory())
  const [historyFilters, setHistoryFilters] = useState({ config_id: '', start_date: '', end_date: '' })
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historyDetailResult, setHistoryDetailResult] = useState<QueryDetailResponse | null>(null)
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false)
  const [historyDetailError, setHistoryDetailError] = useState('')

  const savedConfigs = configDrafts.filter((draft) => draft.is_saved && draft.id.trim().length > 0)
  const activeDraft = configDrafts.find((draft) => draft.local_key === activeDraftKey) ?? configDrafts[0]

  const currentQueryRecordId =
    querySource.mode === 'record' ? querySource.record_id : queryResult?.record.id ?? ''

  useEffect(() => {
    void loadBootstrap({
      keepNav: false,
    })
  }, [])

  useEffect(() => {
    if (querySource.mode !== 'latest' || !querySelectedConfigId) {
      return
    }

    void loadLatestQuery(querySelectedConfigId)
  }, [querySelectedConfigId, querySource.mode])

  useEffect(() => {
    setQuerySearchInput(queryResult?.keyword ?? '')
  }, [queryResult?.record.id, queryResult?.keyword])

  useEffect(() => {
    if (!configFeedback) {
      return
    }

    const timer = window.setTimeout(() => {
      setConfigFeedback('')
    }, 2200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [configFeedback])

  useEffect(() => {
    if (!queryResult) {
      return
    }

    if (querySearchInput.trim() === queryResult.keyword) {
      return
    }

    const timer = window.setTimeout(() => {
      void loadQueryDetail(queryResult.record.id, {
        tab: queryResult.selected_tab,
        keyword: querySearchInput.trim(),
        page: 1,
      })
    }, 320)

    return () => {
      window.clearTimeout(timer)
    }
  }, [querySearchInput, queryResult?.record.id, queryResult?.selected_tab, queryResult?.keyword])

  async function loadBootstrap(options: { keepNav: boolean; preferredConfigId?: string }) {
    try {
      const payload = await invokeHostMethod<AppBootstrapResponse>('app.bootstrap', {})
      const nextDrafts =
        payload.configs.length > 0 ? payload.configs.map(mapConfigToDraft) : [createDraft(1)]
      const preferredDraft =
        nextDrafts.find((draft) => draft.id === options.preferredConfigId) ??
        nextDrafts.find((draft) => draft.is_saved) ??
        nextDrafts[0]
      const preferredQueryConfig =
        nextDrafts.find((draft) => draft.id === options.preferredConfigId && draft.is_saved) ??
        nextDrafts.find((draft) => draft.is_saved)

      setConfigDrafts(nextDrafts)
      setActiveDraftKey(preferredDraft.local_key)
      setHistoryData(payload.history)
      setHistoryFilters({
        config_id: payload.history.config_id ?? '',
        start_date: payload.history.start_date ?? '',
        end_date: payload.history.end_date ?? '',
      })
      setHistoryError('')
      setQuerySelectedConfigId(preferredQueryConfig?.id ?? '')
      setQuerySource({ mode: 'latest' })
      if (!options.keepNav) {
        setNavView(preferredQueryConfig ? 'query' : 'config')
      }
      if (!preferredQueryConfig) {
        setQueryResult(null)
        setQueryError('')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '初始化插件失败'
      setConfigError(message)
      setHistoryError(message)
    }
  }

  async function loadLatestQuery(configId: string) {
    setQueryLoading(true)
    setQueryError('')
    try {
      const result = await invokeHostMethod<QueryDetailResponse | null>('query.get_latest', {
        config_id: configId,
        tab: 'all',
        keyword: '',
        page: 1,
        page_size: HEATMAP_PAGE_SIZE,
      })
      setQueryResult(result)
    } catch (error) {
      setQueryResult(null)
      setQueryError(error instanceof Error ? error.message : '加载最新查询结果失败')
    } finally {
      setQueryLoading(false)
    }
  }

  async function requestQueryDetail(
    queryId: string,
    options: { tab: QueryUserTab; keyword: string; page: number; pageSize?: number },
  ) {
    return invokeHostMethod<QueryDetailResponse>('query.get_detail', {
      query_id: queryId,
      tab: options.tab,
      keyword: options.keyword,
      page: options.page,
      page_size: options.pageSize ?? HEATMAP_PAGE_SIZE,
    })
  }

  async function loadQueryDetail(
    queryId: string,
    options: { tab: QueryUserTab; keyword: string; page: number },
  ) {
    setQueryLoading(true)
    setQueryError('')
    try {
      const result = await requestQueryDetail(queryId, {
        ...options,
        pageSize: queryResult?.page_size ?? HEATMAP_PAGE_SIZE,
      })
      setQueryResult(result)
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : '加载查询明细失败')
    } finally {
      setQueryLoading(false)
    }
  }

  async function loadHistory(page = historyData.page || 1) {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const payload = await invokeHostMethod<HistoryListResponse>('history.list', {
        config_id: historyFilters.config_id,
        start_date: historyFilters.start_date,
        end_date: historyFilters.end_date,
        page,
        page_size: historyData.page_size || 8,
      })
      setHistoryData(payload)
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : '加载历史记录失败')
    } finally {
      setHistoryLoading(false)
    }
  }

  async function handleSaveConfig() {
    if (!activeDraft) {
      return
    }

    setConfigSaving(true)
    setConfigError('')
    setConfigFeedback('')

    try {
      const saved = await invokeHostMethod<DingtalkConfig>('config.save', {
        id: activeDraft.is_saved ? activeDraft.id : null,
        name: activeDraft.name,
        base_url: activeDraft.base_url,
        app_id: activeDraft.app_id,
        app_secret: activeDraft.app_secret,
      })

      setConfigDrafts((current) =>
        current.map((draft) => {
          if (draft.local_key !== activeDraft.local_key) {
            return draft
          }

          const nextSnapshot = createDraftSnapshot(saved)
          return {
            ...saved,
            local_key: saved.id,
            is_saved: true,
            last_test_result: draft.last_test_result ?? saved.last_test_result ?? null,
            saved_snapshot: nextSnapshot,
          }
        }),
      )
      setActiveDraftKey(saved.id)
      setConfigFeedback(`${saved.name} 已保存`)
      setQuerySelectedConfigId((current) => current || saved.id)
      setConfigError('')
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : '保存配置失败')
    } finally {
      setConfigSaving(false)
    }
  }

  async function handleTestConnection() {
    if (!activeDraft) {
      return
    }

    setConfigTesting(true)
    setConfigError('')
    setConfigFeedback('')

    try {
      const result = await invokeHostMethod<ConnectionTestResult>('config.test_connection', {
        config_id: activeDraft.is_saved ? activeDraft.id : null,
        base_url: activeDraft.base_url,
        app_id: activeDraft.app_id,
        app_secret: activeDraft.app_secret,
      })
      setConfigDrafts((current) =>
        current.map((draft) =>
          draft.local_key === activeDraft.local_key
            ? {
                ...draft,
                last_test_result: result,
              }
            : draft,
        ),
      )
      setConfigFeedback(result.message)
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : '测试连接失败')
    } finally {
      setConfigTesting(false)
    }
  }

  async function handleDeleteConfig() {
    if (!activeDraft?.is_saved || !activeDraft.id) {
      return
    }

    setConfigDeleting(true)
    setConfigError('')
    setConfigFeedback('')

    try {
      await invokeHostMethod<boolean>('config.delete', {
        config_id: activeDraft.id,
      })
      setConfigDeleteConfirmOpen(false)
      await loadBootstrap({
        keepNav: true,
      })
      setConfigFeedback(`${activeDraft.name} 已删除`)
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : '删除配置失败')
    } finally {
      setConfigDeleting(false)
    }
  }

  async function handleRunQuery() {
    if (!querySelectedConfigId) {
      return
    }

    setQueryLoading(true)
    setQueryError('')
    setQuerySource({ mode: 'latest' })
    try {
      const result = await invokeHostMethod<QueryDetailResponse>('query.run', {
        config_id: querySelectedConfigId,
      })
      setQueryResult(result)
      await loadHistory(1)
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : '执行查询失败')
      await loadHistory(1)
    } finally {
      setQueryLoading(false)
    }
  }

  async function handleHistoryOpenDetail(item: QueryRecordSummary) {
    setHistoryDetailLoading(true)
    setHistoryDetailError('')
    try {
      const result = await requestQueryDetail(item.id, {
        tab: 'all',
        keyword: '',
        page: 1,
        pageSize: HEATMAP_PAGE_SIZE,
      })
      setHistoryDetailResult(result)
    } catch (error) {
      setHistoryDetailError(error instanceof Error ? error.message : '加载历史详情失败')
    } finally {
      setHistoryDetailLoading(false)
    }
  }

  async function handleHistoryDetailChange(options: {
    queryId: string
    tab: QueryUserTab
    keyword: string
    page: number
  }) {
    setHistoryDetailLoading(true)
    setHistoryDetailError('')
    try {
      const result = await requestQueryDetail(options.queryId, {
        tab: options.tab,
        keyword: options.keyword,
        page: options.page,
        pageSize: historyDetailResult?.page_size ?? HEATMAP_PAGE_SIZE,
      })
      setHistoryDetailResult(result)
    } catch (error) {
      setHistoryDetailError(error instanceof Error ? error.message : '加载历史详情失败')
    } finally {
      setHistoryDetailLoading(false)
    }
  }

  function handleCloseHistoryDetail() {
    setHistoryDetailResult(null)
    setHistoryDetailError('')
  }

  function handleAddConfigDraft() {
    const nextDraft = createDraft(configDrafts.length + 1)
    setConfigDrafts((current) => [...current, nextDraft])
    setActiveDraftKey(nextDraft.local_key)
    setConfigFeedback('')
    setConfigError('')
    setNavView('config')
  }

  function handleActiveDraftChange(field: keyof DingtalkConfig, value: string) {
    if (!activeDraft) {
      return
    }

    if (configFeedback) {
      setConfigFeedback('')
    }

    setConfigDrafts((current) =>
      current.map((draft) =>
        draft.local_key === activeDraft.local_key
          ? {
              ...draft,
              [field]: value,
            }
          : draft,
      ),
    )
  }

  function handleQueryTabChange(tab: QueryUserTab) {
    if (!queryResult) {
      return
    }

    void loadQueryDetail(currentQueryRecordId, {
      tab,
      keyword: querySearchInput.trim(),
      page: 1,
    })
  }

  function handleQueryPageChange(page: number) {
    if (!queryResult || page === queryResult.page) {
      return
    }

    void loadQueryDetail(currentQueryRecordId, {
      tab: queryResult.selected_tab,
      keyword: querySearchInput.trim(),
      page,
    })
  }

  function handleHistoryPageChange(page: number) {
    if (page === historyData.page) {
      return
    }
    void loadHistory(page)
  }

  function handleReturnLatest() {
    if (!querySelectedConfigId) {
      return
    }
    setQuerySource({ mode: 'latest' })
    void loadLatestQuery(querySelectedConfigId)
  }

  function renderMainContent() {
    if (navView === 'config') {
      return (
        <ConfigPage
          drafts={configDrafts}
          activeDraft={activeDraft}
          activeDraftKey={activeDraftKey}
          configSaving={configSaving}
          configDeleting={configDeleting}
          configDeleteConfirmOpen={configDeleteConfirmOpen}
          configTesting={configTesting}
          configFeedback={configFeedback}
          configError={configError}
          isSaveDisabled={!activeDraft || !hasDraftChanges(activeDraft)}
          secretVisibleMap={secretVisibleMap}
          onSelectDraft={setActiveDraftKey}
          onAddDraft={handleAddConfigDraft}
          onFieldChange={handleActiveDraftChange}
          onToggleSecret={(key) =>
            setSecretVisibleMap((current) => ({
              ...current,
              [key]: !current[key],
            }))
          }
          onSave={handleSaveConfig}
          onDelete={() => setConfigDeleteConfirmOpen(true)}
          onConfirmDelete={handleDeleteConfig}
          onCancelDelete={() => setConfigDeleteConfirmOpen(false)}
          onTest={handleTestConnection}
        />
      )
    }

    if (navView === 'history') {
      return (
        <HistoryPage
          configs={savedConfigs}
          historyData={historyData}
          historyFilters={historyFilters}
          historyLoading={historyLoading}
          historyError={historyError}
          historyDetailResult={historyDetailResult}
          historyDetailLoading={historyDetailLoading}
          historyDetailError={historyDetailError}
          onChangeFilter={(field, value) =>
            setHistoryFilters((current) => ({
              ...current,
              [field]: value,
            }))
          }
          onSearch={() => {
            void loadHistory(1)
          }}
          onOpenDetail={handleHistoryOpenDetail}
          onCloseDetail={handleCloseHistoryDetail}
          onDetailTabChange={(tab) => {
            if (!historyDetailResult) {
              return
            }
            void handleHistoryDetailChange({
              queryId: historyDetailResult.record.id,
              tab,
              keyword: historyDetailResult.keyword,
              page: 1,
            })
          }}
          onDetailSearchChange={(value) => {
            if (!historyDetailResult) {
              return
            }
            void handleHistoryDetailChange({
              queryId: historyDetailResult.record.id,
              tab: historyDetailResult.selected_tab,
              keyword: value,
              page: 1,
            })
          }}
          onDetailPageChange={(page) => {
            if (!historyDetailResult || page === historyDetailResult.page) {
              return
            }
            void handleHistoryDetailChange({
              queryId: historyDetailResult.record.id,
              tab: historyDetailResult.selected_tab,
              keyword: historyDetailResult.keyword,
              page,
            })
          }}
          onPageChange={handleHistoryPageChange}
        />
      )
    }

    return (
      <QueryPage
        configs={savedConfigs}
        selectedConfigId={querySelectedConfigId}
        querySource={querySource}
        queryResult={queryResult}
        queryLoading={queryLoading}
        queryError={queryError}
        querySearchInput={querySearchInput}
        onSelectConfig={(value) => {
          setQuerySource({ mode: 'latest' })
          setQuerySelectedConfigId(value)
        }}
        onRunQuery={handleRunQuery}
        onSearchInputChange={setQuerySearchInput}
        onTabChange={handleQueryTabChange}
        onPageChange={handleQueryPageChange}
        onReturnLatest={handleReturnLatest}
      />
    )
  }

  return (
    <div className="plugin-page">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="ambient ambient-three" />

      <div className="workspace-shell">
        <aside className="sidebar glass-panel">
          <div className="sidebar-group">
            <span className="sidebar-label">系统设置</span>
            <button
              className={navView === 'config' ? 'sidebar-link is-active' : 'sidebar-link'}
              onClick={() => setNavView('config')}
            >
              <Icon name="settings" />
              <span>钉钉配置</span>
            </button>
          </div>

          <div className="sidebar-group">
            <span className="sidebar-label">查询管理</span>
            <button
              className={navView === 'query' ? 'sidebar-link is-active' : 'sidebar-link'}
              onClick={() => setNavView('query')}
            >
              <Icon name="search" />
              <span>通讯录查询</span>
            </button>
            <button
              className={navView === 'history' ? 'sidebar-link is-active' : 'sidebar-link'}
              onClick={() => setNavView('history')}
            >
              <Icon name="history" />
              <span>历史记录</span>
            </button>
          </div>

          <div className="sidebar-footer">
            <span>power by wx_guzb_7558</span>
          </div>
        </aside>

        <main className="content-area">
          {renderMainContent()}
        </main>
      </div>
    </div>
  )
}

type ConfigPageProps = {
  drafts: ConfigDraft[]
  activeDraft: ConfigDraft
  activeDraftKey: string
  configSaving: boolean
  configDeleting: boolean
  configDeleteConfirmOpen: boolean
  configTesting: boolean
  configFeedback: string
  configError: string
  isSaveDisabled: boolean
  secretVisibleMap: Record<string, boolean>
  onSelectDraft: (key: string) => void
  onAddDraft: () => void
  onFieldChange: (field: keyof DingtalkConfig, value: string) => void
  onToggleSecret: (key: string) => void
  onSave: () => void
  onDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onTest: () => void
}

function ConfigPage(props: ConfigPageProps) {
  const activeTest = props.activeDraft?.last_test_result ?? null
  const isSecretVisible = props.secretVisibleMap[props.activeDraftKey] ?? false
  const visiblePermissions =
    activeTest?.permissions.filter((permission) => permission.key !== 'user_detail') ?? []

  return (
    <>
      <div className="content-scroll compact-layout config-layout">
        {props.configFeedback && !props.configError && (
          <div className="status-toast-wrap">
            <StatusBanner tone="success" title="处理成功" message={props.configFeedback} />
          </div>
        )}

        <section className="glass-panel section-panel">
          <div className="tabbar">
            <div className="tabbar-list">
              {props.drafts.map((draft) => (
                <button
                  key={draft.local_key}
                  className={draft.local_key === props.activeDraftKey ? 'tab-chip is-active' : 'tab-chip'}
                  onClick={() => props.onSelectDraft(draft.local_key)}
                >
                  {draft.name}
                </button>
              ))}
            </div>
            <button className="ghost-action" onClick={props.onAddDraft}>
              <Icon name="plus" />
              <span>新增配置</span>
            </button>
          </div>

          {props.configError && (
            <StatusBanner
              tone="error"
              title="处理失败"
              message={props.configError}
            />
          )}

          <div className="form-stack">
            <FormField label="配置名称" required>
              <input
                value={props.activeDraft?.name ?? ''}
                onChange={(event) => props.onFieldChange('name', event.currentTarget.value)}
                placeholder="自定义当前钉钉配置名称，便于查询页快速区分"
              />
            </FormField>

            <FormField label="接口域名 (baseUrl)" required>
              <input
                value={props.activeDraft?.base_url ?? ''}
                onChange={(event) => props.onFieldChange('base_url', event.currentTarget.value)}
                placeholder="钉钉开放平台接口域名，通常无需修改"
              />
            </FormField>

            <FormField label="应用ID (appId)" required>
              <input
                value={props.activeDraft?.app_id ?? ''}
                onChange={(event) => props.onFieldChange('app_id', event.currentTarget.value)}
                placeholder="在钉钉开放平台创建应用后获取的 AppKey"
              />
            </FormField>

            <FormField label="应用密钥 (appSecret)" required>
              <div className="secret-input">
                <input
                  type={isSecretVisible ? 'text' : 'password'}
                  value={props.activeDraft?.app_secret ?? ''}
                  onChange={(event) => props.onFieldChange('app_secret', event.currentTarget.value)}
                  placeholder="在钉钉开放平台创建应用后获取的 AppSecret"
                />
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => props.onToggleSecret(props.activeDraftKey)}
                  aria-label={isSecretVisible ? '隐藏密钥' : '显示密钥'}
                >
                  <Icon name={isSecretVisible ? 'eye-off' : 'eye'} />
                </button>
              </div>
            </FormField>
          </div>

          <div className="action-row action-row-bottom">
            <button
              className="primary-action"
              onClick={props.onSave}
              disabled={props.configSaving || props.isSaveDisabled}
            >
              <Icon name="save" />
              <span>{props.configSaving ? '保存中...' : '保存配置'}</span>
            </button>
            <button className="secondary-action" onClick={props.onTest} disabled={props.configTesting}>
              <Icon name="refresh" />
              <span>{props.configTesting ? '测试中...' : '测试连接'}</span>
            </button>
            <button
              className="danger-action"
              onClick={props.onDelete}
              disabled={props.configDeleting || !props.activeDraft?.is_saved}
            >
              <Icon name="close" />
              <span>{props.configDeleting ? '删除中...' : '删除配置'}</span>
            </button>
          </div>

          {props.configDeleteConfirmOpen && props.activeDraft?.is_saved && (
            <div className="delete-confirm-panel">
              <strong>确认删除当前配置？</strong>
              <p>删除后将无法继续用于查询，但不会影响已生成的历史查询记录。</p>
              <div className="delete-confirm-actions">
                <button className="secondary-action" onClick={props.onCancelDelete} disabled={props.configDeleting}>
                  取消
                </button>
                <button className="danger-action" onClick={props.onConfirmDelete} disabled={props.configDeleting}>
                  {props.configDeleting ? '删除中...' : '确认删除'}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="glass-panel section-panel">
          <div className="section-head">
            <h2>连接测试结果</h2>
          </div>

          {activeTest ? (
            <>
              <StatusBanner
                tone={activeTest.success ? 'success' : 'error'}
                title={activeTest.success ? '连接成功' : '连接失败'}
                message={`${activeTest.tested_at} ${activeTest.message}`}
              />

              {visiblePermissions.length > 0 && (
                <div className="permission-list">
                  {visiblePermissions.map((permission) => (
                    <div key={permission.key} className="permission-row">
                      <div className="permission-copy">
                        <StatusDot status={permission.status} />
                        <div>
                          <strong>{permission.label}</strong>
                          <p>{permission.detail}</p>
                        </div>
                      </div>
                      <StatusTag status={permission.status} />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <EmptyState
              title="暂无测试结果"
              description="保存或测试当前配置后，这里会展示连接状态与权限校验结果。"
            />
          )}
        </section>
      </div>
    </>
  )
}

type QueryPageProps = {
  configs: ConfigDraft[]
  selectedConfigId: string
  querySource: QuerySourceState
  queryResult: QueryDetailResponse | null
  queryLoading: boolean
  queryError: string
  querySearchInput: string
  onSelectConfig: (value: string) => void
  onRunQuery: () => void
  onSearchInputChange: (value: string) => void
  onTabChange: (tab: QueryUserTab) => void
  onPageChange: (page: number) => void
  onReturnLatest: () => void
}

function QueryPage(props: QueryPageProps) {
  return (
    <>
      <div className="content-scroll compact-layout query-layout">
        <section className="glass-panel config-selector-panel">
          <div className="selector-inline">
            <label>钉钉配置</label>
            <div className="select-shell">
              <select
                value={props.selectedConfigId}
                onChange={(event) => props.onSelectConfig(event.currentTarget.value)}
              >
                <option value="">请选择钉钉配置</option>
                {props.configs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            className="primary-action"
            onClick={props.onRunQuery}
            disabled={props.queryLoading || !props.selectedConfigId}
          >
            <Icon name="refresh" />
            <span>{props.queryLoading ? '查询中...' : '立即查询'}</span>
          </button>
        </section>

        {props.queryError && (
          <StatusBanner tone="error" title="查询失败" message={props.queryError} />
        )}

        {props.querySource.mode === 'record' && (
          <div className="history-detail-bar glass-panel">
            <span>当前正在查看历史记录详情</span>
            <button className="secondary-action" onClick={props.onReturnLatest}>
              <span>返回最新结果</span>
            </button>
          </div>
        )}

        {props.queryResult ? (
          <QueryResultPanel
            result={props.queryResult}
            searchInput={props.querySearchInput}
            onSearchInputChange={props.onSearchInputChange}
            onTabChange={props.onTabChange}
            onPageChange={props.onPageChange}
          />
        ) : (
          <section className="glass-panel section-panel">
            <EmptyState
              title={props.selectedConfigId ? '暂无查询结果' : '请选择钉钉配置'}
              description={
                props.selectedConfigId
                  ? '当前配置还没有成功查询记录，点击“立即查询”后将在这里展示结果。'
                  : '请先在配置管理页保存至少一个钉钉配置，再执行通讯录查询。'
              }
            />
          </section>
        )}
      </div>
    </>
  )
}

function QueryResultPanel(props: {
  result: QueryDetailResponse
  searchInput: string
  onSearchInputChange: (value: string) => void
  onTabChange: (tab: QueryUserTab) => void
  onPageChange: (page: number) => void
}) {
  const tabSummary = [
    { key: 'all' as QueryUserTab, label: `全部用户 (${props.result.record.total_count})` },
    { key: 'added' as QueryUserTab, label: `新增用户 (${props.result.record.added_count})` },
    { key: 'removed' as QueryUserTab, label: `删除用户 (${props.result.record.removed_count})` },
  ]

  return (
    <>
      <div className="stat-grid">
        <StatCard
          label="总用户数"
          value={String(props.result.record.total_count)}
          hint={props.result.record.compare_rate_label}
          accent="blue"
          icon="users"
        />
        <StatCard
          label="新增用户"
          value={String(props.result.record.added_count)}
          hint="自上次查询以来新增"
          accent="green"
          icon="user-add"
        />
        <StatCard
          label="离职/删除用户"
          value={String(props.result.record.removed_count)}
          hint="自上次查询以来删除"
          accent="red"
          icon="user-remove"
        />
        <StatCard
          label="上次查询时间"
          value={props.result.record.previous_queried_at ? props.result.record.previous_queried_at.slice(0, 10) : '首次查询'}
          hint={props.result.record.previous_queried_at ? props.result.record.previous_queried_at.slice(11) : '暂无历史基线'}
          accent="violet"
          icon="clock"
          compact
        />
      </div>

      <section className="glass-panel info-card">
        <div className="info-inline">
          <Icon name="info" />
          <strong>
            本次查询时间：{props.result.record.queried_at}，共查询到 {props.result.record.total_count} 位用户，
            对比上次查询有 {props.result.record.added_count + props.result.record.removed_count} 条变动记录
          </strong>
        </div>
        {props.result.record.status === 'failed' && props.result.record.error_message && (
          <p className="error-copy">{props.result.record.error_message}</p>
        )}
      </section>

      <div className="query-tabs">
        {tabSummary.map((tab) => (
          <button
            key={tab.key}
            className={props.result.selected_tab === tab.key ? 'query-tab is-active' : 'query-tab'}
            onClick={() => props.onTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className="query-toolbar">
        <div className="glass-panel heatmap-toolbar-panel">
          <div className="search-field">
            <Icon name="search" />
            <input
              value={props.searchInput}
              onChange={(event) => props.onSearchInputChange(event.currentTarget.value)}
              placeholder="搜索用户姓名"
            />
          </div>

          <div className="heatmap-legend">
            <div className="legend-item">
              <span className="legend-swatch is-added" />
              <span>新增用户</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch is-removed" />
              <span>删除/离职用户</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch is-none" />
              <span>无变动用户</span>
            </div>
          </div>
        </div>
      </section>

      <section className="glass-panel heatmap-grid-panel">
        {props.result.users.length > 0 ? (
          <div className="heatmap-grid">
            {props.result.users.map((user, index) => (
              <div
                key={`${user.user_id}-${user.change_type}`}
                className={`heatmap-card is-${user.change_type}`}
              >
                <span className="heatmap-card-index">
                  {(props.result.page - 1) * props.result.page_size + index + 1}
                </span>
                <strong>{user.user_name}</strong>
                <span className="heatmap-card-status">{renderChangeTypeLabel(user.change_type)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="暂无查询结果"
            description="当前条件下没有匹配的用户记录。"
          />
        )}

        {props.result.total_pages > 1 && (
          <Pagination
            page={props.result.page}
            totalPages={props.result.total_pages}
            totalItems={props.result.total_items}
            pageSize={props.result.page_size}
            onChange={props.onPageChange}
          />
        )}
      </section>
    </>
  )
}

type HistoryPageProps = {
  configs: ConfigDraft[]
  historyData: HistoryListResponse
  historyFilters: { config_id: string; start_date: string; end_date: string }
  historyLoading: boolean
  historyError: string
  historyDetailResult: QueryDetailResponse | null
  historyDetailLoading: boolean
  historyDetailError: string
  onChangeFilter: (field: 'config_id' | 'start_date' | 'end_date', value: string) => void
  onSearch: () => void
  onOpenDetail: (item: QueryRecordSummary) => void
  onCloseDetail: () => void
  onDetailTabChange: (tab: QueryUserTab) => void
  onDetailSearchChange: (value: string) => void
  onDetailPageChange: (page: number) => void
  onPageChange: (page: number) => void
}

function HistoryPage(props: HistoryPageProps) {
  if (props.historyDetailLoading && !props.historyDetailResult) {
    return (
      <div className="content-scroll compact-layout history-layout">
        <section className="glass-panel section-panel">
          <EmptyState title="历史详情加载中" description="正在读取本次历史查询结果，请稍候。" />
        </section>
      </div>
    )
  }

  if (props.historyDetailResult) {
    return (
      <div className="content-scroll compact-layout history-layout">
        <div className="history-detail-bar glass-panel">
          <span>当前正在查看历史记录详情</span>
          <button className="secondary-action" onClick={props.onCloseDetail}>
            <span>返回历史记录</span>
          </button>
        </div>

        {props.historyDetailError && (
          <StatusBanner tone="error" title="历史详情加载失败" message={props.historyDetailError} />
        )}

        <QueryResultPanel
          result={props.historyDetailResult}
          searchInput={props.historyDetailResult.keyword}
          onSearchInputChange={props.onDetailSearchChange}
          onTabChange={props.onDetailTabChange}
          onPageChange={props.onDetailPageChange}
        />
      </div>
    )
  }

  return (
    <>
      <div className="content-scroll compact-layout history-layout">
        <section className="glass-panel filter-panel">
          <div className="date-filter-group">
            <label>钉钉配置</label>
            <div className="select-shell">
              <select
                value={props.historyFilters.config_id}
                onChange={(event) => props.onChangeFilter('config_id', event.currentTarget.value)}
              >
                <option value="">全部配置</option>
                {props.configs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="date-filter-group">
            <label>开始时间</label>
            <input
              type="date"
              value={props.historyFilters.start_date}
              onChange={(event) => props.onChangeFilter('start_date', event.currentTarget.value)}
            />
          </div>

          <span className="date-connector">至</span>

          <div className="date-filter-group">
            <label>结束时间</label>
            <input
              type="date"
              value={props.historyFilters.end_date}
              onChange={(event) => props.onChangeFilter('end_date', event.currentTarget.value)}
            />
          </div>

          <button className="primary-action" onClick={props.onSearch} disabled={props.historyLoading}>
            <Icon name="search" />
            <span>{props.historyLoading ? '查询中...' : '查询记录'}</span>
          </button>
        </section>

        {props.historyError && (
          <StatusBanner tone="error" title="历史记录加载失败" message={props.historyError} />
        )}

        <section className="glass-panel table-panel">
          <div className="history-table-head">
            <div className="history-cell history-time">查询时间</div>
            <div className="history-cell">钉钉配置</div>
            <div className="history-cell">用户总数</div>
            <div className="history-cell">新增用户</div>
            <div className="history-cell">删除用户</div>
            <div className="history-cell">查询状态</div>
            <div className="history-cell history-action">操作</div>
          </div>

          {props.historyData.items.length > 0 ? (
            props.historyData.items.map((item) => (
              <div key={item.id} className="history-table-row">
                <div className="history-cell history-time">
                  <strong>{formatHistoryDate(item.queried_at)}</strong>
                  <span>{formatHistoryTime(item.queried_at)}</span>
                </div>
                <div className="history-cell history-config-name">{item.config_name}</div>
                <div className="history-cell">{item.total_count}</div>
                <div className="history-cell history-positive">
                  {item.added_count > 0 ? `+${item.added_count}` : item.added_count}
                </div>
                <div className="history-cell history-negative">
                  {item.removed_count > 0 ? `-${item.removed_count}` : item.removed_count}
                </div>
                <div className="history-cell">
                  <span className={`status-pill is-${item.status}`}>
                    <span className="status-pill-dot" />
                    {item.status === 'success' ? '成功' : '失败'}
                  </span>
                </div>
                <div className="history-cell history-action">
                  <button className="link-button" onClick={() => props.onOpenDetail(item)}>
                    查看详情
                  </button>
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              title="暂无历史记录"
              description="当前筛选条件下没有查询记录，可以先去“通讯录查询”页执行一次查询。"
            />
          )}

          {props.historyData.total_pages > 1 && (
            <Pagination
              page={props.historyData.page}
              totalPages={props.historyData.total_pages}
              totalItems={props.historyData.total_items}
              pageSize={props.historyData.page_size}
              onChange={props.onPageChange}
            />
          )}
        </section>
      </div>
    </>
  )
}

function formatHistoryDate(value: string) {
  const [date] = value.split(' ')
  return date ?? value
}

function formatHistoryTime(value: string) {
  const [, time] = value.split(' ')
  return time ?? ''
}

function FormField(props: {
  label: string
  helper?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <label className="field-block">
      <div className="field-label">
        <span>{props.label}</span>
        {props.required && <em>*</em>}
      </div>
      {props.children}
      {props.helper ? <span className="field-helper">{props.helper}</span> : null}
    </label>
  )
}

function StatusBanner(props: {
  tone: 'success' | 'error'
  title: string
  message: string
}) {
  return (
    <div className={`status-banner is-${props.tone}`}>
      <div className="status-banner-icon">
        <Icon name={props.tone === 'success' ? 'check' : 'close'} />
      </div>
      <div>
        <strong>{props.title}</strong>
        <p>{props.message}</p>
      </div>
    </div>
  )
}

function StatusTag({ status }: { status: PermissionCheckStatus }) {
  const label = status === 'enabled' ? '已开通' : '未开通'
  return <span className={`status-pill is-${status}`}>{label}</span>
}

function StatusDot({ status }: { status: PermissionCheckStatus }) {
  return <span className={`status-dot is-${status}`} />
}

function EmptyState(props: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name="info" />
      </div>
      <strong>{props.title}</strong>
      <p>{props.description}</p>
    </div>
  )
}

function StatCard(props: {
  label: string
  value: string
  hint: string
  accent: 'blue' | 'green' | 'red' | 'violet'
  icon: IconName
  compact?: boolean
}) {
  return (
    <section className="glass-panel stat-card">
      <div className="stat-head">
        <span>{props.label}</span>
        <span className={`stat-icon is-${props.accent}`}>
          <Icon name={props.icon} />
        </span>
      </div>
      <div className={props.compact ? 'stat-value is-compact' : 'stat-value'}>{props.value}</div>
      <p className={props.accent === 'green' ? 'stat-hint is-positive' : 'stat-hint'}>{props.hint}</p>
    </section>
  )
}

function Pagination(props: {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  onChange: (page: number) => void
}) {
  const actions = useMemo(
    () => buildPaginationActions(props.page, props.totalPages),
    [props.page, props.totalPages],
  )
  const start = props.totalItems === 0 ? 0 : (props.page - 1) * props.pageSize + 1
  const end = Math.min(props.page * props.pageSize, props.totalItems)

  return (
    <div className="pagination">
      <span className="pagination-copy">
        显示 {start} 到 {end} 条，共 {props.totalItems} 条记录
      </span>
      <div className="pagination-actions">
        <button
          className="pagination-button"
          onClick={() => props.onChange(Math.max(1, props.page - 1))}
          disabled={props.page <= 1}
        >
          ‹
        </button>
        {actions.map((action) => (
          <button
            key={action.label}
            className={action.is_current ? 'pagination-button is-current' : 'pagination-button'}
            onClick={() => props.onChange(action.page)}
            disabled={action.is_current}
          >
            {action.label}
          </button>
        ))}
        <button
          className="pagination-button"
          onClick={() => props.onChange(Math.min(props.totalPages, props.page + 1))}
          disabled={props.page >= props.totalPages}
        >
          ›
        </button>
      </div>
    </div>
  )
}

type IconName =
  | 'brand'
  | 'settings'
  | 'search'
  | 'history'
  | 'plus'
  | 'eye'
  | 'eye-off'
  | 'save'
  | 'refresh'
  | 'check'
  | 'close'
  | 'users'
  | 'user-add'
  | 'user-remove'
  | 'clock'
  | 'info'

function Icon({ name }: { name: IconName }) {
  const { d, fillRule } = iconPathMap[name]
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fillRule={fillRule} />
    </svg>
  )
}

const iconPathMap: Record<IconName, { d: string; fillRule?: 'evenodd' | 'nonzero' }> = {
  brand: {
    d: 'M7 2.75A3.25 3.25 0 0 0 3.75 6v12A3.25 3.25 0 0 0 7 21.25h10A3.25 3.25 0 0 0 20.25 18V8.965a3.25 3.25 0 0 0-.952-2.298l-2.965-2.965A3.25 3.25 0 0 0 14.035 2.75H7Zm0 1.5h7v4.5a1.75 1.75 0 0 0 1.75 1.75h3v7.5A1.75 1.75 0 0 1 17 19.75H7A1.75 1.75 0 0 1 5.25 18V6A1.75 1.75 0 0 1 7 4.25Zm8.5.31 2.94 2.94h-2.69a.25.25 0 0 1-.25-.25V4.56ZM8 12a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 8 12Zm0 3.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 8 15.5Z',
  },
  settings: {
    d: 'M11.25 2.75a.75.75 0 0 1 1.5 0v1.127a8.224 8.224 0 0 1 1.963.812l.797-.797a.75.75 0 1 1 1.06 1.06l-.797.798c.338.604.614 1.253.812 1.963h1.127a.75.75 0 0 1 0 1.5h-1.127a8.229 8.229 0 0 1-.812 1.964l.797.797a.75.75 0 0 1-1.06 1.06l-.797-.797a8.225 8.225 0 0 1-1.963.812v1.127a.75.75 0 0 1-1.5 0v-1.127a8.224 8.224 0 0 1-1.963-.812l-.797.797a.75.75 0 0 1-1.06-1.06l.797-.797a8.228 8.228 0 0 1-.812-1.964H3.75a.75.75 0 0 1 0-1.5h1.127a8.227 8.227 0 0 1 .812-1.963l-.797-.798a.75.75 0 0 1 1.06-1.06l.797.797a8.223 8.223 0 0 1 1.963-.812V2.75ZM12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25Zm0 1.5A2.25 2.25 0 1 1 12 14.25 2.25 2.25 0 0 1 12 9.75Z',
  },
  search: {
    d: 'M10.5 4.25a6.25 6.25 0 1 0 3.933 11.109l3.104 3.103a.75.75 0 1 0 1.06-1.06l-3.103-3.104A6.25 6.25 0 0 0 10.5 4.25Zm-4.75 6.25a4.75 4.75 0 1 1 9.5 0 4.75 4.75 0 0 1-9.5 0Z',
  },
  history: {
    d: 'M11.25 4.5A7.5 7.5 0 1 1 5.03 7.81H3.75a.75.75 0 0 1 0-1.5h3a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0V8.896A6 6 0 1 0 11.25 6v2.563l2.47 1.482a.75.75 0 0 1-.77 1.288l-2.835-1.701a.75.75 0 0 1-.365-.643V4.5h1.5Z',
  },
  plus: {
    d: 'M12 4.25a.75.75 0 0 1 .75.75v6.25H19a.75.75 0 0 1 0 1.5h-6.25V19a.75.75 0 0 1-1.5 0v-6.25H5a.75.75 0 0 1 0-1.5h6.25V5a.75.75 0 0 1 .75-.75Z',
  },
  eye: {
    d: 'M12 5.25c4.623 0 8.146 3.17 9.603 6.247a1.2 1.2 0 0 1 0 1.006C20.146 15.58 16.623 18.75 12 18.75s-8.146-3.17-9.603-6.247a1.2 1.2 0 0 1 0-1.006C3.854 8.42 7.377 5.25 12 5.25Zm0 1.5c-3.818 0-6.875 2.586-8.128 5.25C5.125 14.664 8.182 17.25 12 17.25s6.875-2.586 8.128-5.25C18.875 9.336 15.818 6.75 12 6.75Zm0 2.25a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  },
  'eye-off': {
    d: 'M4.28 3.22a.75.75 0 0 1 1.06 0l14.5 14.5a.75.75 0 1 1-1.06 1.06l-2.43-2.43A10.56 10.56 0 0 1 12 18.75c-4.623 0-8.146-3.17-9.603-6.247a1.2 1.2 0 0 1 0-1.006 11.454 11.454 0 0 1 3.473-4.117L4.28 4.28a.75.75 0 0 1 0-1.06Zm2.67 5.852A9.803 9.803 0 0 0 3.872 12C5.125 14.664 8.182 17.25 12 17.25a9.08 9.08 0 0 0 3.17-.564l-2.013-2.012A3 3 0 0 1 9.326 10.84L6.95 9.072Zm3.46 3.46 2.058 2.058A1.5 1.5 0 0 1 10.41 12.53Zm4.218-1.096a3 3 0 0 0-3.064-3.064l-1.86-1.86A9.41 9.41 0 0 1 12 6.75c3.818 0 6.875 2.586 8.128 5.25a10.163 10.163 0 0 1-1.95 2.676l-1.818-1.818c.175-.403.268-.848.268-1.322Z',
  },
  save: {
    d: 'M5 3.75A2.25 2.25 0 0 0 2.75 6v12A2.25 2.25 0 0 0 5 20.25h14A2.25 2.25 0 0 0 21.25 18V7.31a2.25 2.25 0 0 0-.659-1.591l-2.31-2.31A2.25 2.25 0 0 0 16.69 2.75H5Zm0 1.5h10.5v3.25A1.5 1.5 0 0 0 17 10h2.75v8A.75.75 0 0 1 19 18.75H5A.75.75 0 0 1 4.25 18V6A.75.75 0 0 1 5 5.25Zm9.75 0h1.94l2.31 2.31a.75.75 0 0 1 .22.53V8.5H17a.75.75 0 0 1-.75-.75V5.25Zm-7 7A1.75 1.75 0 0 1 9.5 10.5h5A1.75 1.75 0 0 1 16.25 12.25v4.5A1.75 1.75 0 0 1 14.5 18.5h-5a1.75 1.75 0 0 1-1.75-1.75v-4.5Zm1.5 0v4.5a.25.25 0 0 0 .25.25h5a.25.25 0 0 0 .25-.25v-4.5a.25.25 0 0 0-.25-.25h-5a.25.25 0 0 0-.25.25Z',
  },
  refresh: {
    d: 'M12 4.25a7.75 7.75 0 0 1 6.907 4.232V6.75a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-.75.75h-4a.75.75 0 0 1 0-1.5h2.49A6.25 6.25 0 1 0 18.25 12a.75.75 0 0 1 1.5 0A7.75 7.75 0 1 1 12 4.25Z',
  },
  check: {
    d: 'M12 2.75a9.25 9.25 0 1 1 0 18.5 9.25 9.25 0 0 1 0-18.5Zm3.198 6.617a.75.75 0 0 0-1.06-1.06L10.5 11.944 9.11 10.553a.75.75 0 0 0-1.06 1.06l1.92 1.92a.75.75 0 0 0 1.06 0l4.168-4.166Z',
  },
  close: {
    d: 'M12 2.75a9.25 9.25 0 1 1 0 18.5 9.25 9.25 0 0 1 0-18.5Zm-2.47 5.72a.75.75 0 0 0-1.06 1.06L10.94 12l-2.47 2.47a.75.75 0 1 0 1.06 1.06L12 13.06l2.47 2.47a.75.75 0 1 0 1.06-1.06L13.06 12l2.47-2.47a.75.75 0 0 0-1.06-1.06L12 10.94 9.53 8.47Z',
  },
  users: {
    d: 'M7.75 7a3.25 3.25 0 1 1 6.5 0 3.25 3.25 0 0 1-6.5 0Zm1.5 0a1.75 1.75 0 1 0 3.5 0 1.75 1.75 0 0 0-3.5 0Zm-4 10c0-2.761 3.023-4.75 6.75-4.75s6.75 1.989 6.75 4.75a.75.75 0 0 1-1.5 0c0-1.594-2.166-3.25-5.25-3.25S6.75 15.406 6.75 17a.75.75 0 0 1-1.5 0Z',
  },
  'user-add': {
    d: 'M7.75 6.75a3.25 3.25 0 1 1 6.5 0 3.25 3.25 0 0 1-6.5 0Zm1.5 0a1.75 1.75 0 1 0 3.5 0 1.75 1.75 0 0 0-3.5 0ZM12 12.25c-3.727 0-6.75 1.989-6.75 4.75a.75.75 0 0 0 1.5 0c0-1.594 2.166-3.25 5.25-3.25.761 0 1.487.101 2.15.282a.75.75 0 1 0 .392-1.448 9.939 9.939 0 0 0-2.542-.334Zm5.25.5a.75.75 0 0 1 .75.75v1.75h1.75a.75.75 0 0 1 0 1.5H18v1.75a.75.75 0 0 1-1.5 0v-1.75h-1.75a.75.75 0 0 1 0-1.5h1.75V13.5a.75.75 0 0 1 .75-.75Z',
  },
  'user-remove': {
    d: 'M7.75 6.75a3.25 3.25 0 1 1 6.5 0 3.25 3.25 0 0 1-6.5 0Zm1.5 0a1.75 1.75 0 1 0 3.5 0 1.75 1.75 0 0 0-3.5 0ZM12 12.25c-3.727 0-6.75 1.989-6.75 4.75a.75.75 0 0 0 1.5 0c0-1.594 2.166-3.25 5.25-3.25.761 0 1.487.101 2.15.282a.75.75 0 1 0 .392-1.448 9.939 9.939 0 0 0-2.542-.334Zm2.75 3.75a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75Z',
  },
  clock: {
    d: 'M12 4.25a7.75 7.75 0 1 1 0 15.5 7.75 7.75 0 0 1 0-15.5Zm0 1.5a6.25 6.25 0 1 0 0 12.5 6.25 6.25 0 0 0 0-12.5Zm.75 2.75a.75.75 0 0 0-1.5 0V12c0 .249.124.48.331.62l2.75 1.875a.75.75 0 0 0 .844-1.24L12.75 11.6V8.5Z',
  },
  info: {
    d: 'M12 2.75a9.25 9.25 0 1 1 0 18.5 9.25 9.25 0 0 1 0-18.5Zm0 3.5a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25Zm1 4.75a.75.75 0 0 0-1.5 0v4.5a.75.75 0 0 0 1.5 0V11Z',
  },
}

function createDraft(index: number): ConfigDraft {
  const localKey = `draft-${Date.now()}-${index}`
  return {
    local_key: localKey,
    id: '',
    name: `配置${index}`,
    base_url: DEFAULT_BASE_URL,
    app_id: '',
    app_secret: '',
    last_test_result: null,
    created_at: '',
    updated_at: '',
    is_saved: false,
    saved_snapshot: null,
  }
}

function mapConfigToDraft(config: DingtalkConfig): ConfigDraft {
  return {
    ...config,
    local_key: config.id,
    is_saved: true,
    saved_snapshot: createDraftSnapshot(config),
  }
}

function createDraftSnapshot(draft: Pick<DingtalkConfig, 'name' | 'base_url' | 'app_id' | 'app_secret'>): DraftSnapshot {
  return {
    name: draft.name.trim(),
    base_url: draft.base_url.trim(),
    app_id: draft.app_id.trim(),
    app_secret: draft.app_secret,
  }
}

function hasDraftChanges(draft: ConfigDraft) {
  const currentSnapshot = createDraftSnapshot(draft)

  if (!draft.saved_snapshot) {
    return (
      currentSnapshot.name.length > 0 ||
      currentSnapshot.base_url.length > 0 ||
      currentSnapshot.app_id.length > 0 ||
      currentSnapshot.app_secret.length > 0
    )
  }

  return (
    currentSnapshot.name !== draft.saved_snapshot.name ||
    currentSnapshot.base_url !== draft.saved_snapshot.base_url ||
    currentSnapshot.app_id !== draft.saved_snapshot.app_id ||
    currentSnapshot.app_secret !== draft.saved_snapshot.app_secret
  )
}

function createEmptyHistory(): HistoryListResponse {
  return {
    items: [],
    page: 1,
    page_size: 8,
    total_items: 0,
    total_pages: 0,
    config_id: '',
    start_date: '',
    end_date: '',
  }
}

function renderChangeTypeLabel(changeType: ChangeType) {
  if (changeType === 'added') {
    return '新增'
  }
  if (changeType === 'removed') {
    return '删除'
  }
  return '正常'
}

function buildPaginationActions(page: number, totalPages: number): PaginationAction[] {
  if (totalPages <= 0) {
    return []
  }

  const start = Math.max(1, page - 1)
  const end = Math.min(totalPages, start + 2)
  const begin = Math.max(1, end - 2)
  const actions: PaginationAction[] = []

  for (let current = begin; current <= end; current += 1) {
    actions.push({
      page: current,
      label: String(current),
      is_current: current === page,
    })
  }

  return actions
}

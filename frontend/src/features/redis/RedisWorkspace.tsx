import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import {
  createDataSourceGroup,
  connectRedis,
  deleteDataSourceGroup,
  deleteRedisConnection,
  deleteRedisHashField,
  deleteRedisKey,
  disconnectRedis,
  getAppBootstrap,
  getRedisKeyDetail,
  listRedisConnections,
  renameDataSourceGroup,
  renameRedisKey,
  saveRedisConnection,
  scanRedisKeys,
  setRedisHashField,
  setRedisKeyTtl,
  setRedisStringValue,
  testRedisConnection,
} from '../../api'
import type {
  MutationResult,
  DataSourceGroup,
  RedisConnectionProfile,
  RedisConnectionTestResult,
  RedisKeyDetail,
  RedisKeySummary,
  SaveRedisConnectionPayload,
} from '../../types'

type RedisTreeRow =
  | {
      kind: 'group'
      id: string
      label: string
      depth: number
      count: number
      expanded: boolean
    }
  | {
      kind: 'key'
      id: string
      label: string
      depth: number
      key: RedisKeySummary
    }

const defaultRedisForm: SaveRedisConnectionPayload = {
  id: null,
  group_name: null,
  connection_name: '',
  host: '127.0.0.1',
  port: 6379,
  username: '',
  password: '',
  database_index: 0,
  connect_timeout_ms: 5000,
}

const REDIS_INITIAL_SCAN_LIMIT = 200
const REDIS_INCREMENTAL_SCAN_LIMIT = 500

export function RedisWorkspace() {
  const [dataSourceGroups, setDataSourceGroups] = useState<DataSourceGroup[]>([])
  const [profiles, setProfiles] = useState<RedisConnectionProfile[]>([])
  const [openProfileIds, setOpenProfileIds] = useState<string[]>([])
  const [activeProfileId, setActiveProfileId] = useState('')
  const [profilePickerOpen, setProfilePickerOpen] = useState(false)
  const [profilePickerSearch, setProfilePickerSearch] = useState('')
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)
  const [groupBusy, setGroupBusy] = useState(false)
  const [createGroupName, setCreateGroupName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState('')
  const [editingGroupName, setEditingGroupName] = useState('')
  const [databaseIndexByProfileId, setDatabaseIndexByProfileId] = useState<Record<string, number>>(
    {},
  )
  const [databaseIndex, setDatabaseIndex] = useState(0)
  const [keySearch, setKeySearch] = useState('')
  const [scanCursor, setScanCursor] = useState('0')
  const [keys, setKeys] = useState<RedisKeySummary[]>([])
  const [selectedKeyName, setSelectedKeyName] = useState('')
  const [keyDetail, setKeyDetail] = useState<RedisKeyDetail | null>(null)
  const [connectionLoading, setConnectionLoading] = useState(false)
  const [keyLoading, setKeyLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<SaveRedisConnectionPayload>(defaultRedisForm)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [formBusy, setFormBusy] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [newKeyOpen, setNewKeyOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyValue, setNewKeyValue] = useState('')
  const [newKeyTtl, setNewKeyTtl] = useState('')
  const [newKeyBusy, setNewKeyBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [stringDraft, setStringDraft] = useState('')
  const [hashFieldDraft, setHashFieldDraft] = useState('')
  const [hashValueDraft, setHashValueDraft] = useState('')
  const [ttlDraft, setTtlDraft] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [activeProfileId, profiles],
  )
  const openProfiles = useMemo(
    () =>
      openProfileIds
        .map((profileId) => profiles.find((profile) => profile.id === profileId))
        .filter((profile): profile is RedisConnectionProfile => Boolean(profile)),
    [openProfileIds, profiles],
  )
  const filteredProfiles = useMemo(
    () => filterRedisProfiles(profiles, profilePickerSearch),
    [profilePickerSearch, profiles],
  )
  const groupedFilteredProfiles = useMemo(
    () => groupRedisProfiles(filteredProfiles, dataSourceGroups),
    [dataSourceGroups, filteredProfiles],
  )
  const hasMoreKeys = scanCursor !== '0'
  const visibleKeys = useMemo(() => filterRedisKeys(keys, keySearch), [keySearch, keys])
  const searchActive = keySearch.trim().length > 0
  const keyTreeRows = useMemo(
    () => flattenRedisKeyTree(visibleKeys, expandedGroups, searchActive),
    [expandedGroups, searchActive, visibleKeys],
  )

  useEffect(() => {
    let cancelled = false

    async function loadInitialState() {
      setConnectionLoading(true)
      setErrorMessage('')

      try {
        const [nextProfiles, payload] = await Promise.all([
          listRedisConnections(),
          getAppBootstrap(),
        ])
        if (cancelled) {
          return
        }

        const nextProfileIds = new Set(nextProfiles.map((profile) => profile.id))
        setProfiles(nextProfiles)
        setDataSourceGroups(payload.data_source_groups)
        setOpenProfileIds((previous) =>
          previous.filter((profileId) => nextProfileIds.has(profileId)),
        )
      } catch (error) {
        if (cancelled) {
          return
        }
        setErrorMessage(toErrorText(error, '读取 Redis 工作区初始化数据失败'))
      } finally {
        if (!cancelled) {
          setConnectionLoading(false)
        }
      }
    }

    void loadInitialState()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!keyDetail) {
      setStringDraft('')
      setTtlDraft('')
      setRenameDraft('')
      return
    }

    setStringDraft(keyDetail.string_value ?? '')
    setTtlDraft(keyDetail.ttl_seconds == null ? '-1' : String(keyDetail.ttl_seconds))
    setRenameDraft(keyDetail.key_name)
  }, [keyDetail])

  async function refreshProfiles() {
    setConnectionLoading(true)
    setErrorMessage('')
    try {
      const nextProfiles = await listRedisConnections()
      const nextProfileIds = new Set(nextProfiles.map((profile) => profile.id))
      setProfiles(nextProfiles)
      setOpenProfileIds((previous) => previous.filter((profileId) => nextProfileIds.has(profileId)))
      if (!nextProfileIds.has(activeProfileId)) {
        setActiveProfileId('')
        resetKeyState()
      }
    } catch (error) {
      setErrorMessage(toErrorText(error, '读取 Redis 连接失败'))
    } finally {
      setConnectionLoading(false)
    }
  }

  async function refreshGroups() {
    try {
      const payload = await getAppBootstrap()
      setDataSourceGroups(payload.data_source_groups)
    } catch (error) {
      setErrorMessage(toErrorText(error, '读取分组失败'))
    }
  }

  function closeProfilePicker() {
    setProfilePickerOpen(false)
    setProfilePickerSearch('')
    setGroupManagerOpen(false)
  }

  function toggleProfilePicker() {
    if (profilePickerOpen) {
      closeProfilePicker()
      return
    }

    setProfilePickerSearch('')
    setGroupManagerOpen(false)
    setProfilePickerOpen(true)
  }

  function openCreateForm() {
    closeProfilePicker()
    setForm(defaultRedisForm)
    setFormMode('create')
    setTestResult('')
    setFormOpen(true)
  }

  function openEditForm(profile: RedisConnectionProfile) {
    closeProfilePicker()
    setForm({
      id: profile.id,
      group_name: profile.group_name,
      connection_name: profile.connection_name,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      password: '',
      database_index: profile.database_index,
      connect_timeout_ms: profile.connect_timeout_ms,
    })
    setFormMode('edit')
    setTestResult('')
    setFormOpen(true)
  }

  async function handleSaveConnection() {
    setFormBusy(true)
    setErrorMessage('')
    try {
      const saved = await saveRedisConnection(form)
      await refreshProfiles()
      setFormOpen(false)
      if (openProfileIds.includes(saved.id)) {
        setActiveProfileId(saved.id)
        setDatabaseIndex(saved.database_index)
        setDatabaseIndexByProfileId((previous) => ({
          ...previous,
          [saved.id]: saved.database_index,
        }))
        resetKeyState(saved.database_index)
        await handleScanKeys(true, saved, saved.database_index)
      } else {
        await handleOpenProfileTab(saved)
      }
    } catch (error) {
      setErrorMessage(toErrorText(error, '保存 Redis 连接失败'))
    } finally {
      setFormBusy(false)
    }
  }

  async function handleTestConnection() {
    setFormBusy(true)
    setTestResult('')
    setErrorMessage('')
    try {
      const result = await testRedisConnection(buildTestPayload())
      setTestResult(renderTestResult(result))
    } catch (error) {
      setErrorMessage(toErrorText(error, 'Redis 连接测试失败'))
    } finally {
      setFormBusy(false)
    }
  }

  async function handleOpenProfileTab(profile: RedisConnectionProfile) {
    if (openProfileIds.includes(profile.id)) {
      handleActivateProfileTab(profile)
      closeProfilePicker()
      return
    }

    setConnectionLoading(true)
    setErrorMessage('')
    try {
      const result = await connectRedis(profile.id)
      setOpenProfileIds((previous) =>
        previous.includes(profile.id) ? previous : [...previous, profile.id],
      )
      setDatabaseIndexByProfileId((previous) => ({
        ...previous,
        [profile.id]: result.database_index,
      }))
      setActiveProfileId(profile.id)
      setDatabaseIndex(result.database_index)
      closeProfilePicker()
      await handleScanKeys(true, profile, result.database_index)
    } catch (error) {
      setErrorMessage(toErrorText(error, '连接 Redis 失败'))
    } finally {
      setConnectionLoading(false)
    }
  }

  function handleActivateProfileTab(profile: RedisConnectionProfile) {
    if (profile.id === activeProfileId) {
      return
    }

    const nextDatabaseIndex = databaseIndexByProfileId[profile.id] ?? profile.database_index
    setActiveProfileId(profile.id)
    setDatabaseIndex(nextDatabaseIndex)
    resetKeyState(nextDatabaseIndex)
    void handleScanKeys(true, profile, nextDatabaseIndex)
  }

  async function handleCloseProfileTab(
    profile: RedisConnectionProfile,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    event.stopPropagation()
    const remainingProfileIds = openProfileIds.filter((profileId) => profileId !== profile.id)

    setConnectionLoading(true)
    setErrorMessage('')
    try {
      await disconnectRedis(profile.id)
      setOpenProfileIds(remainingProfileIds)
      if (activeProfileId === profile.id) {
        const closedIndex = openProfileIds.indexOf(profile.id)
        const fallbackProfileId =
          remainingProfileIds[Math.min(closedIndex, remainingProfileIds.length - 1)] ?? ''
        const fallbackProfile =
          profiles.find((item) => item.id === fallbackProfileId) ?? null
        if (fallbackProfile) {
          const nextDatabaseIndex =
            databaseIndexByProfileId[fallbackProfile.id] ?? fallbackProfile.database_index
          setActiveProfileId(fallbackProfile.id)
          setDatabaseIndex(nextDatabaseIndex)
          resetKeyState(nextDatabaseIndex)
          await handleScanKeys(true, fallbackProfile, nextDatabaseIndex)
        } else {
          setActiveProfileId('')
          resetKeyState()
        }
      }
    } catch (error) {
      setErrorMessage(toErrorText(error, '断开 Redis 失败'))
    } finally {
      setConnectionLoading(false)
    }
  }

  async function handleDeleteConnection(profile: RedisConnectionProfile) {
    if (!window.confirm(`删除 Redis 连接「${profile.connection_name}」？`)) {
      return
    }

    setConnectionLoading(true)
    setErrorMessage('')
    try {
      if (openProfileIds.includes(profile.id)) {
        await disconnectRedis(profile.id)
        const remainingProfileIds = openProfileIds.filter((profileId) => profileId !== profile.id)
        setOpenProfileIds(remainingProfileIds)
        if (activeProfileId === profile.id) {
          const fallbackProfileId = remainingProfileIds[0] ?? ''
          const fallbackProfile =
            profiles.find((item) => item.id === fallbackProfileId) ?? null
          if (fallbackProfile) {
            const nextDatabaseIndex =
              databaseIndexByProfileId[fallbackProfile.id] ?? fallbackProfile.database_index
            setActiveProfileId(fallbackProfile.id)
            setDatabaseIndex(nextDatabaseIndex)
            resetKeyState(nextDatabaseIndex)
            await handleScanKeys(true, fallbackProfile, nextDatabaseIndex)
          } else {
            setActiveProfileId('')
            resetKeyState()
          }
        }
      }

      await deleteRedisConnection(profile.id)
      await refreshProfiles()
    } catch (error) {
      setErrorMessage(toErrorText(error, '删除 Redis 连接失败'))
    } finally {
      setConnectionLoading(false)
    }
  }

  async function handleCreateGroup() {
    setGroupBusy(true)
    setErrorMessage('')
    try {
      await createDataSourceGroup({ group_name: createGroupName })
      setCreateGroupName('')
      await refreshGroups()
    } catch (error) {
      setErrorMessage(toErrorText(error, '新增分组失败'))
    } finally {
      setGroupBusy(false)
    }
  }

  async function handleRenameGroup() {
    if (!editingGroupId) {
      return
    }

    setGroupBusy(true)
    setErrorMessage('')
    try {
      await renameDataSourceGroup({
        group_id: editingGroupId,
        group_name: editingGroupName,
      })
      setEditingGroupId('')
      setEditingGroupName('')
      await Promise.all([refreshGroups(), refreshProfiles()])
    } catch (error) {
      setErrorMessage(toErrorText(error, '重命名分组失败'))
    } finally {
      setGroupBusy(false)
    }
  }

  async function handleDeleteGroup(group: DataSourceGroup) {
    if (!window.confirm(`删除分组「${group.group_name}」后，连接会回到未分组。是否继续？`)) {
      return
    }

    setGroupBusy(true)
    setErrorMessage('')
    try {
      await deleteDataSourceGroup(group.id)
      if (editingGroupId === group.id) {
        setEditingGroupId('')
        setEditingGroupName('')
      }
      await Promise.all([refreshGroups(), refreshProfiles()])
    } catch (error) {
      setErrorMessage(toErrorText(error, '删除分组失败'))
    } finally {
      setGroupBusy(false)
    }
  }

  async function handleScanKeys(
    reset: boolean,
    profileOverride?: RedisConnectionProfile,
    databaseIndexOverride?: number,
  ) {
    const profile = profileOverride ?? activeProfile
    const targetDatabaseIndex = databaseIndexOverride ?? databaseIndex
    if (!profile) {
      setErrorMessage('请先选择 Redis 连接')
      return
    }

    const cursor = reset ? '0' : scanCursor
    const limit = reset ? REDIS_INITIAL_SCAN_LIMIT : REDIS_INCREMENTAL_SCAN_LIMIT
    setKeyLoading(true)
    setErrorMessage('')
    try {
      if (reset) {
        setSelectedKeyName('')
        setKeyDetail(null)
        setKeys([])
        setExpandedGroups(new Set())
      }

      // 连接或刷新时只拉首批 key，避免初始化阶段把整个 DB 扫完。
      const response = await scanRedisKeys({
        profile_id: profile.id,
        database_index: targetDatabaseIndex,
        pattern: '*',
        cursor,
        limit,
        type_filter: null,
      })

      const nextKeys = mergeRedisKeys(reset ? [] : keys, response.keys)
      setKeys(nextKeys)
      setScanCursor(response.cursor)
    } catch (error) {
      setErrorMessage(toErrorText(error, '扫描 Redis key 失败'))
    } finally {
      setKeyLoading(false)
    }
  }

  async function loadDetail(keyName: string) {
    if (!activeProfile) {
      return
    }

    setDetailLoading(true)
    setErrorMessage('')
    setSelectedKeyName(keyName)
    try {
      const detail = await getRedisKeyDetail({
        profile_id: activeProfile.id,
        database_index: databaseIndex,
        key_name: keyName,
        offset: 0,
        limit: 200,
      })
      setKeyDetail(detail)
    } catch (error) {
      setErrorMessage(toErrorText(error, '读取 Redis key 详情失败'))
    } finally {
      setDetailLoading(false)
    }
  }

  async function handleSaveString() {
    if (!activeProfile || !keyDetail) {
      return
    }

    await runMutation(
      () =>
        setRedisStringValue({
          profile_id: activeProfile.id,
          database_index: databaseIndex,
          key_name: keyDetail.key_name,
          value: stringDraft,
        }),
      'String 已保存',
    )
  }

  async function handleSaveHashField() {
    if (!activeProfile || !keyDetail || !hashFieldDraft.trim()) {
      setErrorMessage('hash 字段不能为空')
      return
    }

    await runMutation(
      () =>
        setRedisHashField({
          profile_id: activeProfile.id,
          database_index: databaseIndex,
          key_name: keyDetail.key_name,
          field: hashFieldDraft.trim(),
          value: hashValueDraft,
        }),
      'Hash 字段已保存',
    )
    setHashFieldDraft('')
    setHashValueDraft('')
  }

  async function handleDeleteHashField(field: string) {
    if (!activeProfile || !keyDetail) {
      return
    }

    await runMutation(
      () =>
        deleteRedisHashField({
          profile_id: activeProfile.id,
          database_index: databaseIndex,
          key_name: keyDetail.key_name,
          field,
        }),
      `Hash 字段 ${field} 已删除`,
    )
  }

  async function handleDeleteKey() {
    if (!activeProfile || !keyDetail) {
      return
    }
    if (!window.confirm(`删除 Redis key「${keyDetail.key_name}」？`)) {
      return
    }

    await runMutation(
      () =>
        deleteRedisKey({
          profile_id: activeProfile.id,
          database_index: databaseIndex,
          key_name: keyDetail.key_name,
        }),
      'Key 已删除',
      true,
    )
  }

  async function handleRenameKey() {
    if (!activeProfile || !keyDetail || !renameDraft.trim()) {
      setErrorMessage('新 key 名称不能为空')
      return
    }

    await runMutation(
      () =>
        renameRedisKey({
          profile_id: activeProfile.id,
          database_index: databaseIndex,
          key_name: keyDetail.key_name,
          new_key_name: renameDraft.trim(),
        }),
      'Key 已重命名',
      true,
    )
  }

  async function handleSaveTtl() {
    if (!activeProfile || !keyDetail) {
      return
    }

    const ttlInput = ttlDraft.trim()
    const ttlValue = !ttlInput || ttlInput === '-1' ? null : Number(ttlInput)
    if (ttlValue != null && (!Number.isFinite(ttlValue) || ttlValue <= 0)) {
      setErrorMessage('TTL 必须是大于 0 的秒数，-1 表示永久')
      return
    }

    await runMutation(
      () =>
        setRedisKeyTtl({
          profile_id: activeProfile.id,
          database_index: databaseIndex,
          key_name: keyDetail.key_name,
          ttl_seconds: ttlValue,
        }),
      ttlValue == null ? 'Key 已设为永久' : 'Key TTL 已更新',
    )
  }

  function openCreateKeyForm() {
    setNewKeyName('')
    setNewKeyValue('')
    setNewKeyTtl('-1')
    setNewKeyOpen(true)
  }

  async function handleCreateStringKey() {
    if (!activeProfile) {
      setErrorMessage('请先选择 Redis 连接')
      return
    }

    const keyName = newKeyName.trim()
    if (!keyName) {
      setErrorMessage('Redis key 不能为空')
      return
    }

    const ttlInput = newKeyTtl.trim()
    const ttlValue = !ttlInput || ttlInput === '-1' ? null : Number(ttlInput)
    if (ttlValue != null && (!Number.isFinite(ttlValue) || ttlValue <= 0)) {
      setErrorMessage('TTL 必须是大于 0 的秒数，-1 表示永久')
      return
    }

    if (
      keys.some((key) => key.key_name === keyName) &&
      !window.confirm(`Redis key「${keyName}」已存在，是否覆盖为 String？`)
    ) {
      return
    }

    setNewKeyBusy(true)
    setErrorMessage('')
    try {
      await setRedisStringValue({
        profile_id: activeProfile.id,
        database_index: databaseIndex,
        key_name: keyName,
        value: newKeyValue,
      })
      if (ttlValue != null) {
        await setRedisKeyTtl({
          profile_id: activeProfile.id,
          database_index: databaseIndex,
          key_name: keyName,
          ttl_seconds: ttlValue,
        })
      }
      setNewKeyOpen(false)
      setKeySearch('')
      await handleScanKeys(true)
      await loadDetail(keyName)
    } catch (error) {
      setErrorMessage(toErrorText(error, '新增 Redis key 失败'))
    } finally {
      setNewKeyBusy(false)
    }
  }

  async function runMutation(
    action: () => Promise<MutationResult>,
    message: string,
    resetSelection = false,
  ) {
    if (!keyDetail) {
      return
    }

    setDetailLoading(true)
    setErrorMessage('')
    try {
      await action()
      if (resetSelection) {
        setSelectedKeyName('')
        setKeyDetail(null)
        await handleScanKeys(true)
      } else {
        await loadDetail(keyDetail.key_name)
      }
    } catch (error) {
      setErrorMessage(toErrorText(error, message))
    } finally {
      setDetailLoading(false)
    }
  }

  function resetKeyState(nextDatabaseIndex = 0) {
    setDatabaseIndex(nextDatabaseIndex)
    setKeySearch('')
    setScanCursor('0')
    setKeys([])
    setSelectedKeyName('')
    setKeyDetail(null)
    setExpandedGroups(new Set())
  }

  function buildTestPayload() {
    if (formMode !== 'edit' || form.password || !form.id) {
      return form
    }

    const existingPassword =
      profiles.find((profile) => profile.id === form.id)?.password ?? ''
    return { ...form, password: existingPassword }
  }

  function toggleGroup(groupId: string) {
    setExpandedGroups((previous) => {
      const next = new Set(previous)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  return (
    <section className="redis-workspace">
      <header className="redis-tabs-bar">
        <div className="redis-tab-list">
          {openProfiles.length === 0 ? (
            <div className="redis-tab-placeholder">请选择 Redis 连接</div>
          ) : null}
          {openProfiles.map((profile) => (
            <div
              className={`redis-tab ${
                profile.id === activeProfileId ? 'active' : ''
              }`}
              key={profile.id}
            >
              <button
                className="redis-tab-main"
                type="button"
                onClick={() => handleActivateProfileTab(profile)}
              >
                <span>{profile.connection_name}</span>
              </button>
              <button
                aria-label={`关闭 ${profile.connection_name}`}
                className="redis-tab-close"
                disabled={connectionLoading}
                type="button"
                onClick={(event) => void handleCloseProfileTab(profile, event)}
              >
                ×
              </button>
            </div>
          ))}

          <div className="redis-tab-picker">
            <button
              aria-label="管理连接"
              className="redis-tab-add"
              disabled={connectionLoading}
              title="管理连接"
              type="button"
              onClick={toggleProfilePicker}
            >
              +
            </button>
          </div>
        </div>
      </header>

      {errorMessage ? <div className="redis-error-banner">{errorMessage}</div> : null}

      <div className="redis-main-grid">
        <section className="redis-key-browser">
          <div className="redis-browser-toolbar">
            <input
              aria-label="搜索 key"
              value={keySearch}
              placeholder="搜索 key"
              onChange={(event) => setKeySearch(event.target.value)}
            />
            <button
              className="flat-button"
              disabled={!activeProfile || keyLoading}
              type="button"
              onClick={() => void handleScanKeys(true)}
            >
              {keyLoading ? '刷新中...' : '刷新'}
            </button>
            <button
              className="flat-button primary"
              disabled={!activeProfile || keyLoading}
              type="button"
              onClick={() => openCreateKeyForm()}
            >
              新增 key
            </button>
          </div>

          <div className="redis-key-tree">
            {keys.length === 0 || visibleKeys.length === 0 ? (
              <div className="redis-empty">
                {!activeProfile
                  ? '请选择 Redis 连接。'
                  : keys.length === 0
                    ? '连接后默认只加载首批 key，可继续加载更多。'
                    : '没有匹配的 key。'}
              </div>
            ) : (
              keyTreeRows.map((item) =>
                item.kind === 'group' ? (
                  <button
                    className="redis-tree-row group"
                    key={item.id}
                    type="button"
                    onClick={() => toggleGroup(item.id)}
                  >
                    <span
                      className="redis-tree-indent"
                      style={{ width: item.depth * 20 } as CSSProperties}
                    />
                    <span className="redis-tree-caret">{item.expanded ? '▾' : '▸'}</span>
                    <span className="redis-folder-icon">▣</span>
                    <span className="redis-tree-label">{item.label}</span>
                    <small>{item.count}</small>
                  </button>
                ) : (
                  <button
                    className={`redis-tree-row key ${
                      selectedKeyName === item.key.key_name ? 'active' : ''
                    }`}
                    key={item.id}
                    title={item.key.key_name}
                    type="button"
                    onClick={() => void loadDetail(item.key.key_name)}
                  >
                    <span
                      className="redis-tree-indent"
                      style={{ width: item.depth * 20 } as CSSProperties}
                    />
                    <span className="redis-tree-caret muted" />
                    <span className={`redis-type-badge ${item.key.type_name}`}>
                      {shortTypeName(item.key.type_name)}
                    </span>
                    <span className="redis-tree-label">{item.label}</span>
                    <small>{renderTtl(item.key.ttl_seconds)}</small>
                  </button>
                ),
              )
            )}
          </div>

          <div className="redis-key-footer">
            <label className="redis-db-switch">
              <span>DB</span>
              <select
                value={databaseIndex}
                onChange={(event) => {
                  const nextDatabaseIndex = Number(event.target.value)
                  setDatabaseIndex(nextDatabaseIndex)
                  if (activeProfile) {
                    setDatabaseIndexByProfileId((previous) => ({
                      ...previous,
                      [activeProfile.id]: nextDatabaseIndex,
                    }))
                  }
                  setKeys([])
                  setScanCursor('0')
                  setKeyDetail(null)
                  setSelectedKeyName('')
                  setExpandedGroups(new Set())
                  if (activeProfile) {
                    void handleScanKeys(true, activeProfile, nextDatabaseIndex)
                  }
                }}
              >
                {Array.from({ length: 16 }, (_, index) => (
                  <option key={index} value={index}>
                    db{index}
                  </option>
                ))}
              </select>
              <small>{visibleKeys.length}/{keys.length}</small>
            </label>
            <button
              className="flat-button redis-load-more"
              disabled={!activeProfile || keyLoading || !hasMoreKeys}
              type="button"
              onClick={() => void handleScanKeys(false)}
            >
              {hasMoreKeys ? '加载更多' : '没有更多'}
            </button>
          </div>
        </section>

        <section className="redis-detail-pane">
          {!keyDetail ? (
            <div className="redis-empty redis-detail-empty">
              {detailLoading ? '正在读取 key 详情。' : '选择一个 key 查看详情。'}
            </div>
          ) : (
            <>
              <div className="redis-detail-header">
                <div>
                  <strong>{keyDetail.key_name}</strong>
                  <p>
                    DB{keyDetail.database_index} · {keyDetail.length} 项 · TTL{' '}
                    {renderTtl(keyDetail.ttl_seconds)}
                  </p>
                </div>
              </div>

              <div className="redis-key-tools">
                <span className={`redis-type-pill ${keyDetail.type_name}`}>
                  {keyDetail.type_name.toUpperCase()}
                </span>
                <label>
                  <span>Key</span>
                  <input
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                  />
                </label>
                <button
                  className="flat-button"
                  disabled={detailLoading}
                  type="button"
                  onClick={() => void handleRenameKey()}
                >
                  应用
                </button>
                <label>
                  <span>TTL</span>
                  <input
                    value={ttlDraft}
                    placeholder="-1 表示永久"
                    onChange={(event) => setTtlDraft(event.target.value)}
                  />
                </label>
                <button
                  className="flat-button"
                  disabled={detailLoading}
                  type="button"
                  onClick={() => void handleSaveTtl()}
                >
                  保存 TTL
                </button>
              </div>

              {renderDetailBody()}
            </>
          )}
        </section>
      </div>

      {profilePickerOpen ? (
        <div className="redis-modal-backdrop">
          <div className="redis-modal-card redis-manager-card">
            <div className="redis-panel-head">
              <div>
                <strong>管理连接</strong>
                <p>连接为主，分组只负责归类。</p>
              </div>
              <button className="flat-button" type="button" onClick={closeProfilePicker}>
                关闭
              </button>
            </div>

            <div className="redis-manager-toolbar">
              <input
                autoFocus
                value={profilePickerSearch}
                placeholder="搜索连接或分组"
                onChange={(event) => setProfilePickerSearch(event.target.value)}
              />
              <button
                className={`text-button redis-group-toggle ${groupManagerOpen ? 'active' : ''}`}
                type="button"
                onClick={() => setGroupManagerOpen((previous) => !previous)}
              >
                {groupManagerOpen
                  ? '收起分组'
                  : `分组维护${dataSourceGroups.length ? ` (${dataSourceGroups.length})` : ''}`}
              </button>
              <button className="flat-button primary" type="button" onClick={openCreateForm}>
                新增连接
              </button>
            </div>

            <div className="redis-manager-stack">
              {groupManagerOpen ? (
                <section className="redis-group-manager redis-group-manager-inline">
                  <div className="redis-group-manager-header">
                    <strong>分组维护</strong>
                    <p>删除分组后，已有 Redis 连接会自动回到未分组。</p>
                  </div>
                  <div className="redis-group-manager-create">
                    <input
                      value={createGroupName}
                      placeholder="输入新的分组名称"
                      onChange={(event) => setCreateGroupName(event.target.value)}
                    />
                    <button
                      className="flat-button primary"
                      disabled={groupBusy}
                      type="button"
                      onClick={() => void handleCreateGroup()}
                    >
                      {groupBusy ? '处理中...' : '新增分组'}
                    </button>
                  </div>

                  <div className="redis-group-manager-list">
                    {dataSourceGroups.length === 0 ? (
                      <div className="redis-group-manager-empty">暂无分组。</div>
                    ) : (
                      dataSourceGroups.map((group) => {
                        const editing = editingGroupId === group.id
                        return (
                          <div className="redis-group-manager-row" key={group.id}>
                            {editing ? (
                              <>
                                <input
                                  value={editingGroupName}
                                  placeholder="请输入分组名称"
                                  onChange={(event) => setEditingGroupName(event.target.value)}
                                />
                                <button
                                  className="flat-button primary"
                                  disabled={groupBusy}
                                  type="button"
                                  onClick={() => void handleRenameGroup()}
                                >
                                  保存
                                </button>
                                <button
                                  className="flat-button"
                                  disabled={groupBusy}
                                  type="button"
                                  onClick={() => {
                                    setEditingGroupId('')
                                    setEditingGroupName('')
                                  }}
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="redis-group-manager-name">{group.group_name}</div>
                                <div className="redis-group-manager-actions">
                                  <button
                                    className="flat-button"
                                    disabled={groupBusy}
                                    type="button"
                                    onClick={() => {
                                      setEditingGroupId(group.id)
                                      setEditingGroupName(group.group_name)
                                    }}
                                  >
                                    重命名
                                  </button>
                                  <button
                                    className="flat-button danger"
                                    disabled={groupBusy}
                                    type="button"
                                    onClick={() => void handleDeleteGroup(group)}
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
                </section>
              ) : null}

              <section className="redis-connection-manager redis-connection-manager-full">
                <div className="redis-group-manager-header">
                  <strong>连接列表</strong>
                  <p>点击打开即可在顶部标签页中连接。</p>
                </div>
                <div className="redis-connection-manager-list">
                  {filteredProfiles.length === 0 ? (
                    <div className="redis-group-manager-empty">没有匹配的连接。</div>
                  ) : (
                    groupedFilteredProfiles.map((group) => (
                      <div className="redis-connection-group" key={group.group_name ?? '__ungrouped__'}>
                        <div className="redis-connection-group-title">
                          <strong>{group.group_name ?? '未分组'}</strong>
                          <small>{group.profiles.length} 个连接</small>
                        </div>
                        <div className="redis-connection-group-list">
                          {group.profiles.map((profile) => (
                            <div className="redis-manager-connection-item" key={profile.id}>
                              <div>
                                <strong>{profile.connection_name}</strong>
                                <p>
                                  {profile.host}:{profile.port} / db{profile.database_index}
                                  {openProfileIds.includes(profile.id) ? ' / 已打开' : ''}
                                </p>
                              </div>
                              <div className="redis-manager-connection-actions">
                                <button
                                  className="flat-button"
                                  disabled={connectionLoading}
                                  type="button"
                                  onClick={() => void handleOpenProfileTab(profile)}
                                >
                                  打开
                                </button>
                                <button
                                  className="flat-button"
                                  type="button"
                                  onClick={() => openEditForm(profile)}
                                >
                                  编辑
                                </button>
                                <button
                                  className="flat-button danger"
                                  disabled={connectionLoading}
                                  type="button"
                                  onClick={() => void handleDeleteConnection(profile)}
                                >
                                  删除
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {formOpen ? (
        <div className="redis-modal-backdrop">
          <div className="redis-modal-card">
            <div className="redis-panel-head">
              <div>
                <strong>{formMode === 'create' ? '新建 Redis 连接' : '编辑 Redis 连接'}</strong>
                <p>{formMode === 'edit' ? '密码留空表示沿用已保存密码。' : '密码可留空。'}</p>
              </div>
              <button className="flat-button" type="button" onClick={() => setFormOpen(false)}>
                关闭
              </button>
            </div>

            <div className="redis-form-grid">
              <label>
                <span>所属分组</span>
                <select
                  value={form.group_name ?? ''}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      group_name: event.target.value || null,
                    }))
                  }
                >
                  <option value="">未分组</option>
                  {dataSourceGroups.map((group) => (
                    <option key={group.id} value={group.group_name}>
                      {group.group_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>连接名称</span>
                <input
                  value={form.connection_name}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      connection_name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>Host</span>
                <input
                  value={form.host}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, host: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>Port</span>
                <input
                  type="number"
                  value={form.port}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, port: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                <span>DB</span>
                <input
                  type="number"
                  value={form.database_index}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      database_index: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                <span>Username</span>
                <input
                  value={form.username}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, username: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, password: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>连接超时 ms</span>
                <input
                  type="number"
                  value={form.connect_timeout_ms}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      connect_timeout_ms: Number(event.target.value),
                    }))
                  }
                />
              </label>
            </div>

            {testResult ? <div className="redis-test-result">{testResult}</div> : null}

            <div className="redis-modal-actions">
              <button
                className="flat-button"
                disabled={formBusy}
                type="button"
                onClick={() => void handleTestConnection()}
              >
                测试连接
              </button>
              <button
                className="flat-button primary"
                disabled={formBusy}
                type="button"
                onClick={() => void handleSaveConnection()}
              >
                {formBusy ? '处理中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {newKeyOpen ? (
        <div className="redis-modal-backdrop">
          <div className="redis-modal-card">
            <div className="redis-panel-head">
              <div>
                <strong>新增 String Key</strong>
                <p>保存到 DB{databaseIndex}，TTL -1 表示永久。</p>
              </div>
              <button className="flat-button" type="button" onClick={() => setNewKeyOpen(false)}>
                关闭
              </button>
            </div>

            <div className="redis-form-grid">
              <label>
                <span>Key</span>
                <input
                  value={newKeyName}
                  placeholder="例如 user:profile:1"
                  onChange={(event) => setNewKeyName(event.target.value)}
                />
              </label>
              <label>
                <span>TTL 秒</span>
                <input
                  value={newKeyTtl}
                  placeholder="-1 表示永久"
                  onChange={(event) => setNewKeyTtl(event.target.value)}
                />
              </label>
            </div>

            <div className="redis-value-editor redis-new-key-editor">
              <div className="redis-value-toolbar">
                <strong>Value</strong>
                <button
                  className="flat-button"
                  type="button"
                  onClick={() => setNewKeyValue(formatMaybeJson(newKeyValue))}
                >
                  格式化 JSON
                </button>
              </div>
              <textarea
                value={newKeyValue}
                placeholder="String value"
                onChange={(event) => setNewKeyValue(event.target.value)}
              />
            </div>

            <div className="redis-modal-actions">
              <button
                className="flat-button primary"
                disabled={newKeyBusy}
                type="button"
                onClick={() => void handleCreateStringKey()}
              >
                {newKeyBusy ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )

  function renderDetailBody() {
    if (!keyDetail) {
      return null
    }

    if (keyDetail.type_name === 'string') {
      return (
        <div className="redis-value-editor">
          <div className="redis-value-toolbar">
            <strong>String</strong>
            <div className="redis-value-actions">
              <button
                className="flat-button"
                type="button"
                onClick={() => setStringDraft(formatMaybeJson(stringDraft))}
              >
                格式化 JSON
              </button>
              <button
                className="flat-button"
                disabled={detailLoading}
                type="button"
                onClick={() => void loadDetail(keyDetail.key_name)}
              >
                刷新
              </button>
              <button
                className="flat-button danger"
                disabled={detailLoading}
                type="button"
                onClick={() => void handleDeleteKey()}
              >
                删除
              </button>
              <button
                className="flat-button primary"
                disabled={detailLoading}
                type="button"
                onClick={() => void handleSaveString()}
              >
                保存
              </button>
            </div>
          </div>
          <textarea
            value={stringDraft}
            onChange={(event) => setStringDraft(event.target.value)}
          />
        </div>
      )
    }

    if (keyDetail.type_name === 'hash') {
      return (
        <div className="redis-hash-panel">
          <div className="redis-hash-editor">
            <input
              value={hashFieldDraft}
              placeholder="字段"
              onChange={(event) => setHashFieldDraft(event.target.value)}
            />
            <input
              value={hashValueDraft}
              placeholder="值"
              onChange={(event) => setHashValueDraft(event.target.value)}
            />
            <button
              className="flat-button primary"
              disabled={detailLoading}
              type="button"
              onClick={() => void handleSaveHashField()}
            >
              保存字段
            </button>
          </div>
          <div className="redis-table redis-hash-table">
            <div className="redis-table-header">
              <span>#</span>
              <span>字段</span>
              <span>值</span>
              <span>操作</span>
            </div>
            {keyDetail.hash_entries.map((entry) => (
              <div className="redis-table-row hash" key={entry.field}>
                <code>{keyDetail.hash_entries.indexOf(entry) + 1}</code>
                <code>{entry.field}</code>
                <span>{entry.value}</span>
                <button
                  className="flat-button danger"
                  disabled={detailLoading}
                  type="button"
                  onClick={() => void handleDeleteHashField(entry.field)}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (keyDetail.type_name === 'list') {
      return (
        <div className="redis-table">
          <div className="redis-table-header two-col">
            <span>#</span>
            <span>值</span>
          </div>
          {keyDetail.list_items.map((item) => (
            <div className="redis-table-row two-col" key={item.index}>
              <code>#{item.index}</code>
              <span>{item.value}</span>
            </div>
          ))}
        </div>
      )
    }

    if (keyDetail.type_name === 'set') {
      return (
        <div className="redis-table">
          <div className="redis-table-header two-col">
            <span>#</span>
            <span>成员</span>
          </div>
          {keyDetail.set_members.map((member) => (
            <div className="redis-table-row two-col" key={member}>
              <code>#{keyDetail.set_members.indexOf(member) + 1}</code>
              <span>{member}</span>
            </div>
          ))}
        </div>
      )
    }

    if (keyDetail.type_name === 'zset') {
      return (
        <div className="redis-table">
          <div className="redis-table-header">
            <span>#</span>
            <span>成员</span>
            <span>Score</span>
          </div>
          {keyDetail.zset_entries.map((entry) => (
            <div className="redis-table-row" key={entry.member}>
              <code>#{keyDetail.zset_entries.indexOf(entry) + 1}</code>
              <span>{entry.member}</span>
              <code>{entry.score}</code>
            </div>
          ))}
        </div>
      )
    }

    if (keyDetail.type_name === 'stream') {
      return (
        <div className="redis-table">
          <div className="redis-table-header two-col">
            <span>ID</span>
            <span>字段</span>
          </div>
          {keyDetail.stream_entries.map((entry) => (
            <div className="redis-stream-entry" key={entry.entry_id}>
              <code>{entry.entry_id}</code>
              <div>
                {entry.fields.map((field) => (
                  <span key={`${entry.entry_id}:${field.field}`}>
                    {field.field}: {field.value}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )
    }

    return <div className="redis-empty">暂不支持预览 {keyDetail.type_name} 类型。</div>
  }
}

function renderTtl(value: number | null) {
  return value == null ? '-1' : `${value}s`
}

function renderTestResult(result: RedisConnectionTestResult) {
  return `Redis ${result.server_version} / DB${result.database_index} / ${result.key_count} keys`
}

function mergeRedisKeys(
  existingKeys: RedisKeySummary[],
  incomingKeys: RedisKeySummary[],
) {
  const keyByName = new Map(existingKeys.map((item) => [item.key_name, item]))
  for (const key of incomingKeys) {
    keyByName.set(key.key_name, key)
  }
  return Array.from(keyByName.values()).sort((left, right) =>
    left.key_name.localeCompare(right.key_name),
  )
}

function filterRedisKeys(keys: RedisKeySummary[], keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase()
  if (!normalizedKeyword) {
    return keys
  }
  return keys.filter((key) => key.key_name.toLowerCase().includes(normalizedKeyword))
}

function filterRedisProfiles(profiles: RedisConnectionProfile[], keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase()
  if (!normalizedKeyword) {
    return profiles
  }
  return profiles.filter((profile) =>
    [
      profile.group_name ?? '',
      profile.connection_name,
      profile.host,
      String(profile.port),
      `db${profile.database_index}`,
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalizedKeyword),
  )
}

function groupRedisProfiles(
  profiles: RedisConnectionProfile[],
  groups: DataSourceGroup[],
) {
  const grouped = new Map<string | null, RedisConnectionProfile[]>()
  for (const profile of profiles) {
    const groupName = profile.group_name ?? null
    grouped.set(groupName, [...(grouped.get(groupName) ?? []), profile])
  }

  return [
    ...groups.map((group) => ({
      group_name: group.group_name,
      profiles: (grouped.get(group.group_name) ?? []).sort(compareRedisProfile),
    })),
    {
      group_name: null,
      profiles: (grouped.get(null) ?? []).sort(compareRedisProfile),
    },
  ].filter((group) => group.profiles.length > 0)
}

function compareRedisProfile(left: RedisConnectionProfile, right: RedisConnectionProfile) {
  return left.connection_name.localeCompare(right.connection_name, 'zh-CN')
}

function flattenRedisKeyTree(
  keys: RedisKeySummary[],
  expandedGroups: Set<string>,
  forceExpanded = false,
): RedisTreeRow[] {
  const root = createRedisTreeNode('__root__', '', 0)

  for (const key of keys) {
    const segments = splitRedisKey(key.key_name)
    let current = root
    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1
      const childId = current.id === '__root__' ? segment : `${current.id}/${segment}`
      const existing = current.children.get(childId)
      const childDepth = current.id === '__root__' ? 0 : current.depth + 1
      const child = existing ?? createRedisTreeNode(childId, segment, childDepth)
      if (!existing) {
        current.children.set(childId, child)
      }
      child.count += 1
      if (isLeaf) {
        child.key = key
      }
      current = child
    })
  }

  const rows: RedisTreeRow[] = []
  for (const child of Array.from(root.children.values()).sort(compareRedisTreeNode)) {
    appendRedisTreeRow(rows, child, expandedGroups, forceExpanded)
  }
  return rows
}

function appendRedisTreeRow(
  rows: RedisTreeRow[],
  node: RedisTreeNode,
  expandedGroups: Set<string>,
  forceExpanded: boolean,
) {
  const childNodes = Array.from(node.children.values()).sort(compareRedisTreeNode)
  const hasChildren = childNodes.length > 0
  const isGroup = hasChildren || !node.key

  if (isGroup) {
    const expanded = forceExpanded || expandedGroups.has(node.id)
    rows.push({
      kind: 'group',
      id: node.id,
      label: node.label,
      depth: node.depth,
      count: node.count,
      expanded,
    })
    if (!expanded) {
      return
    }
    if (node.key) {
      rows.push({
        kind: 'key',
        id: `key:${node.key.key_name}`,
        label: node.label,
        depth: node.depth + 1,
        key: node.key,
      })
    }
    childNodes.forEach((child) =>
      appendRedisTreeRow(rows, child, expandedGroups, forceExpanded),
    )
    return
  }

  const key = node.key
  if (!key) {
    return
  }

  rows.push({
    kind: 'key',
    id: key.key_name,
    label: node.label,
    depth: node.depth,
    key,
  })
}

type RedisTreeNode = {
  id: string
  label: string
  depth: number
  count: number
  children: Map<string, RedisTreeNode>
  key?: RedisKeySummary
}

function createRedisTreeNode(id: string, label: string, depth: number): RedisTreeNode {
  return {
    id,
    label,
    depth,
    count: 0,
    children: new Map(),
  }
}

function splitRedisKey(keyName: string) {
  const segments = keyName.split(':').filter(Boolean)
  return segments.length > 0 ? segments : [keyName]
}

function compareRedisTreeNode(left: RedisTreeNode, right: RedisTreeNode) {
  const leftIsGroup = left.children.size > 0 || !left.key
  const rightIsGroup = right.children.size > 0 || !right.key
  if (leftIsGroup !== rightIsGroup) {
    return leftIsGroup ? -1 : 1
  }
  return left.label.localeCompare(right.label)
}

function shortTypeName(value: string) {
  if (value === 'string') {
    return 'S'
  }
  if (value === 'hash') {
    return 'H'
  }
  if (value === 'list') {
    return 'L'
  }
  if (value === 'set') {
    return 'Set'
  }
  if (value === 'zset') {
    return 'Z'
  }
  if (value === 'stream') {
    return 'Str'
  }
  return value.slice(0, 3)
}

function formatMaybeJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function toErrorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

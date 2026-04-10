import { useEffect, useRef, useState } from 'react'
import type { CompareHistoryItem, ConnectionProfile, DatabaseEntry } from '../../types'
import type { CompareFormState } from './types'

type CompareSelectionOption = {
  value: string
  title: string
  subtitle?: string
  usage_count: number
  search_texts: string[]
}

type CompareConnectionFormProps = {
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
}

const ungroupedGroupName = '未分组'

function normalizeGroupName(groupName: string | null | undefined) {
  return groupName?.trim() || ungroupedGroupName
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

export function CompareConnectionForm({
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
}: CompareConnectionFormProps) {
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

  const sourceLoading =
    Boolean(compareForm.source_profile_id) && Boolean(nodeLoading[compareForm.source_profile_id])
  const targetLoading =
    Boolean(compareForm.target_profile_id) && Boolean(nodeLoading[compareForm.target_profile_id])
  const sourceConnected = profileConnectionState[compareForm.source_profile_id] === 'connected'
  const targetConnected = profileConnectionState[compareForm.target_profile_id] === 'connected'

  return (
    <div className="form-card compact-form-card compare-form-card">
      <div className="compare-connection-grid">
        <div className="compare-connection-panel">
          <div className="compare-connection-panel-head">
            <strong>源端</strong>
            <span
              className={`status-tag ${sourceConnected ? 'success' : sourceLoading ? 'warning' : 'muted'}`}
            >
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
            <span
              className={`status-tag ${targetConnected ? 'success' : targetLoading ? 'warning' : 'muted'}`}
            >
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

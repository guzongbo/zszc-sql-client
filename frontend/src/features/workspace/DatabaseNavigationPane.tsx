import type { MouseEvent } from 'react'
import type {
  CompareHistoryType,
  ConnectionProfile,
  DataSourceGroup,
  DatabaseEntry,
  TableEntry,
} from '../../types'
import type { SelectionState, RailSection } from './appTypes'
import type { NavigationTreeGroup } from './navigation'
import { EmptyNotice } from '../../shared/components/EmptyNotice'
import {
  CompareSidebar,
  DatabaseGlyph,
  DatabaseSettingsGlyph,
  SquareActionButton,
  SquareIconButton,
  TreeDatabaseGlyph,
  TreeTableGlyph,
  WorkspacePanelPlaceholder,
} from '../../shared/components/AppChrome'

type DatabaseNavigationPaneProps = {
  activeSection: RailSection
  bootstrapError: string
  compareHistoryType: CompareHistoryType
  dataSourceGroups: DataSourceGroup[]
  databasesByProfile: Record<string, DatabaseEntry[]>
  navigationSearchText: string
  navigationTreeGroups: NavigationTreeGroup[]
  nodeLoading: Record<string, boolean>
  profileConnectionState: Record<string, string>
  profiles: ConnectionProfile[]
  selectedGroupKey: string
  selectedProfile: ConnectionProfile | null
  selection: SelectionState
  tablesByDatabase: Record<string, TableEntry[]>
  visibleExpandedKeys: Set<string>
  visibleHistoryCount: number
  onCompareHistoryTypeChange: (historyType: CompareHistoryType) => void
  onDisconnectSelectedProfile: () => void
  onNavigationSearchTextChange: (value: string) => void
  onOpenConsole: () => void
  onOpenProfileEditor: () => void
  onOpenSelectedProfileEditor: () => void
  onRefresh: () => void
  onSelectDatabase: (profileId: string, databaseName: string) => void
  onSelectGroup: (groupKey: string) => void
  onSelectProfile: (profileId: string) => void
  onSelectTable: (profileId: string, databaseName: string, tableName: string) => void
  onToggleDatabaseNode: (profileId: string, databaseName: string) => void
  onToggleGroupNode: (groupKey: string) => void
  onToggleProfileNode: (profileId: string) => void
  onTreeGroupContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    groupId: string,
    groupName: string,
  ) => void
  onTreeDatabaseContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    profileId: string,
    databaseName: string,
  ) => void
  onTreeProfileContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    profileId: string,
  ) => void
  onTreeTableContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    profileId: string,
    databaseName: string,
    tableName: string,
  ) => void
  onOpenTableData: (profileId: string, databaseName: string, tableName: string) => void
}

export function DatabaseNavigationPane({
  activeSection,
  bootstrapError,
  compareHistoryType,
  dataSourceGroups,
  databasesByProfile,
  navigationSearchText,
  navigationTreeGroups,
  nodeLoading,
  onCompareHistoryTypeChange,
  onDisconnectSelectedProfile,
  onNavigationSearchTextChange,
  onOpenConsole,
  onOpenProfileEditor,
  onOpenSelectedProfileEditor,
  onRefresh,
  onSelectDatabase,
  onSelectGroup,
  onSelectProfile,
  onSelectTable,
  onToggleDatabaseNode,
  onToggleGroupNode,
  onToggleProfileNode,
  onTreeDatabaseContextMenu,
  onTreeGroupContextMenu,
  onTreeProfileContextMenu,
  onTreeTableContextMenu,
  onOpenTableData,
  profileConnectionState,
  profiles,
  selectedGroupKey,
  selectedProfile,
  selection,
  tablesByDatabase,
  visibleExpandedKeys,
  visibleHistoryCount,
}: DatabaseNavigationPaneProps) {
  const hasSearchKeyword = navigationSearchText.trim().length > 0

  if (activeSection === 'data_compare') {
    return (
      <div className="navigation-pane">
        <WorkspacePanelPlaceholder
          title="左侧面板"
          description="这里预留为数据对比的筛选、目录或资源树区域，当前先完成可展示与隐藏的骨架。"
          tone="accent"
        />
      </div>
    )
  }

  if (activeSection === 'structure_compare') {
    return (
      <div className="navigation-pane">
        <WorkspacePanelPlaceholder
          title="左侧面板"
          description="这里预留为结构对比的筛选、分类或导航区域，当前先完成可展示与隐藏的骨架。"
          tone="accent"
        />
      </div>
    )
  }

  if (activeSection === 'compare_history') {
    return (
      <div className="navigation-pane">
        <CompareSidebar
          title="对比记录"
          subtitle="本地保存的结构对比和数据对比记录，可用于回看统计与涉及表。"
        >
          <div className="compare-history-tabs">
            <button
              className={`flat-button ${compareHistoryType === 'data' ? 'primary' : ''}`}
              type="button"
              onClick={() => onCompareHistoryTypeChange('data')}
            >
              数据对比
            </button>
            <button
              className={`flat-button ${compareHistoryType === 'structure' ? 'primary' : ''}`}
              type="button"
              onClick={() => onCompareHistoryTypeChange('structure')}
            >
              结构对比
            </button>
          </div>
          <div className="compare-summary-list">
            <span>记录数 {visibleHistoryCount}</span>
            <span>当前筛选 {compareHistoryType === 'data' ? '数据对比' : '结构对比'}</span>
          </div>
        </CompareSidebar>
      </div>
    )
  }

  return (
    <div className="navigation-pane">
      <div className="pane-header">
        <div className="pane-title">
          <DatabaseGlyph />
          <strong>数据库导航</strong>
        </div>

        <div className="navigation-search-card">
          <input
            value={navigationSearchText}
            onChange={(event) => onNavigationSearchTextChange(event.target.value)}
            placeholder="搜索连接名、数据库、表"
          />
        </div>

        <div className="pane-actions">
          <SquareIconButton label="新增数据源" onClick={onOpenProfileEditor}>
            +
          </SquareIconButton>
          <SquareIconButton
            label="数据源属性"
            disabled={!selectedProfile}
            onClick={onOpenSelectedProfileEditor}
          >
            <DatabaseSettingsGlyph />
          </SquareIconButton>
          <SquareIconButton label="刷新" onClick={onRefresh}>
            ↻
          </SquareIconButton>
          <SquareIconButton
            label="停止连接"
            disabled={!selectedProfile}
            onClick={onDisconnectSelectedProfile}
          >
            ■
          </SquareIconButton>
          <SquareActionButton
            label="控制台"
            disabled={selection.kind === 'none'}
            onClick={onOpenConsole}
          />
        </div>
      </div>

      <div className="tree-pane">
        {bootstrapError ? <EmptyNotice title="初始化失败" text={bootstrapError} /> : null}

        {!bootstrapError && profiles.length === 0 && dataSourceGroups.length === 0 ? (
          <EmptyNotice
            title="暂无数据源"
            text="点击左上角加号，在右侧工作区创建新的 MySQL 数据源。"
          />
        ) : null}

        {!bootstrapError && hasSearchKeyword && navigationTreeGroups.length === 0 ? (
          <EmptyNotice title="未找到匹配项" text="没有匹配的连接、数据库或表。" />
        ) : null}

        {navigationTreeGroups.map((group) => {
          const expanded = visibleExpandedKeys.has(group.key)

          return (
            <div className="tree-group" key={group.key}>
              <button
                className={`tree-row group-row ${selectedGroupKey === group.key ? 'selected' : ''}`}
                type="button"
                onClick={() => onSelectGroup(group.key)}
                onDoubleClick={() => onToggleGroupNode(group.key)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (!group.group_id) {
                    return
                  }
                  onTreeGroupContextMenu(event, group.group_id, group.group_name)
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
                            selection.kind === 'profile' && selection.profile_id === profile.id
                              ? 'selected'
                              : ''
                          }`}
                          type="button"
                          onClick={() => onSelectProfile(profile.id)}
                          onDoubleClick={() => onToggleProfileNode(profile.id)}
                          onContextMenu={(event) => onTreeProfileContextMenu(event, profile.id)}
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
                              const databaseKey = `${profile.id}:${database.name}`
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
                                    onClick={() => onSelectDatabase(profile.id, database.name)}
                                    onDoubleClick={() =>
                                      onToggleDatabaseNode(profile.id, database.name)
                                    }
                                    onContextMenu={(event) =>
                                      onTreeDatabaseContextMenu(
                                        event,
                                        profile.id,
                                        database.name,
                                      )
                                    }
                                  >
                                    <span className="tree-caret">
                                      {databaseExpanded ? '▾' : '▸'}
                                    </span>
                                    <TreeDatabaseGlyph />
                                    <span className="tree-node-label">{database.name}</span>
                                    <span className="tree-node-meta">
                                      {hasSearchKeyword && tables.length > 0
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
                                          onClick={() =>
                                            onSelectTable(
                                              profile.id,
                                              database.name,
                                              table.entry.name,
                                            )
                                          }
                                          onDoubleClick={() =>
                                            onOpenTableData(
                                              profile.id,
                                              database.name,
                                              table.entry.name,
                                            )
                                          }
                                          onContextMenu={(event) =>
                                            onTreeTableContextMenu(
                                              event,
                                              profile.id,
                                              database.name,
                                              table.entry.name,
                                            )
                                          }
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
    </div>
  )
}

import { Suspense, lazy } from 'react'
import { GroupAssignmentView, ProfileEditorView } from '../datasource/views'
import { DesignEditorView } from '../table-design/DesignEditorView'
import { EmptyWorkspace, WorkspaceLoadingState } from '../../shared/components/AppChrome'
import type {
  CellValue,
  ConnectionProfile,
  DataSourceGroup,
  DatabaseEntry,
  SaveConnectionProfilePayload,
  SqlAutocompleteSchema,
  TableColumn,
} from '../../types'
import type {
  DesignTab,
  GroupAssignmentTab,
  ProfileTab,
  WorkspaceTab,
} from './appTypes'
import type { ConsoleTab, DataTab } from './types'

const DataEditorView = lazy(() =>
  import('../table-data/DataEditorView').then((module) => ({
    default: module.DataEditorView,
  })),
)

const ConsoleView = lazy(() =>
  import('../sql-console/ConsoleView').then((module) => ({
    default: module.ConsoleView,
  })),
)

type WorkspaceDatasourceTabsProps = {
  activeTab: WorkspaceTab | null
  activeTabId: string
  activeConsoleAutocomplete: SqlAutocompleteSchema | null
  activeConsoleSchemas: SqlAutocompleteSchema[]
  dataSourceGroups: DataSourceGroup[]
  databasesByProfile: Record<string, DatabaseEntry[]>
  profiles: ConnectionProfile[]
  tabs: WorkspaceTab[]
  onActivateTab: (tabId: string) => void
  onAddDesignRow: (tabId: string) => void
  onAddDataRow: (tabId: string) => void
  onApplyDataFilter: (tab: DataTab) => void
  onChangeConsolePage: (tab: ConsoleTab, direction: 'first' | 'prev' | 'next' | 'last') => void
  onChangeDataPage: (tab: DataTab, direction: 'first' | 'prev' | 'next' | 'last') => void
  onClearGroupAssignmentSelection: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onCommitDataChanges: (tab: DataTab) => void
  onCommitDesignChanges: (tab: DesignTab) => void
  onCreateProfileGroupFromTab: (tab: ProfileTab) => Promise<void>
  onDeleteProfileFromTab: (tab: ProfileTab) => Promise<void>
  onDeleteProfileGroupFromTab: (tab: ProfileTab, group: DataSourceGroup) => Promise<void>
  onDeleteSelectedDataRows: (tabId: string) => void
  onDeleteSelectedDesignRows: (tabId: string) => void
  onImportNavicat: () => void
  onOpenDataExportDialog: (tab: DataTab) => void
  onOpenQueryResultExportDialog: (tab: ConsoleTab) => void
  onPatchConsoleDatabase: (tabId: string, databaseName: string | null) => void
  onPatchConsoleSql: (tabId: string, value: string) => void
  onPatchDesignDraftTableName: (tabId: string, value: string) => void
  onPatchDesignRow: (
    tabId: string,
    clientId: string,
    field: keyof TableColumn,
    value: string | boolean | number | null,
  ) => void
  onPatchProfileField: (
    tabId: string,
    field: keyof SaveConnectionProfilePayload,
    value: string | number | null,
  ) => void
  onPatchProfileGroupCreateName: (tabId: string, value: string) => void
  onPatchProfileEditingGroupName: (tabId: string, value: string) => void
  onPreviewDesignSql: (tab: DesignTab) => void
  onRefreshDataTab: (
    tabId: string,
    profileId: string,
    databaseName: string,
    tableName: string,
    whereClause: string,
    orderByClause: string,
    offset: number,
    limit: number,
  ) => void
  onRefreshDesignTab: (
    tabId: string,
    profileId: string,
    databaseName: string,
    tableName: string,
  ) => void
  onRenameProfileGroupFromTab: (tab: ProfileTab) => Promise<void>
  onRestoreSelectedDataRows: (tabId: string) => void
  onRestoreSelectedDesignRows: (tabId: string) => void
  onRunConsoleSql: (tab: ConsoleTab, offset?: number) => void
  onSaveProfileTab: (tab: ProfileTab) => Promise<void>
  onSelectAllGroupAssignmentProfiles: (tabId: string, profileIds: string[]) => void
  onSelectConsoleRowsRange: (
    tabId: string,
    startClientId: string,
    endClientId: string,
    options?: { append?: boolean },
  ) => void
  onSelectDataRowsRange: (
    tabId: string,
    startClientId: string,
    endClientId: string,
    options?: { append?: boolean },
  ) => void
  onStartRenameProfileGroup: (tabId: string, group: DataSourceGroup) => void
  onSubmitProfilesToGroup: (tab: GroupAssignmentTab) => Promise<void>
  onTestProfileTab: (tab: ProfileTab) => Promise<void>
  onCancelRenameProfileGroup: (tabId: string) => void
  onToggleAllDesignRows: (tabId: string, checked: boolean) => void
  onToggleDesignRowSelection: (tabId: string, clientId: string, checked: boolean) => void
  onToggleGroupAssignmentProfile: (tabId: string, profileId: string, checked: boolean) => void
  onToggleProfileGroupManager: (tabId: string) => void
  onUpdateDataQueryField: (
    tabId: string,
    field: 'where_clause' | 'order_by_clause' | 'transaction_mode',
    value: string,
  ) => void
  onUpdateDataRow: (
    tabId: string,
    clientId: string,
    columnName: string,
    value: CellValue,
  ) => void
  onUpdateGroupAssignmentFilter: (tabId: string, value: string) => void
  onResolveConsoleSchema: (
    profileId: string,
    databaseName: string,
  ) => Promise<SqlAutocompleteSchema | null>
  onFormatConsoleSql: (tabId: string) => void
}

export function WorkspaceDatasourceTabs({
  activeTab,
  activeTabId,
  activeConsoleAutocomplete,
  activeConsoleSchemas,
  dataSourceGroups,
  databasesByProfile,
  profiles,
  tabs,
  onActivateTab,
  onAddDesignRow,
  onAddDataRow,
  onApplyDataFilter,
  onChangeConsolePage,
  onChangeDataPage,
  onClearGroupAssignmentSelection,
  onCloseTab,
  onCommitDataChanges,
  onCommitDesignChanges,
  onCreateProfileGroupFromTab,
  onDeleteProfileFromTab,
  onDeleteProfileGroupFromTab,
  onDeleteSelectedDataRows,
  onDeleteSelectedDesignRows,
  onFormatConsoleSql,
  onImportNavicat,
  onOpenDataExportDialog,
  onOpenQueryResultExportDialog,
  onPatchConsoleDatabase,
  onPatchConsoleSql,
  onPatchDesignDraftTableName,
  onPatchDesignRow,
  onPatchProfileEditingGroupName,
  onPatchProfileField,
  onPatchProfileGroupCreateName,
  onPreviewDesignSql,
  onRefreshDataTab,
  onRefreshDesignTab,
  onRenameProfileGroupFromTab,
  onResolveConsoleSchema,
  onRestoreSelectedDataRows,
  onRestoreSelectedDesignRows,
  onRunConsoleSql,
  onSaveProfileTab,
  onSelectAllGroupAssignmentProfiles,
  onSelectConsoleRowsRange,
  onSelectDataRowsRange,
  onStartRenameProfileGroup,
  onSubmitProfilesToGroup,
  onTestProfileTab,
  onCancelRenameProfileGroup,
  onToggleAllDesignRows,
  onToggleDesignRowSelection,
  onToggleGroupAssignmentProfile,
  onToggleProfileGroupManager,
  onUpdateDataQueryField,
  onUpdateDataRow,
  onUpdateGroupAssignmentFilter,
}: WorkspaceDatasourceTabsProps) {
  return (
    <>
      <div className="tab-bar">
        {tabs.map((tab) => (
          <button
            className={`tab-item ${activeTabId === tab.id ? 'active' : ''}`}
            key={tab.id}
            type="button"
            onClick={() => onActivateTab(tab.id)}
          >
            <span>{tab.title}</span>
            <small>{tab.subtitle}</small>
            <span
              className="tab-close"
              onClick={(event) => {
                event.stopPropagation()
                onCloseTab(tab.id)
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
            onFieldChange={onPatchProfileField}
            onToggleGroupManager={onToggleProfileGroupManager}
            onCreateGroupNameChange={onPatchProfileGroupCreateName}
            onCreateGroup={onCreateProfileGroupFromTab}
            onStartRenameGroup={onStartRenameProfileGroup}
            onCancelRenameGroup={onCancelRenameProfileGroup}
            onEditingGroupNameChange={onPatchProfileEditingGroupName}
            onRenameGroup={onRenameProfileGroupFromTab}
            onDeleteGroup={onDeleteProfileGroupFromTab}
            onImportNavicat={onImportNavicat}
            onSave={onSaveProfileTab}
            onTest={onTestProfileTab}
            onDelete={onDeleteProfileFromTab}
          />
        ) : null}

        {activeTab?.kind === 'design' ? (
          <DesignEditorView
            tab={activeTab}
            onRefresh={() =>
              onRefreshDesignTab(
                activeTab.id,
                activeTab.profile_id,
                activeTab.database_name,
                activeTab.table_name,
              )
            }
            onAddColumn={() => onAddDesignRow(activeTab.id)}
            onDeleteColumns={() => onDeleteSelectedDesignRows(activeTab.id)}
            onRestoreColumns={() => onRestoreSelectedDesignRows(activeTab.id)}
            onPreview={() => onPreviewDesignSql(activeTab)}
            onCommit={() => onCommitDesignChanges(activeTab)}
            onToggleAll={(checked) => onToggleAllDesignRows(activeTab.id, checked)}
            onToggleOne={(clientId, checked) =>
              onToggleDesignRowSelection(activeTab.id, clientId, checked)
            }
            onTableNameChange={onPatchDesignDraftTableName}
            onChange={onPatchDesignRow}
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
                onRefreshDataTab(
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
              onAddRow={() => onAddDataRow(activeTab.id)}
              onDeleteRows={() => onDeleteSelectedDataRows(activeTab.id)}
              onRestoreRows={() => onRestoreSelectedDataRows(activeTab.id)}
              onCommit={() => onCommitDataChanges(activeTab)}
              onExport={() => onOpenDataExportDialog(activeTab)}
              onApplyFilter={() => onApplyDataFilter(activeTab)}
              onFirstPage={() => onChangeDataPage(activeTab, 'first')}
              onPrevPage={() => onChangeDataPage(activeTab, 'prev')}
              onNextPage={() => onChangeDataPage(activeTab, 'next')}
              onLastPage={() => onChangeDataPage(activeTab, 'last')}
              onQueryFieldChange={onUpdateDataQueryField}
              onSelectRowsRange={(startClientId, endClientId, options) =>
                onSelectDataRowsRange(activeTab.id, startClientId, endClientId, options)
              }
              onValueChange={onUpdateDataRow}
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
                onResolveConsoleSchema(activeTab.profile_id, databaseName)
              }
              onDatabaseChange={onPatchConsoleDatabase}
              onFormat={onFormatConsoleSql}
              onSqlChange={onPatchConsoleSql}
              onExecute={() => onRunConsoleSql(activeTab, 0)}
              onExport={() => onOpenQueryResultExportDialog(activeTab)}
              onFirstPage={() => onChangeConsolePage(activeTab, 'first')}
              onPrevPage={() => onChangeConsolePage(activeTab, 'prev')}
              onNextPage={() => onChangeConsolePage(activeTab, 'next')}
              onLastPage={() => onChangeConsolePage(activeTab, 'last')}
              onSelectRowsRange={(startClientId, endClientId, options) =>
                onSelectConsoleRowsRange(activeTab.id, startClientId, endClientId, options)
              }
            />
          </Suspense>
        ) : null}

        {activeTab?.kind === 'group_assignment' ? (
          <GroupAssignmentView
            tab={activeTab}
            profiles={profiles}
            dataSourceGroups={dataSourceGroups}
            onFilterChange={onUpdateGroupAssignmentFilter}
            onToggleProfile={onToggleGroupAssignmentProfile}
            onSelectAll={onSelectAllGroupAssignmentProfiles}
            onClearSelection={onClearGroupAssignmentSelection}
            onApply={onSubmitProfilesToGroup}
          />
        ) : null}

        {!activeTab ? <EmptyWorkspace /> : null}
      </div>
    </>
  )
}

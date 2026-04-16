import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  applyTableDataChanges,
  applyTableDesignChanges,
  chooseExportPath,
  createTable,
  executeSql,
  exportQueryResultFile,
  exportQueryResultSqlText,
  exportTableDataFile,
  exportTableDataSqlText,
  getTableDdl,
  loadTableData,
  loadTableDesign,
  previewCreateTableSql,
  previewTableDataChanges,
  previewTableDesignSql,
} from '../../api'
import {
  buildChangedDataValues,
  buildDataMutationPayload,
  createGridRow,
} from '../table-data/dataMutations'
import type {
  CellValue,
  ConnectionProfile,
  DatabaseEntry,
  JsonRecord,
  SqlAutocompleteSchema,
  TableColumn,
  TableDataRow,
} from '../../types'
import type {
  DesignTab,
  ExportDialogState,
  SelectionState,
  SqlPreviewState,
  ToastTone,
  WorkspaceTab,
} from './appTypes'
import type { ConsoleTab, DataGridRow, DataTab } from './types'
import { buildDatabaseKey } from './navigation'
import {
  buildCreateTablePreviewSql,
  buildDataMutationPreviewSql,
  buildFullDataType,
  buildQueryResultExportFileName,
  buildTableDataExportFileName,
  buildTableDataSql,
  copyTextToClipboard,
  createDraftColumn,
  getExportScopeText,
  inferDefaultCellValue,
  prettifySql,
  quoteIdentifier,
  stripDraftColumn,
} from './appHelpers'

type UseTableWorkspaceDomainOptions = {
  activeTab: WorkspaceTab | null
  appendOutputLog: (
    scope: string,
    message: string,
    tone?: ToastTone,
    sql?: string,
  ) => void
  clearSqlAutocompleteCache: (profileId: string, databaseName?: string) => void
  databasesByProfile: Record<string, DatabaseEntry[]>
  ensureDatabasesLoaded: (
    profileId: string,
    options?: { silent?: boolean; force?: boolean },
  ) => Promise<unknown>
  ensureSqlAutocompleteLoaded: (
    profileId: string,
    databaseName: string,
    options?: { force?: boolean; silent?: boolean },
  ) => Promise<SqlAutocompleteSchema | null>
  ensureTablesLoaded: (
    profileId: string,
    databaseName: string,
    options?: { force?: boolean },
  ) => Promise<unknown>
  patchTab: (tabId: string, updater: (tab: WorkspaceTab) => WorkspaceTab) => void
  profiles: ConnectionProfile[]
  pushToast: (message: string, tone: ToastTone) => void
  selectTable: (profileId: string, databaseName: string, tableName: string) => void
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>
  sqlAutocompleteByDatabase: Record<string, SqlAutocompleteSchema>
  tabs: WorkspaceTab[]
  upsertTab: (nextTab: WorkspaceTab) => void
}

export function useTableWorkspaceDomain({
  activeTab,
  appendOutputLog,
  clearSqlAutocompleteCache,
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
}: UseTableWorkspaceDomainOptions) {
  const [ddlDialog, setDdlDialog] = useState<{ title: string; ddl: string } | null>(null)
  const [sqlPreview, setSqlPreview] = useState<SqlPreviewState | null>(null)
  const [exportDialog, setExportDialog] = useState<ExportDialogState | null>(null)

  useEffect(() => {
    setTabs((previous) => {
      let changed = false
      const nextTabs = previous.map((tab) => {
        if (tab.kind !== 'console') {
          return tab
        }

        const nextDatabaseLoading = !databasesByProfile[tab.profile_id]
        if (tab.console.database_loading === nextDatabaseLoading) {
          return tab
        }

        changed = true
        return {
          ...tab,
          console: {
            ...tab.console,
            database_loading: nextDatabaseLoading,
          },
        }
      })

      return changed ? nextTabs : previous
    })
  }, [databasesByProfile, setTabs])

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

  function updateExportDialogScope(scope: 'current_page' | 'all_rows' | 'selected_rows') {
    setExportDialog((previous) => (previous ? { ...previous, scope } : previous))
  }

  function updateExportDialogFormat(format: 'csv' | 'json' | 'sql') {
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
              client_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
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

  function openConsoleFromSelection(selection: SelectionState) {
    if (selection.kind === 'none') {
      pushToast('请先选择数据源、数据库或表', 'info')
      return
    }

    openConsoleTab(selection)
  }

  async function refreshCurrentSelection(selection: SelectionState) {
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

  return {
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
    openConsoleTab,
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
  }
}

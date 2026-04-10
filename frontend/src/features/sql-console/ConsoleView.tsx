import type { DatabaseEntry, SqlAutocompleteSchema } from '../../types'
import { SqlEditor } from '../../SqlEditor'
import { EmptyNotice } from '../../shared/components/EmptyNotice'
import { formatTotalRowsLabel } from '../../shared/utils/pagination'
import { DataGridTable } from '../table-data/DataGridTable'
import type { ConsoleTab } from '../workspace/types'

type ConsoleViewProps = {
  tab: ConsoleTab
  databaseOptions: DatabaseEntry[]
  schemaTables: SqlAutocompleteSchema['tables']
  schemaCatalog: SqlAutocompleteSchema[]
  onResolveSchema: (databaseName: string) => Promise<SqlAutocompleteSchema | null>
  onDatabaseChange: (tabId: string, databaseName: string | null) => void
  onFormat: (tabId: string) => void
  onSqlChange: (tabId: string, value: string) => void
  onExecute: () => void
  onExport: () => void
  onFirstPage: () => void
  onPrevPage: () => void
  onNextPage: () => void
  onLastPage: () => void
  onSelectRowsRange: (
    startClientId: string,
    endClientId: string,
    options?: { append?: boolean },
  ) => void
}

export function ConsoleView({
  tab,
  databaseOptions,
  schemaTables,
  schemaCatalog,
  onResolveSchema,
  onDatabaseChange,
  onFormat,
  onSqlChange,
  onExecute,
  onExport,
  onFirstPage,
  onPrevPage,
  onNextPage,
  onLastPage,
  onSelectRowsRange,
}: ConsoleViewProps) {
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
            <button
              className="console-action"
              disabled={tab.console.loading || tab.console.columns.length === 0}
              type="button"
              onClick={onExport}
            >
              导出结果
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
            onSelectRowsRange={onSelectRowsRange}
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

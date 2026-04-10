import type { CellValue } from '../../types'
import { EmptyNotice } from '../../shared/components/EmptyNotice'
import { InlineSqlInput } from '../../shared/components/InlineSqlInput'
import { formatTotalRowsLabel } from '../../shared/utils/pagination'
import type { DataTab } from '../workspace/types'
import { DataGridTable } from './DataGridTable'
import {
  hasPendingDataMutations,
  hasRestorableSelectedDataRows,
  hasSelectedDataRowsForDelete,
} from './dataMutations'

type DataEditorViewProps = {
  tab: DataTab
  onRefresh: () => void
  onAddRow: () => void
  onDeleteRows: () => void
  onRestoreRows: () => void
  onCommit: () => void
  onExport: () => void
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
  onSelectRowsRange: (
    startClientId: string,
    endClientId: string,
    options?: { append?: boolean },
  ) => void
  onValueChange: (
    tabId: string,
    clientId: string,
    columnName: string,
    value: CellValue,
  ) => void
}

export function DataEditorView({
  tab,
  onRefresh,
  onAddRow,
  onDeleteRows,
  onRestoreRows,
  onCommit,
  onExport,
  onApplyFilter,
  onFirstPage,
  onPrevPage,
  onNextPage,
  onLastPage,
  onQueryFieldChange,
  onSelectRowsRange,
  onValueChange,
}: DataEditorViewProps) {
  const rangeStart = tab.data.rows.length === 0 ? 0 : tab.data.offset + 1
  const rangeEnd =
    tab.data.rows.length === 0
      ? 0
      : Math.min(tab.data.offset + tab.data.rows.length, tab.data.total_rows)
  const atFirstPage = tab.data.offset <= 0 || tab.data.total_rows === 0
  const atLastPage = tab.data.row_count_exact
    ? rangeEnd >= tab.data.total_rows
    : tab.data.rows.length < tab.data.limit
  const totalRowsLabel = formatTotalRowsLabel(tab.data.total_rows, tab.data.row_count_exact)
  const hasPendingDataChanges = hasPendingDataMutations(tab)
  const hasSelectedRowsForDelete = hasSelectedDataRowsForDelete(tab)
  const hasSelectedRowsForRestore = hasRestorableSelectedDataRows(tab)

  return (
    <div className="editor-page data-editor-page">
      <div className="data-control-stack">
        <div className="data-toolbar-row">
          <div className="editor-actions">
            <button className="flat-button" type="button" onClick={onRefresh}>
              刷新
            </button>
            <button className="flat-button" disabled={tab.data.loading} type="button" onClick={onExport}>
              导出
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
              disabled={!tab.data.editable || !hasSelectedRowsForDelete}
              type="button"
              onClick={onDeleteRows}
            >
              删除行
            </button>
            <button
              className="flat-button"
              disabled={!tab.data.editable || !hasSelectedRowsForRestore}
              type="button"
              onClick={onRestoreRows}
            >
              恢复所选
            </button>
            <button
              className="flat-button primary"
              disabled={!tab.data.editable || !hasPendingDataChanges}
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
            <InlineSqlInput
              placeholder="例如 id > 100 AND status = 'ready'"
              value={tab.data.where_clause}
              onChange={(value) => onQueryFieldChange(tab.id, 'where_clause', value)}
              onSubmit={onApplyFilter}
            />
          </label>

          <label className="inline-query-field">
            <span>ORDER BY</span>
            <InlineSqlInput
              placeholder="例如 created_at DESC, id ASC"
              value={tab.data.order_by_clause}
              onChange={(value) => onQueryFieldChange(tab.id, 'order_by_clause', value)}
              onSubmit={onApplyFilter}
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
          onSelectRowsRange={onSelectRowsRange}
          onValueChange={(clientId, columnName, value) =>
            onValueChange(tab.id, clientId, columnName, value)
          }
        />
      </div>

      <footer className="page-footer">
        <span className="page-footer-meta">
          已加载 {tab.data.rows.length} 行，{tab.data.row_count_exact ? '共' : '至少'}{' '}
          {tab.data.total_rows} 行
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
              {rangeStart}-{rangeEnd} / {totalRowsLabel}
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
              disabled={tab.data.loading || !tab.data.row_count_exact || atLastPage}
              type="button"
              onClick={onLastPage}
            >
              &gt;|
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

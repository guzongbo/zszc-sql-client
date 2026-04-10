import { Suspense, lazy, useRef, type RefObject, type UIEventHandler } from 'react'
import { isDataCompareDetailSelected } from './state'
import {
  stringifyCellValue,
} from '../table-data/dataMutations'
import type {
  CompareDetailPageResponse,
  CompareDetailType,
  CompareHistoryPerformance,
  JsonRecord,
  StructureDetailCategory,
  StructureTableItem,
  TableCompareResult,
} from '../../types'
import type {
  DataCompareSelectionItem,
  StructureCompareDetailCacheItem,
} from './types'

const SqlDiffViewer = lazy(() =>
  import('../../SqlEditor').then((module) => ({
    default: module.SqlDiffViewer,
  })),
)

function buildUpdateRowKeys(sourceRow: JsonRecord, targetRow: JsonRecord) {
  return Array.from(new Set([...Object.keys(sourceRow), ...Object.keys(targetRow)]))
}

function getSlowestPerformanceStage(performance: CompareHistoryPerformance | null) {
  const stages = performance?.stages ?? []
  if (stages.length === 0) {
    return null
  }

  return stages.reduce((slowest, stage) =>
    stage.elapsed_ms > slowest.elapsed_ms ? stage : slowest,
  ) as CompareHistoryPerformance['stages'][number]
}

export function CompareDatabaseTablePanel({
  items,
  title,
  matchLabel,
  matchedSet,
  soloLabel,
}: {
  items: string[]
  title: string
  matchLabel: string
  matchedSet: Set<string>
  soloLabel: string
}) {
  return (
    <div className="compare-catalog-card">
      <div className="table-panel-head">
        <div>{title}</div>
        <div className="small-text">{items.length} 张表</div>
      </div>
      <div className="compare-catalog-list">
        {items.length === 0 ? (
          <div className="empty-inline">没有匹配的表</div>
        ) : (
          items.map((tableName) => (
            <div className="compare-readonly-table-item" key={`${title}:${tableName}`}>
              <span>{tableName}</span>
              <span className={`status-tag ${matchedSet.has(tableName) ? 'success' : 'muted'}`}>
                {matchedSet.has(tableName) ? matchLabel : soloLabel}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function CompareDifferenceCard({
  title,
  items,
}: {
  title: string
  items: string[]
}) {
  return (
    <div className="compare-difference-card">
      <div className="compare-difference-title">{title}</div>
      <div className="compare-chip-wrap">
        {items.length === 0 ? (
          <span className="empty-inline">无</span>
        ) : (
          items.slice(0, 18).map((item) => (
            <span className="compare-chip" key={`${title}:${item}`}>
              {item}
            </span>
          ))
        )}
      </div>
    </div>
  )
}

export function CompareResultCheckbox({
  checked,
  indeterminate,
  label,
  countLabel,
  onChange,
}: {
  checked: boolean
  indeterminate: boolean
  label: string
  countLabel: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      className="compare-result-check"
      onClick={(event) => {
        event.stopPropagation()
      }}
    >
      <input
        checked={checked}
        ref={(element) => {
          if (!element) {
            return
          }
          element.indeterminate = indeterminate
        }}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
      <strong>{countLabel}</strong>
    </label>
  )
}

export function DataCompareRowTable({
  columns,
  items,
  tableResult,
  tableKey,
  detailType,
  selectionByTable,
  onToggle,
}: {
  columns: string[]
  items: CompareDetailPageResponse['row_items']
  tableResult: TableCompareResult
  tableKey: string
  detailType: CompareDetailType
  selectionByTable: Record<string, DataCompareSelectionItem>
  onToggle: (
    tableKey: string,
    detailType: CompareDetailType,
    signature: string,
    checked: boolean,
  ) => void
}) {
  if (items.length === 0) {
    return <div className="empty-inline">当前分类下没有差异数据</div>
  }

  return (
    <div className="detail-row-table-wrap">
      <table className="detail-row-table">
        <thead>
          <tr>
            <th className="detail-row-select-col">勾选</th>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.signature}>
              <td>
                <label className="detail-check compact-check">
                  <input
                    checked={isDataCompareDetailSelected(
                      tableResult,
                      selectionByTable,
                      detailType,
                      item.signature,
                    )}
                    type="checkbox"
                    onChange={(event) =>
                      onToggle(
                        tableKey,
                        detailType,
                        item.signature,
                        event.target.checked,
                      )
                    }
                  />
                  <span>纳入</span>
                </label>
              </td>
              {columns.map((column) => (
                <td key={`${item.signature}:${column}`}>
                  {stringifyCellValue(item.row[column] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SyncedUpdateFieldTables({
  diffColumns,
  sourceRow,
  targetRow,
}: {
  diffColumns: string[]
  sourceRow: JsonRecord
  targetRow: JsonRecord
}) {
  const sourceScrollRef = useRef<HTMLDivElement | null>(null)
  const targetScrollRef = useRef<HTMLDivElement | null>(null)
  const syncingTargetRef = useRef<'source' | 'target' | null>(null)
  const rowKeys = buildUpdateRowKeys(sourceRow, targetRow)

  const syncScroll = (origin: 'source' | 'target') => {
    if (syncingTargetRef.current === origin) {
      syncingTargetRef.current = null
      return
    }

    const sourceElement = origin === 'source' ? sourceScrollRef.current : targetScrollRef.current
    const targetElement = origin === 'source' ? targetScrollRef.current : sourceScrollRef.current

    if (!sourceElement || !targetElement) {
      return
    }

    syncingTargetRef.current = origin === 'source' ? 'target' : 'source'
    targetElement.scrollTop = sourceElement.scrollTop
    targetElement.scrollLeft = sourceElement.scrollLeft
  }

  return (
    <>
      <UpdateFieldTable
        diffColumns={diffColumns}
        onScroll={() => syncScroll('source')}
        row={sourceRow}
        rowKeys={rowKeys}
        scrollRef={sourceScrollRef}
        title="源数据"
      />
      <UpdateFieldTable
        diffColumns={diffColumns}
        onScroll={() => syncScroll('target')}
        row={targetRow}
        rowKeys={rowKeys}
        scrollRef={targetScrollRef}
        title="目标数据"
      />
    </>
  )
}

function UpdateFieldTable({
  title,
  row,
  rowKeys,
  diffColumns,
  scrollRef,
  onScroll,
}: {
  title: string
  row: JsonRecord
  rowKeys: string[]
  diffColumns: string[]
  scrollRef?: RefObject<HTMLDivElement | null>
  onScroll?: UIEventHandler<HTMLDivElement>
}) {
  return (
    <div className="compare-update-table">
      <strong>{title}</strong>
      <div className="compare-update-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="compare-update-rows">
          {rowKeys.map((key) => (
            <div
              className={`compare-update-row ${diffColumns.includes(key) ? 'changed' : ''}`}
              key={`${title}:${key}`}
            >
              <span>{key}</span>
              <code>{stringifyCellValue(row[key] ?? null)}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function StructureDetailPanel({
  category,
  item,
  detailState,
  onReload,
}: {
  category: StructureDetailCategory
  item: StructureTableItem
  detailState: StructureCompareDetailCacheItem | undefined
  onReload: () => void
}) {
  if (detailState?.loading) {
    return <div className="status-panel">正在加载结构详情...</div>
  }

  if (detailState?.error) {
    return (
      <div className="status-panel warning compare-warning-panel">
        <span>{detailState.error}</span>
        <button className="flat-button" type="button" onClick={onReload}>
          重试加载
        </button>
      </div>
    )
  }

  const detail = detailState?.detail?.detail ?? item
  const detailPerformance = detailState?.detail?.performance ?? null
  const slowestStage = getSlowestPerformanceStage(detailPerformance)

  return (
    <div className="structure-detail-card">
      {detailPerformance && detailPerformance.total_elapsed_ms > 0 ? (
        <div className="compare-chip-wrap">
          <span className="compare-chip">总耗时 {detailPerformance.total_elapsed_ms} ms</span>
          {slowestStage ? (
            <span className="compare-chip">
              最慢：{slowestStage.label} {slowestStage.elapsed_ms} ms
            </span>
          ) : null}
          {detailPerformance.stages.map((stage) => (
            <span className="compare-chip" key={`${stage.key}:${stage.label}`}>
              {stage.label} {stage.elapsed_ms} ms
            </span>
          ))}
        </div>
      ) : null}
      {detail.warnings.length > 0 ? (
        <div className="status-panel warning compare-warning-panel">
          {detail.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}
      {category === 'modified' ? (
        <>
          {detail.preview_sql ? <SqlViewer sql={detail.preview_sql} title="结构同步 SQL" /> : null}
          <Suspense fallback={<div className="status-panel">正在加载 DDL 对比视图...</div>}>
            <SqlDiffViewer
              editor_id={`structure-compare:${item.table_name}`}
              modified_label="目标端 DDL"
              modified_sql={detail.target_sql ?? '-- 暂无目标端 DDL'}
              original_label="源端 DDL"
              original_sql={detail.source_sql ?? '-- 暂无源端 DDL'}
            />
          </Suspense>
        </>
      ) : (
        <SqlViewer sql={detail.preview_sql ?? '-- 暂无可预览 SQL'} />
      )}
    </div>
  )
}

export function SqlViewer({
  title,
  sql,
}: {
  title?: string
  sql: string
}) {
  return (
    <div className="compare-sql-block">
      {title ? <div className="compare-sql-label">{title}</div> : null}
      <pre className="compare-sql-pre">{sql}</pre>
    </div>
  )
}

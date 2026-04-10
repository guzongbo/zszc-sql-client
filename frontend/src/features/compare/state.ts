import type {
  CompareDetailPageResponse,
  CompareDetailType,
  DataCompareResponse,
  StructureCompareResponse,
  StructureDetailCategory,
  StructureSqlSelection,
  TableCompareResult,
  TableSqlSelection,
} from '../../types'
import type {
  DataCompareDetailState,
  DataCompareSelectionItem,
  DataCompareState,
} from './types'

const dataCompareDetailCacheLimit = 300

export function getStructureItemsByCategory(
  result: StructureCompareResponse | null,
  category: StructureDetailCategory,
) {
  if (!result) {
    return []
  }
  if (category === 'added') {
    return result.added_tables
  }
  if (category === 'modified') {
    return result.modified_tables
  }
  return result.deleted_tables
}

export function pickFirstStructureCategory(
  result: StructureCompareResponse,
): StructureDetailCategory {
  if (result.added_tables.length > 0) {
    return 'added'
  }
  if (result.modified_tables.length > 0) {
    return 'modified'
  }
  return 'deleted'
}

export function getStructureSelectionTotal(
  selectionByCategory: Record<StructureDetailCategory, string[]>,
) {
  return (
    selectionByCategory.added.length +
    selectionByCategory.modified.length +
    selectionByCategory.deleted.length
  )
}

export function buildStructureCompareDetailKey(
  category: StructureDetailCategory,
  tableName: string,
) {
  return `${category}::${tableName}`
}

export function createStructureSelectionState(result: StructureCompareResponse) {
  return {
    added: result.added_tables.map((item) => item.table_name),
    modified: result.modified_tables.map((item) => item.table_name),
    deleted: result.deleted_tables.map((item) => item.table_name),
  }
}

export function buildDataCompareResultTableKey(item: TableCompareResult) {
  return `${item.source_table}__${item.target_table}`
}

export function createEmptyDataCompareSelectionItem(): DataCompareSelectionItem {
  return {
    table_enabled: true,
    insert_enabled: true,
    update_enabled: true,
    delete_enabled: true,
    excluded_insert_signatures: [],
    excluded_update_signatures: [],
    excluded_delete_signatures: [],
  }
}

export function createDataCompareSelectionState(result: DataCompareResponse) {
  return Object.fromEntries(
    result.table_results.map((item) => [
      buildDataCompareResultTableKey(item),
      createEmptyDataCompareSelectionItem(),
    ]),
  ) as Record<string, DataCompareSelectionItem>
}

export function createEmptyDataCompareDetailState(): DataCompareDetailState {
  return {
    row_columns: [],
    row_items: [],
    update_items: [],
    total: 0,
    fetched: 0,
    has_more: false,
    loading: false,
    loaded: false,
    error: '',
  }
}

function limitDataCompareDetailRows(rows: CompareDetailPageResponse['row_items']) {
  return rows.length <= dataCompareDetailCacheLimit
    ? rows
    : rows.slice(-dataCompareDetailCacheLimit)
}

function limitDataCompareDetailUpdates(updates: CompareDetailPageResponse['update_items']) {
  return updates.length <= dataCompareDetailCacheLimit
    ? updates
    : updates.slice(-dataCompareDetailCacheLimit)
}

export function buildPrunedDataCompareDetailPages(
  previousPages: DataCompareState['detail_pages'],
  tableKey: string,
  detailType: CompareDetailType,
  detailPage: CompareDetailPageResponse,
  reset: boolean,
) {
  const currentTablePages = {
    insert: previousPages[tableKey]?.insert ?? createEmptyDataCompareDetailState(),
    update: previousPages[tableKey]?.update ?? createEmptyDataCompareDetailState(),
    delete: previousPages[tableKey]?.delete ?? createEmptyDataCompareDetailState(),
  }

  const nextDetailState: DataCompareDetailState = {
    ...(currentTablePages[detailType] ?? createEmptyDataCompareDetailState()),
    row_columns: detailPage.row_columns,
    row_items:
      detailType === 'update'
        ? []
        : limitDataCompareDetailRows([
            ...(reset ? [] : currentTablePages[detailType].row_items),
            ...detailPage.row_items,
          ]),
    update_items:
      detailType === 'update'
        ? limitDataCompareDetailUpdates([
            ...(reset ? [] : currentTablePages[detailType].update_items),
            ...detailPage.update_items,
          ])
        : [],
    total: detailPage.total,
    fetched:
      (reset ? 0 : currentTablePages[detailType].fetched) +
      (detailType === 'update'
        ? detailPage.update_items.length
        : detailPage.row_items.length),
    has_more: detailPage.has_more,
    loading: false,
    loaded: true,
    error: '',
  }

  return {
    [tableKey]: {
      insert:
        detailType === 'insert'
          ? nextDetailState
          : createEmptyDataCompareDetailState(),
      update:
        detailType === 'update'
          ? nextDetailState
          : createEmptyDataCompareDetailState(),
      delete:
        detailType === 'delete'
          ? nextDetailState
          : createEmptyDataCompareDetailState(),
    },
  }
}

export function getDataCompareActionTotalCount(
  item: TableCompareResult,
  detailType: CompareDetailType,
) {
  if (detailType === 'update') {
    return item.update_count
  }
  if (detailType === 'delete') {
    return item.delete_count
  }
  return item.insert_count
}

export function getDataCompareExcludedSignatures(
  selectionByTable: Record<string, DataCompareSelectionItem>,
  tableKey: string,
  detailType: CompareDetailType,
) {
  const selection =
    selectionByTable[tableKey] ?? createEmptyDataCompareSelectionItem()

  if (detailType === 'update') {
    return selection.excluded_update_signatures
  }
  if (detailType === 'delete') {
    return selection.excluded_delete_signatures
  }
  return selection.excluded_insert_signatures
}

export function getDataCompareActionSelectionStats(
  item: TableCompareResult,
  selectionByTable: Record<string, DataCompareSelectionItem>,
  detailType: CompareDetailType,
) {
  const tableKey = buildDataCompareResultTableKey(item)
  const selection =
    selectionByTable[tableKey] ?? createEmptyDataCompareSelectionItem()
  const total = getDataCompareActionTotalCount(item, detailType)
  const actionEnabled =
    selection.table_enabled &&
    (detailType === 'insert'
      ? selection.insert_enabled
      : detailType === 'update'
        ? selection.update_enabled
        : selection.delete_enabled)

  if (!actionEnabled) {
    return {
      selected: 0,
      total,
      checked: false,
      indeterminate: false,
    }
  }

  const selected = Math.max(
    total - getDataCompareExcludedSignatures(selectionByTable, tableKey, detailType).length,
    0,
  )

  return {
    selected,
    total,
    checked: total > 0 && selected === total,
    indeterminate: selected > 0 && selected < total,
  }
}

export function getDataCompareTableSelectionStats(
  item: TableCompareResult,
  selectionByTable: Record<string, DataCompareSelectionItem>,
) {
  const insertStats = getDataCompareActionSelectionStats(item, selectionByTable, 'insert')
  const updateStats = getDataCompareActionSelectionStats(item, selectionByTable, 'update')
  const deleteStats = getDataCompareActionSelectionStats(item, selectionByTable, 'delete')
  const selectedTotal = insertStats.selected + updateStats.selected + deleteStats.selected
  const totalTotal = insertStats.total + updateStats.total + deleteStats.total

  return {
    selected_total: selectedTotal,
    total_total: totalTotal,
    table_checked: totalTotal > 0 && selectedTotal === totalTotal,
    table_indeterminate: selectedTotal > 0 && selectedTotal < totalTotal,
    insert_selected: insertStats.selected,
    insert_total: insertStats.total,
    insert_checked: insertStats.checked,
    insert_indeterminate: insertStats.indeterminate,
    update_selected: updateStats.selected,
    update_total: updateStats.total,
    update_checked: updateStats.checked,
    update_indeterminate: updateStats.indeterminate,
    delete_selected: deleteStats.selected,
    delete_total: deleteStats.total,
    delete_checked: deleteStats.checked,
    delete_indeterminate: deleteStats.indeterminate,
  }
}

export function getDataCompareSelectionSummary(
  result: DataCompareResponse | null,
  selectionByTable: Record<string, DataCompareSelectionItem>,
) {
  return (result?.table_results ?? []).reduce(
    (summary, item) => {
      const tableStats = getDataCompareTableSelectionStats(item, selectionByTable)
      if (tableStats.selected_total > 0) {
        summary.selected_tables += 1
      }
      summary.insert_selected += tableStats.insert_selected
      summary.update_selected += tableStats.update_selected
      summary.delete_selected += tableStats.delete_selected
      return summary
    },
    {
      selected_tables: 0,
      insert_selected: 0,
      update_selected: 0,
      delete_selected: 0,
    },
  )
}

export function isDataCompareDetailSelected(
  item: TableCompareResult,
  selectionByTable: Record<string, DataCompareSelectionItem>,
  detailType: CompareDetailType,
  signature: string,
) {
  const tableKey = buildDataCompareResultTableKey(item)
  const selection =
    selectionByTable[tableKey] ?? createEmptyDataCompareSelectionItem()
  const actionEnabled =
    selection.table_enabled &&
    (detailType === 'insert'
      ? selection.insert_enabled
      : detailType === 'update'
        ? selection.update_enabled
        : selection.delete_enabled)

  if (!actionEnabled) {
    return false
  }

  return !getDataCompareExcludedSignatures(selectionByTable, tableKey, detailType).includes(
    signature,
  )
}

export function toggleExcludedSignature(
  signatures: string[],
  signature: string,
  checked: boolean,
) {
  const next = new Set(signatures)
  if (checked) {
    next.delete(signature)
  } else {
    next.add(signature)
  }
  return Array.from(next)
}

export function buildDataCompareTableSelections(
  result: DataCompareResponse,
  selectionByTable: Record<string, DataCompareSelectionItem>,
): TableSqlSelection[] {
  return result.table_results.map((item) => {
    const tableKey = buildDataCompareResultTableKey(item)
    const tableStats = getDataCompareTableSelectionStats(item, selectionByTable)

    return {
      source_table: item.source_table,
      target_table: item.target_table,
      table_enabled: tableStats.selected_total > 0,
      insert_enabled: tableStats.insert_selected > 0,
      update_enabled: tableStats.update_selected > 0,
      delete_enabled: tableStats.delete_selected > 0,
      excluded_insert_signatures: getDataCompareExcludedSignatures(
        selectionByTable,
        tableKey,
        'insert',
      ),
      excluded_update_signatures: getDataCompareExcludedSignatures(
        selectionByTable,
        tableKey,
        'update',
      ),
      excluded_delete_signatures: getDataCompareExcludedSignatures(
        selectionByTable,
        tableKey,
        'delete',
      ),
    }
  })
}

export function buildStructureSqlSelection(
  selectionByCategory: Record<StructureDetailCategory, string[]>,
): StructureSqlSelection {
  return {
    added_tables: selectionByCategory.added,
    modified_tables: selectionByCategory.modified,
    deleted_tables: selectionByCategory.deleted,
  }
}

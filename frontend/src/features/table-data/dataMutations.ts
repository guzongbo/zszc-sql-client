import type {
  ApplyTableDataChangesPayload,
  CellValue,
  JsonRecord,
  TableDataColumn,
  TableDataRow,
} from '../../types'
import type { DataGridRow, DataTab } from '../workspace/types'

function createClientId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createGridRow(row: TableDataRow): DataGridRow {
  return {
    client_id: createClientId(),
    selected: false,
    state: 'clean',
    row_key: row.row_key ? { ...row.row_key } : null,
    original_values: { ...row.values },
    values: { ...row.values },
  }
}

export function stringifyCellValue(value: CellValue) {
  if (value == null) {
    return 'null'
  }
  return String(value)
}

export function parseCellValue(raw: string, column: TableDataColumn): CellValue {
  const normalized = raw.trim()
  if (!normalized) {
    return isTextLikeColumn(column) ? '' : null
  }

  if (normalized.toUpperCase() === 'NULL') {
    return null
  }

  if (
    /(int|decimal|numeric|float|double|real)/i.test(column.data_type) &&
    !Number.isNaN(Number(normalized))
  ) {
    return Number(normalized)
  }

  if (/bool/i.test(column.data_type)) {
    if (normalized === 'true') {
      return true
    }
    if (normalized === 'false') {
      return false
    }
  }

  return raw
}

function isTextLikeColumn(column: TableDataColumn) {
  const normalizedType = column.data_type.trim().toLowerCase()
  return (
    normalizedType.includes('char') ||
    normalizedType.includes('text') ||
    normalizedType.includes('enum') ||
    normalizedType.includes('set') ||
    normalizedType.includes('json')
  )
}

function isCellValueEqual(left: CellValue | undefined, right: CellValue | undefined) {
  if (left === right) {
    return true
  }

  return (
    typeof left === 'number' &&
    typeof right === 'number' &&
    Number.isNaN(left) &&
    Number.isNaN(right)
  )
}

export function buildChangedDataValues(row: DataGridRow): JsonRecord {
  return Object.fromEntries(
    Object.entries(row.values).filter(([columnName, value]) => {
      if (!Object.prototype.hasOwnProperty.call(row.original_values, columnName)) {
        return true
      }

      return !isCellValueEqual(value, row.original_values[columnName])
    }),
  ) as JsonRecord
}

export function hasPendingDataMutations(tab: DataTab) {
  return tab.data.rows.some((row) => {
    if (row.state === 'new' || row.state === 'deleted') {
      return true
    }

    if (row.state !== 'updated' || !row.row_key) {
      return false
    }

    return Object.keys(buildChangedDataValues(row)).length > 0
  })
}

export function hasSelectedDataRowsForDelete(tab: DataTab) {
  return tab.data.rows.some((row) => row.selected && row.state !== 'deleted')
}

export function hasRestorableSelectedDataRows(tab: DataTab) {
  return tab.data.rows.some((row) => {
    if (!row.selected) {
      return false
    }

    if (row.state === 'new' || row.state === 'deleted') {
      return true
    }

    if (row.state !== 'updated') {
      return false
    }

    return Object.keys(buildChangedDataValues(row)).length > 0
  })
}

export function buildDataMutationPayload(tab: DataTab): ApplyTableDataChangesPayload | null {
  const insertedRows = tab.data.rows
    .filter((row) => row.state === 'new')
    .map((row) => ({ values: row.values }))
  const updatedRows = tab.data.rows
    .filter((row) => row.state === 'updated' && row.row_key)
    .map((row) => ({ row_key: row.row_key!, values: buildChangedDataValues(row) }))
    .filter((row) => Object.keys(row.values).length > 0)
  const deletedRows = tab.data.rows
    .filter((row) => row.state === 'deleted' && row.row_key)
    .map((row) => ({ row_key: row.row_key! }))

  if (insertedRows.length + updatedRows.length + deletedRows.length === 0) {
    return null
  }

  return {
    profile_id: tab.profile_id,
    database_name: tab.database_name,
    table_name: tab.table_name,
    transaction_mode: tab.data.transaction_mode,
    inserted_rows: insertedRows,
    updated_rows: updatedRows,
    deleted_rows: deletedRows,
  }
}

import { writeClipboardText } from '../../api'
import type { CompareFormState } from '../compare/types'
import type {
  CellValue,
  CompareHistoryInput,
  DataCompareRequest,
  DataCompareResponse,
  ExportFileFormat,
  ExportScope,
  StructureCompareRequest,
  StructureCompareResponse,
  TableColumn,
} from '../../types'
import type {
  DesignDraftColumn,
  DesignTab,
  ExportDialogState,
} from './appTypes'
import type { DataTab } from './types'

export function buildDataCompareHistoryInput(
  result: DataCompareResponse,
  request: DataCompareRequest,
  sourceDataSourceName: string,
  targetDataSourceName: string,
): CompareHistoryInput {
  return {
    history_type: 'data',
    source_profile_id: request.source_profile_id,
    source_data_source_name: sourceDataSourceName,
    source_database: request.source_database_name,
    target_profile_id: request.target_profile_id,
    target_data_source_name: targetDataSourceName,
    target_database: request.target_database_name,
    table_mode: request.table_mode,
    selected_tables:
      request.table_mode === 'selected'
        ? request.selected_tables
        : result.table_results.map((item) => item.source_table),
    table_detail: {
      data_tables: result.table_results.map((item) => ({
        source_table: item.source_table,
        target_table: item.target_table,
      })),
      added_tables: [],
      modified_tables: [],
      deleted_tables: [],
    },
    performance: {
      total_elapsed_ms: result.performance.total_elapsed_ms,
      stages: result.performance.stages,
      max_parallelism: result.performance.max_parallelism,
    },
    source_table_count: result.summary.total_tables,
    target_table_count: result.summary.total_tables,
    total_tables: result.summary.total_tables,
    compared_tables: result.summary.compared_tables,
    insert_count: result.summary.total_insert_count,
    update_count: result.summary.total_update_count,
    delete_count: result.summary.total_delete_count,
    structure_added_count: 0,
    structure_modified_count: 0,
    structure_deleted_count: 0,
  }
}

export function buildStructureCompareHistoryInput(
  result: StructureCompareResponse,
  request: StructureCompareRequest,
  sourceDataSourceName: string,
  targetDataSourceName: string,
): CompareHistoryInput {
  return {
    history_type: 'structure',
    source_profile_id: request.source_profile_id,
    source_data_source_name: sourceDataSourceName,
    source_database: request.source_database_name,
    target_profile_id: request.target_profile_id,
    target_data_source_name: targetDataSourceName,
    target_database: request.target_database_name,
    table_mode: 'all',
    selected_tables: [],
    table_detail: {
      data_tables: [],
      added_tables: result.added_tables.map((item) => item.table_name),
      modified_tables: result.modified_tables.map((item) => item.table_name),
      deleted_tables: result.deleted_tables.map((item) => item.table_name),
    },
    performance: result.performance,
    source_table_count: result.summary.source_table_count,
    target_table_count: result.summary.target_table_count,
    total_tables:
      result.summary.added_table_count +
      result.summary.modified_table_count +
      result.summary.deleted_table_count,
    compared_tables:
      result.summary.added_table_count +
      result.summary.modified_table_count +
      result.summary.deleted_table_count,
    insert_count: 0,
    update_count: 0,
    delete_count: 0,
    structure_added_count: result.summary.added_table_count,
    structure_modified_count: result.summary.modified_table_count,
    structure_deleted_count: result.summary.deleted_table_count,
  }
}

export function parsePositiveIntegerOrNull(value: string) {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

export function createClientId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function buildDataCompareSqlFileName(compareForm: CompareFormState) {
  const source = compareForm.source_database_name || 'source'
  const target = compareForm.target_database_name || 'target'
  return `${source}_to_${target}_${formatFileDate(new Date())}.sql`
}

export function buildStructureCompareSqlFileName(compareForm: CompareFormState) {
  const source = compareForm.source_database_name || 'source'
  const target = compareForm.target_database_name || 'target'
  return `${source}_to_${target}_structure_${formatFileDate(new Date())}.sql`
}

export function buildTableDataExportFileName(
  databaseName: string,
  tableName: string,
  format: ExportFileFormat,
) {
  return `${databaseName}_${tableName}_${formatFileDate(new Date())}.${format}`
}

export function buildQueryResultExportFileName(
  databaseName: string | null,
  format: ExportFileFormat,
) {
  const prefix = databaseName || 'query_result'
  return `${prefix}_${formatFileDate(new Date())}.${format}`
}

export function getExportScopeText(dialog: ExportDialogState) {
  if (dialog.kind === 'table_data') {
    if (dialog.scope === 'all_rows') {
      const hasFilter =
        Boolean(dialog.load_payload.where_clause?.trim()) ||
        Boolean(dialog.load_payload.order_by_clause?.trim())
      return hasFilter ? '当前筛选结果' : '整表数据'
    }
    if (dialog.scope === 'selected_rows') {
      return '所选行'
    }
    return '当前页'
  }

  if (dialog.scope === 'all_rows') {
    return '完整查询结果'
  }
  if (dialog.scope === 'selected_rows') {
    return '所选行'
  }
  return '当前页'
}

export function getExportScopeOptions(dialog: ExportDialogState) {
  const currentRows = dialog.rows.length
  const selectedRows = dialog.selected_rows.length

  if (dialog.kind === 'table_data') {
    const hasFilter =
      Boolean(dialog.load_payload.where_clause?.trim()) ||
      Boolean(dialog.load_payload.order_by_clause?.trim())

    return [
      {
        value: 'current_page' as ExportScope,
        label: '当前页',
        description:
          currentRows > 0
            ? `导出当前页已加载的 ${currentRows} 行数据`
            : '当前页暂无行数据，将仅导出表头',
        disabled: dialog.columns.length === 0,
      },
      {
        value: 'all_rows' as ExportScope,
        label: hasFilter ? '当前筛选结果' : '整表数据',
        description: hasFilter
          ? '按当前 WHERE / ORDER BY 重新查询并导出全部结果'
          : '重新查询整张表并导出全部结果',
        disabled: false,
      },
      {
        value: 'selected_rows' as ExportScope,
        label: '所选行',
        description:
          selectedRows > 0
            ? `导出当前表格中已选中的 ${selectedRows} 行`
            : '请先在表格中框选需要导出的行',
        disabled: selectedRows === 0,
      },
    ]
  }

  return [
    {
      value: 'current_page' as ExportScope,
      label: '当前页',
      description:
        currentRows > 0
          ? `导出当前页已加载的 ${currentRows} 行结果`
          : '当前页暂无行数据，将仅导出表头',
      disabled: dialog.columns.length === 0,
    },
    {
      value: 'all_rows' as ExportScope,
      label: '完整查询结果',
      description: '重新执行当前 SQL，并导出完整结果集',
      disabled: false,
    },
    {
      value: 'selected_rows' as ExportScope,
      label: '所选行',
      description:
        selectedRows > 0
          ? `导出当前结果表格中已选中的 ${selectedRows} 行`
          : '请先在结果表格中框选需要导出的行',
      disabled: selectedRows === 0,
    },
  ]
}

export async function copyTextToClipboard(text: string) {
  if ('__TAURI_INTERNALS__' in window) {
    await writeClipboardText(text)
    return
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  const succeeded = document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!succeeded) {
    throw new Error('当前环境不支持写入剪贴板')
  }
}

export function formatOutputTimestamp(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export function quoteIdentifier(raw: string) {
  return `\`${raw.replaceAll('`', '``')}\``
}

export function buildTableDataSql(
  databaseName: string,
  tableName: string,
  whereClause: string,
  orderByClause: string,
  limit: number,
  offset: number,
) {
  const parts = [
    `SELECT * FROM ${quoteIdentifier(databaseName)}.${quoteIdentifier(tableName)}`,
  ]

  if (whereClause.trim()) {
    parts.push(`WHERE ${whereClause.trim()}`)
  }

  if (orderByClause.trim()) {
    parts.push(`ORDER BY ${orderByClause.trim()}`)
  }

  parts.push(`LIMIT ${limit}`)

  if (offset > 0) {
    parts.push(`OFFSET ${offset}`)
  }

  return parts.join('\n')
}

export function buildCreateTablePreviewSql(tab: DesignTab) {
  const columns = tab.design.draft_columns.map((column) => stripDraftColumn(column))
  const primaryKeys = columns.filter((column) => column.primary_key)
  const columnSql = columns.map((column) => {
    const pieces = [
      quoteIdentifier(column.name),
      buildFullDataType(column),
      column.nullable ? 'NULL' : 'NOT NULL',
    ]
    if (column.auto_increment) {
      pieces.push('AUTO_INCREMENT')
    }
    if (column.default_value) {
      pieces.push(`DEFAULT '${column.default_value}'`)
    }
    return pieces.join(' ')
  })

  if (primaryKeys.length > 0) {
    columnSql.push(
      `PRIMARY KEY (${primaryKeys.map((column) => quoteIdentifier(column.name)).join(', ')})`,
    )
  }

  return `CREATE TABLE ${quoteIdentifier(tab.database_name)}.${quoteIdentifier(
    tab.design.draft_table_name || 'new_table',
  )} (\n  ${columnSql.join(',\n  ')}\n)`
}

export function buildDataMutationPreviewSql(tab: DataTab) {
  return tab.data.rows
    .filter((row) => row.state !== 'clean')
    .map((row) => {
      if (row.state === 'new') {
        return `INSERT INTO ${quoteIdentifier(tab.database_name)}.${quoteIdentifier(tab.table_name)} (...) VALUES (...);`
      }
      if (row.state === 'updated') {
        return `UPDATE ${quoteIdentifier(tab.database_name)}.${quoteIdentifier(tab.table_name)} SET ... WHERE ...;`
      }
      return `DELETE FROM ${quoteIdentifier(tab.database_name)}.${quoteIdentifier(tab.table_name)} WHERE ...;`
    })
    .join('\n')
}

export function prettifySql(rawSql: string) {
  const normalized = rawSql
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim()

  if (!normalized) {
    return ''
  }

  const formatted = normalized
    .replace(/\b(select)\b/gi, 'SELECT')
    .replace(/\b(from)\b/gi, '\nFROM')
    .replace(/\b(where)\b/gi, '\nWHERE')
    .replace(/\b(order by)\b/gi, '\nORDER BY')
    .replace(/\b(group by)\b/gi, '\nGROUP BY')
    .replace(/\b(limit)\b/gi, '\nLIMIT')
    .replace(/\b(values)\b/gi, '\nVALUES')
    .replace(/\b(set)\b/gi, '\nSET')
    .replace(/\b(left join|right join|inner join|outer join|join)\b/gi, '\n$1')
    .replace(/\b(and)\b/gi, '\n  AND')
    .replace(/\b(or)\b/gi, '\n  OR')

  return formatted
    .split('\n')
    .map((line, index) => (index === 0 ? line.trim() : line.trimStart()))
    .join('\n')
}

export function createDraftColumn(
  column: TableColumn,
  originName: string | null = column.name,
): DesignDraftColumn {
  return {
    ...column,
    client_id: createClientId(),
    selected: false,
    origin_name: originName,
  }
}

export function stripDraftColumn(column: DesignDraftColumn): TableColumn {
  return {
    name: column.name.trim(),
    data_type: column.data_type.trim(),
    full_data_type: buildFullDataType(column),
    length: column.length,
    scale: column.scale,
    nullable: column.nullable,
    primary_key: column.primary_key,
    auto_increment: column.auto_increment,
    default_value: column.default_value,
    comment: column.comment,
    ordinal_position: column.ordinal_position,
  }
}

export function buildFullDataType(column: {
  data_type: string
  length: number | null
  scale: number | null
}) {
  const dataType = column.data_type.trim().toLowerCase()
  if (!column.length) {
    return dataType
  }
  if (column.scale == null) {
    return `${dataType}(${column.length})`
  }
  return `${dataType}(${column.length},${column.scale})`
}

export function inferDefaultCellValue(rawDefault: string): CellValue {
  if (rawDefault === 'CURRENT_TIMESTAMP') {
    return new Date().toISOString().slice(0, 19).replace('T', ' ')
  }
  if (!Number.isNaN(Number(rawDefault))) {
    return Number(rawDefault)
  }
  return rawDefault
}

function formatFileDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}_${hours}${minutes}${seconds}`
}

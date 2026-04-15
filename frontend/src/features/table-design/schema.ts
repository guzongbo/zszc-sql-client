import type { DesignDraftColumn, DesignTab } from '../workspace/appTypes'
import type { TableColumn } from '../../types'

export const commonDataTypes = [
  'bigint',
  'int',
  'tinyint',
  'varchar',
  'text',
  'decimal',
  'datetime',
  'timestamp',
  'date',
]

export function createDraftColumn(
  column: TableColumn,
  createClientId: () => string,
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

export function parseOptionalNumber(raw: string) {
  const normalized = raw.trim()
  if (!normalized) {
    return null
  }
  const parsed = Number.parseInt(normalized, 10)
  return Number.isNaN(parsed) ? null : parsed
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

export function quoteIdentifier(raw: string) {
  return `\`${raw.replaceAll('`', '``')}\``
}

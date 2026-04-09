import type {
  AppBootstrap,
  ApplyTableDataChangesPayload,
  ConnectionProfile,
  ConnectionTestResult,
  CreateDatabasePayload,
  CreateTablePayload,
  DatabaseEntry,
  ExecuteSqlPayload,
  JsonRecord,
  LoadTableDataPayload,
  MutationResult,
  SaveConnectionProfilePayload,
  SqlConsoleResult,
  SqlPreview,
  TableColumn,
  TableColumnSummary,
  TableDataPage,
  TableDataRow,
  TableDesign,
  TableDesignMutationPayload,
  TableDdl,
  TableEntry,
  TableIdentity,
} from './types'

const now = '2026-04-09T10:00:00+08:00'

let connectionProfiles: ConnectionProfile[] = [
  {
    id: 'mock-prod-srm',
    group_name: '框架协议',
    data_source_name: '框架协议采购系统',
    host: '10.20.8.12',
    port: 3306,
    username: 'readonly_user',
    password: '******',
    created_at: now,
    updated_at: now,
  },
  {
    id: 'mock-test-srm',
    group_name: null,
    data_source_name: '采购测试库',
    host: '10.20.8.22',
    port: 3306,
    username: 'tester',
    password: '******',
    created_at: now,
    updated_at: now,
  },
]

const tableDesignKey = 'mock-prod-srm:cd_biz_srm:performance_assess'
const altTableDesignKey = 'mock-prod-srm:cd_biz_srm:performance_assess_supplier'

let tableDesigns: Record<string, TableDesign> = {
  [tableDesignKey]: {
    profile_id: 'mock-prod-srm',
    database_name: 'cd_biz_srm',
    table_name: 'performance_assess',
    ddl: `CREATE TABLE \`performance_assess\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  \`assess_name\` varchar(64) NOT NULL COMMENT '评价名称',
  \`assess_type\` tinyint(3) NOT NULL DEFAULT '3' COMMENT '评价类型',
  \`insert_person_id\` bigint NOT NULL COMMENT '创建人ID',
  \`insert_person_name\` varchar(64) NOT NULL COMMENT '创建人姓名',
  \`insert_time\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='绩效考核';`,
    columns: [
      buildColumn('id', 'bigint', 20, null, false, true, true, null, '主键ID', 1),
      buildColumn('assess_name', 'varchar', 64, null, false, false, false, null, '评价名称', 2),
      buildColumn('assess_type', 'tinyint', 3, 0, false, false, false, '3', '评价类型', 3),
      buildColumn('insert_person_id', 'bigint', 20, null, false, false, false, null, '创建人ID', 4),
      buildColumn('insert_person_name', 'varchar', 64, null, false, false, false, null, '创建人姓名', 5),
      buildColumn(
        'insert_time',
        'datetime',
        null,
        null,
        false,
        false,
        false,
        'CURRENT_TIMESTAMP',
        '创建时间',
        6,
      ),
    ],
  },
  [altTableDesignKey]: {
    profile_id: 'mock-prod-srm',
    database_name: 'cd_biz_srm',
    table_name: 'performance_assess_supplier',
    ddl: 'CREATE TABLE `performance_assess_supplier` (...);',
    columns: [
      buildColumn('id', 'bigint', 20, null, false, true, true, null, '主键ID', 1),
      buildColumn('supplier_name', 'varchar', 128, null, false, false, false, null, '供应商名称', 2),
      buildColumn('score', 'decimal', 10, 2, true, false, false, '0', '评分', 3),
    ],
  },
}

let tableRows: Record<string, TableDataRow[]> = {
  [tableDesignKey]: [
    {
      row_key: { id: 1991418341324681201 },
      values: {
        id: 1991418341324681201,
        assess_name: '年度评价',
        assess_type: 3,
        insert_person_id: 1740641443703345100,
        insert_person_name: '钟远和',
        insert_time: '2025-11-20 10:24:30',
      },
    },
    {
      row_key: { id: 1991418341324681202 },
      values: {
        id: 1991418341324681202,
        assess_name: '季度评价',
        assess_type: 2,
        insert_person_id: 1740641443703345101,
        insert_person_name: '王晓岚',
        insert_time: '2025-12-02 16:18:11',
      },
    },
  ],
  [altTableDesignKey]: [
    {
      row_key: { id: 1 },
      values: {
        id: 1,
        supplier_name: '成都明悦科技',
        score: 93.5,
      },
    },
  ],
}

const databasesByProfile: Record<string, DatabaseEntry[]> = {
  'mock-prod-srm': [
    { name: 'cd_biz_bq', table_count: 12 },
    { name: 'cd_biz_brace', table_count: 9 },
    { name: 'cd_biz_idr', table_count: 11 },
    { name: 'cd_biz_open_eval', table_count: 14 },
    { name: 'cd_biz_srm', table_count: 18 },
  ],
  'mock-test-srm': [
    { name: 'cd_biz_srm', table_count: 7 },
    { name: 'cd_biz_open_eval', table_count: 5 },
  ],
}

const tablesByDatabase: Record<string, TableEntry[]> = {
  'mock-prod-srm:cd_biz_srm': [
    { name: 'performance_assess', table_rows: 2, column_count: 6 },
    { name: 'performance_assess_supplier', table_rows: 1, column_count: 3 },
    { name: 'rule_category', table_rows: 8, column_count: 5 },
    { name: 'rule_category_assess', table_rows: 4, column_count: 7 },
  ],
  'mock-test-srm:cd_biz_srm': [
    { name: 'performance_assess', table_rows: 2, column_count: 6 },
  ],
}

function buildColumn(
  name: string,
  dataType: string,
  length: number | null,
  scale: number | null,
  nullable: boolean,
  primaryKey: boolean,
  autoIncrement: boolean,
  defaultValue: string | null,
  comment: string,
  ordinal: number,
): TableColumn {
  const fullDataType =
    length == null
      ? dataType
      : scale == null
        ? `${dataType}(${length})`
        : `${dataType}(${length},${scale})`

  return {
    name,
    data_type: dataType,
    full_data_type: fullDataType,
    length,
    scale,
    nullable,
    primary_key: primaryKey,
    auto_increment: autoIncrement,
    default_value: defaultValue,
    comment,
    ordinal_position: ordinal,
  }
}

function buildTableKey(identity: TableIdentity) {
  return `${identity.profile_id}:${identity.database_name}:${identity.table_name}`
}

export const mockApi = {
  async getAppBootstrap(): Promise<AppBootstrap> {
    return {
      app_name: 'ZSZC SQL Client',
      storage_engine: 'sqlite',
      app_data_dir: '/mock/zszc-sql-client',
      connection_profiles: connectionProfiles,
    }
  },

  async saveConnectionProfile(
    payload: SaveConnectionProfilePayload,
  ): Promise<ConnectionProfile> {
    const profile: ConnectionProfile = {
      id: payload.id ?? `mock-${Date.now()}`,
      group_name: payload.group_name ?? null,
      data_source_name: payload.data_source_name,
      host: payload.host,
      port: payload.port,
      username: payload.username,
      password: payload.password,
      created_at: now,
      updated_at: now,
    }

    const existingIndex = connectionProfiles.findIndex((item) => item.id === profile.id)
    if (existingIndex >= 0) {
      connectionProfiles = connectionProfiles.map((item) =>
        item.id === profile.id ? profile : item,
      )
    } else {
      connectionProfiles = [...connectionProfiles, profile]
      databasesByProfile[profile.id] = []
    }

    return profile
  },

  async deleteConnectionProfile(profileId: string) {
    connectionProfiles = connectionProfiles.filter((item) => item.id !== profileId)
  },

  async testConnectionProfile(): Promise<ConnectionTestResult> {
    return {
      server_version: '8.0.36-mock',
      current_database: 'cd_biz_srm',
    }
  },

  async disconnectConnectionProfile() {
    return
  },

  async listProfileDatabases(profileId: string): Promise<DatabaseEntry[]> {
    return databasesByProfile[profileId] ?? []
  },

  async createDatabase(payload: CreateDatabasePayload): Promise<MutationResult> {
    const databaseName = payload.database_name.trim()
    databasesByProfile[payload.profile_id] = [
      ...(databasesByProfile[payload.profile_id] ?? []),
      { name: databaseName, table_count: 0 },
    ]
    tablesByDatabase[`${payload.profile_id}:${databaseName}`] = []

    return {
      affected_rows: 1,
      statements: [`CREATE DATABASE \`${databaseName}\`;`],
    }
  },

  async listDatabaseTables(profileId: string, databaseName: string): Promise<TableEntry[]> {
    return tablesByDatabase[`${profileId}:${databaseName}`] ?? []
  },

  async listTableColumns(payload: TableIdentity): Promise<TableColumnSummary[]> {
    const design = tableDesigns[buildTableKey(payload)]
    return (
      design?.columns.map((column) => ({
        name: column.name,
        data_type: column.full_data_type,
      })) ?? []
    )
  },

  async loadTableDesign(payload: TableIdentity): Promise<TableDesign> {
    const key = buildTableKey(payload)
    return structuredClone(tableDesigns[key])
  },

  async previewTableDesignSql(
    payload: TableDesignMutationPayload,
  ): Promise<SqlPreview> {
    const current = tableDesigns[buildTableKey(payload)]
    if (!current) {
      return { statements: [] }
    }

    if (JSON.stringify(current.columns) === JSON.stringify(payload.columns)) {
      return { statements: [] }
    }

    return {
      statements: [
        `ALTER TABLE \`${payload.database_name}\`.\`${payload.table_name}\` /* mock preview */;`,
      ],
    }
  },

  async previewCreateTableSql(payload: CreateTablePayload): Promise<SqlPreview> {
    return {
      statements: [generateMockDdl(payload.database_name, payload.table_name, payload.columns)],
    }
  },

  async applyTableDesignChanges(
    payload: TableDesignMutationPayload,
  ): Promise<MutationResult> {
    const key = buildTableKey(payload)
    tableDesigns[key] = {
      ...tableDesigns[key],
      columns: payload.columns.map((column, index) => ({
        ...column,
        ordinal_position: index + 1,
      })),
      ddl: generateMockDdl(payload.database_name, payload.table_name, payload.columns),
    }

    return {
      affected_rows: 1,
      statements: [
        `ALTER TABLE \`${payload.database_name}\`.\`${payload.table_name}\` /* mock apply */;`,
      ],
    }
  },

  async createTable(payload: CreateTablePayload): Promise<MutationResult> {
    const key = buildTableKey(payload)
    tableDesigns[key] = {
      profile_id: payload.profile_id,
      database_name: payload.database_name,
      table_name: payload.table_name,
      ddl: generateMockDdl(payload.database_name, payload.table_name, payload.columns),
      columns: payload.columns.map((column, index) => ({
        ...column,
        ordinal_position: index + 1,
      })),
    }
    tableRows[key] = []
    const tableKey = `${payload.profile_id}:${payload.database_name}`
    tablesByDatabase[tableKey] = [
      ...(tablesByDatabase[tableKey] ?? []),
      { name: payload.table_name, table_rows: 0, column_count: payload.columns.length },
    ]
    const database = (databasesByProfile[payload.profile_id] ?? []).find(
      (item) => item.name === payload.database_name,
    )
    if (database) {
      database.table_count += 1
    }

    return {
      affected_rows: 1,
      statements: [generateMockDdl(payload.database_name, payload.table_name, payload.columns)],
    }
  },

  async getTableDdl(payload: TableIdentity): Promise<TableDdl> {
    return {
      ddl: tableDesigns[buildTableKey(payload)]?.ddl ?? '-- mock ddl unavailable',
    }
  },

  async loadTableData(payload: LoadTableDataPayload): Promise<TableDataPage> {
    const key = buildTableKey(payload)
    const design = tableDesigns[key]
    const rows = tableRows[key] ?? []
    const offset = payload.offset ?? 0
    const limit = payload.limit ?? 100

    return {
      profile_id: payload.profile_id,
      database_name: payload.database_name,
      table_name: payload.table_name,
      columns: design.columns.map((column) => ({
        name: column.name,
        data_type: column.full_data_type,
        nullable: column.nullable,
        primary_key: column.primary_key,
        auto_increment: column.auto_increment,
        default_value: column.default_value,
        comment: column.comment,
      })),
      rows: structuredClone(rows.slice(offset, offset + limit)),
      primary_keys: design.columns
        .filter((column) => column.primary_key)
        .map((column) => column.name),
      offset,
      limit,
      total_rows: rows.length,
      editable: true,
    }
  },

  async previewTableDataChanges(
    payload: ApplyTableDataChangesPayload,
  ): Promise<SqlPreview> {
    return {
      statements: buildMockMutationStatements(payload),
    }
  },

  async applyTableDataChanges(
    payload: ApplyTableDataChangesPayload,
  ): Promise<MutationResult> {
    const key = buildTableKey(payload)
    const design = tableDesigns[key]
    const primaryKey = design.columns.find((column) => column.primary_key)?.name ?? 'id'
    let rows = structuredClone(tableRows[key] ?? [])

    payload.deleted_rows.forEach((deletedRow) => {
      rows = rows.filter(
        (row) => row.row_key?.[primaryKey] !== deletedRow.row_key[primaryKey],
      )
    })

    payload.updated_rows.forEach((updatedRow) => {
      rows = rows.map((row) =>
        row.row_key?.[primaryKey] === updatedRow.row_key[primaryKey]
          ? {
              row_key: updatedRow.row_key,
              values: updatedRow.values,
            }
          : row,
      )
    })

    payload.inserted_rows.forEach((insertedRow, index) => {
      const nextId = Date.now() + index
      const values: JsonRecord = { ...insertedRow.values }
      if (values[primaryKey] == null) {
        values[primaryKey] = nextId
      }
      rows = [
        ...rows,
        {
          row_key: { [primaryKey]: values[primaryKey] },
          values,
        },
      ]
    })

    tableRows[key] = rows
    const tableEntryKey = `${payload.profile_id}:${payload.database_name}`
    const targetTable = tablesByDatabase[tableEntryKey]?.find(
      (table) => table.name === payload.table_name,
    )
    if (targetTable) {
      targetTable.table_rows = rows.length
    }

    return {
      affected_rows:
        payload.deleted_rows.length +
        payload.updated_rows.length +
        payload.inserted_rows.length,
      statements: buildMockMutationStatements(payload),
    }
  },

  async executeSql(payload: ExecuteSqlPayload): Promise<SqlConsoleResult> {
    const sql = payload.sql.trim().replace(/[;；]+$/g, '')
    const limit = Math.min(Math.max(payload.limit ?? 200, 1), 500)
    const offset = Math.max(payload.offset ?? 0, 0)
    if (!sql) {
      throw new Error('SQL 不能为空')
    }

    if (/^(select|show|desc|describe|explain|with)\b/i.test(sql)) {
      const totalRows = 1344
      const visibleCount = Math.max(Math.min(limit, totalRows - offset), 0)
      const rows = Array.from({ length: visibleCount }, (_, index) => {
        const rowNumber = offset + index + 1
        return {
          row_key: null,
          values: {
            row_no: rowNumber,
            database_name: payload.database_name ?? '<none>',
            sql_preview: sql,
          },
        }
      })
      const columns = ['row_no', 'database_name', 'sql_preview'].map((name) => ({
        name,
        data_type: 'varchar',
        nullable: true,
        primary_key: false,
        auto_increment: false,
        default_value: null,
        comment: '',
      }))

      return {
        profile_id: payload.profile_id,
        database_name: payload.database_name ?? null,
        executed_sql: sql,
        result_kind: 'query',
        columns,
        rows,
        affected_rows: 0,
        offset,
        limit,
        total_rows: totalRows,
        truncated: false,
        message: 'Mock 模式下已返回示例查询结果。',
      }
    }

    return {
      profile_id: payload.profile_id,
      database_name: payload.database_name ?? null,
      executed_sql: sql,
      result_kind: 'mutation',
      columns: [],
      rows: [],
      affected_rows: 1,
      offset: 0,
      limit,
      total_rows: 0,
      truncated: false,
      message: 'Mock 模式下语句已执行。',
    }
  },
}

function generateMockDdl(
  databaseName: string,
  tableName: string,
  columns: TableColumn[],
) {
  const columnSql = columns
    .map((column) => {
      const fragments = [`\`${column.name}\` ${column.full_data_type}`]
      fragments.push(column.nullable ? 'NULL' : 'NOT NULL')
      if (column.default_value != null && column.default_value !== '') {
        fragments.push(`DEFAULT ${column.default_value}`)
      }
      if (column.auto_increment) {
        fragments.push('AUTO_INCREMENT')
      }
      if (column.comment) {
        fragments.push(`COMMENT '${column.comment}'`)
      }
      return `  ${fragments.join(' ')}`
    })
    .join(',\n')
  const primaryKeys = columns.filter((column) => column.primary_key)

  const primaryKeySql =
    primaryKeys.length > 0
      ? `,\n  PRIMARY KEY (${primaryKeys
          .map((column) => `\`${column.name}\``)
          .join(', ')})`
      : ''

  return `CREATE TABLE \`${databaseName}\`.\`${tableName}\` (\n${columnSql}${primaryKeySql}\n);`
}

function buildMockMutationStatements(payload: ApplyTableDataChangesPayload) {
  return [
    ...payload.deleted_rows.map(
      (row) =>
        `DELETE FROM \`${payload.database_name}\`.\`${payload.table_name}\` WHERE ${Object.entries(
          row.row_key,
        )
          .map(([key, value]) => `\`${key}\` = ${renderValue(value)}`)
          .join(' AND ')};`,
    ),
    ...payload.updated_rows.map(
      (row) =>
        `UPDATE \`${payload.database_name}\`.\`${payload.table_name}\` SET ${Object.entries(
          row.values,
        )
          .map(([key, value]) => `\`${key}\` = ${renderValue(value)}`)
          .join(', ')} WHERE ${Object.entries(row.row_key)
          .map(([key, value]) => `\`${key}\` = ${renderValue(value)}`)
          .join(' AND ')};`,
    ),
    ...payload.inserted_rows.map(
      (row) =>
        `INSERT INTO \`${payload.database_name}\`.\`${payload.table_name}\` (${Object.keys(
          row.values,
        )
          .map((key) => `\`${key}\``)
          .join(', ')}) VALUES (${Object.values(row.values)
          .map((value) => renderValue(value))
          .join(', ')});`,
    ),
  ]
}

function renderValue(value: unknown) {
  if (value == null) {
    return 'NULL'
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return `'${String(value).replaceAll("'", "\\'")}'`
}

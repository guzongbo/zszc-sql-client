import type {
  AssignProfilesToDataSourceGroupPayload,
  AssignProfilesToDataSourceGroupResult,
  AppBootstrap,
  ApplyTableDataChangesPayload,
  ChooseFilePayload,
  CompareDetailPageRequest,
  CompareDetailPageResponse,
  CompareHistoryInput,
  CompareHistoryItem,
  CompareHistoryPerformance,
  CompareHistorySummary,
  CompareTableDiscoveryRequest,
  CompareTableDiscoveryResponse,
  CompareTaskCancelResponse,
  CompareTaskProgressResponse,
  CompareTaskResultResponse,
  CompareTaskStartResponse,
  ConnectionProfile,
  ConnectionTestResult,
  CreateDataSourceGroupPayload,
  CreateDatabasePayload,
  CreateTablePayload,
  DataCompareRequest,
  DataCompareResponse,
  DatabaseEntry,
  DataSourceGroup,
  DeleteDataSourceGroupResult,
  ExecuteSqlPayload,
  ExportDataFileResponse,
  ExportQueryResultFileRequest,
  ExportQueryResultSqlTextRequest,
  ExportSqlFileRequest,
  ExportSqlFileResponse,
  ExportSqlTextResponse,
  ExportTableDataFileRequest,
  ExportTableDataSqlTextRequest,
  ImportConnectionProfilesResult,
  JsonRecord,
  LoadSqlAutocompletePayload,
  LoadTableDataPayload,
  MutationResult,
  RedisConnectionProfile,
  RedisConnectionTestResult,
  RedisDeleteHashFieldPayload,
  RedisHashEntry,
  RedisHashFieldPayload,
  RedisKeyDetail,
  RedisKeyDetailRequest,
  RedisKeyIdentity,
  RedisKeySummary,
  RedisListItem,
  RedisRenameKeyPayload,
  RedisScanKeysRequest,
  RedisScanKeysResponse,
  RedisSetKeyTtlPayload,
  RedisStreamEntry,
  RedisStringValuePayload,
  RedisZSetEntry,
  RenameDataSourceGroupPayload,
  RenameDataSourceGroupResult,
  RowSample,
  SaveConnectionProfilePayload,
  SaveRedisConnectionPayload,
  SaveFileDialogResult,
  SqlAutocompleteSchema,
  SqlConsoleResult,
  SqlPreview,
  StructureCompareDetailRequest,
  StructureCompareDetailResponse,
  StructureCompareRequest,
  StructureCompareResponse,
  StructureCompareTaskResultResponse,
  StructureExportSqlFileRequest,
  StructureExportSqlFileResponse,
  StructureTableItem,
  TableColumn,
  TableCompareResult,
  TableColumnSummary,
  TableDataPage,
  TableDataRow,
  TableDesign,
  TableDesignMutationPayload,
  TableDdl,
  TableEntry,
  TableIdentity,
  UpdateSample,
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

type MockRedisKeyRecord = {
  type_name: string
  ttl_seconds: number | null
  string_value?: string
  hash_entries?: RedisHashEntry[]
  list_items?: string[]
  set_members?: string[]
  zset_entries?: RedisZSetEntry[]
  stream_entries?: RedisStreamEntry[]
}

let redisConnectionProfiles: RedisConnectionProfile[] = [
  {
    id: 'mock-redis-local',
    group_name: null,
    connection_name: '本地 Redis',
    host: '127.0.0.1',
    port: 6379,
    username: '',
    password: '',
    database_index: 0,
    connect_timeout_ms: 5000,
    created_at: now,
    updated_at: now,
  },
]

const mockRedisData: Record<string, Record<number, Record<string, MockRedisKeyRecord>>> = {
  'mock-redis-local': {
    0: {
      'app:config': {
        type_name: 'string',
        ttl_seconds: null,
        string_value: JSON.stringify(
          {
            app_name: 'zszc-sql-client',
            env: 'local',
            feature: 'redis_workspace',
          },
          null,
          2,
        ),
      },
      'user:1001': {
        type_name: 'hash',
        ttl_seconds: 86400,
        hash_entries: [
          { field: 'name', value: '张三' },
          { field: 'role', value: 'admin' },
          { field: 'last_login', value: '2026-04-11 09:30:00' },
        ],
      },
      'queue:mail': {
        type_name: 'list',
        ttl_seconds: null,
        list_items: ['mail-job-1001', 'mail-job-1002', 'mail-job-1003'],
      },
      'feature:flags': {
        type_name: 'set',
        ttl_seconds: null,
        set_members: ['sql_console', 'table_data', 'redis_workspace'],
      },
      'rank:hot_keys': {
        type_name: 'zset',
        ttl_seconds: null,
        zset_entries: [
          { member: 'app:config', score: 98.2 },
          { member: 'user:1001', score: 74.5 },
          { member: 'queue:mail', score: 63 },
        ],
      },
      'stream:audit': {
        type_name: 'stream',
        ttl_seconds: null,
        stream_entries: [
          {
            entry_id: '1760000000000-0',
            fields: [
              { field: 'event', value: 'connect' },
              { field: 'user', value: 'local' },
            ],
          },
          {
            entry_id: '1760000005000-0',
            fields: [
              { field: 'event', value: 'scan' },
              { field: 'pattern', value: '*' },
            ],
          },
        ],
      },
    },
  },
}

let dataSourceGroups: DataSourceGroup[] = [
  {
    id: 'mock-group-framework',
    group_name: '框架协议',
    created_at: now,
    updated_at: now,
  },
]

const tableDesignKey = 'mock-prod-srm:cd_biz_srm:performance_assess'
const altTableDesignKey = 'mock-prod-srm:cd_biz_srm:performance_assess_supplier'
const testTableDesignKey = 'mock-test-srm:cd_biz_srm:performance_assess'

const tableDesigns: Record<string, TableDesign> = {
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
  [testTableDesignKey]: {
    profile_id: 'mock-test-srm',
    database_name: 'cd_biz_srm',
    table_name: 'performance_assess',
    ddl: `CREATE TABLE \`performance_assess\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  \`assess_name\` varchar(64) NOT NULL COMMENT '评价名称',
  \`assess_type\` tinyint(3) NOT NULL DEFAULT '2' COMMENT '评价类型',
  \`insert_person_id\` bigint NOT NULL COMMENT '创建人ID',
  \`insert_person_name\` varchar(64) NOT NULL COMMENT '创建人姓名',
  \`insert_time\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  \`extra_flag\` varchar(16) DEFAULT NULL COMMENT '额外标识',
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='绩效考核';`,
    columns: [
      buildColumn('id', 'bigint', 20, null, false, true, true, null, '主键ID', 1),
      buildColumn('assess_name', 'varchar', 64, null, false, false, false, null, '评价名称', 2),
      buildColumn('assess_type', 'tinyint', 3, 0, false, false, false, '2', '评价类型', 3),
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
      buildColumn('extra_flag', 'varchar', 16, null, true, false, false, null, '额外标识', 7),
    ],
  },
}

const tableRows: Record<string, TableDataRow[]> = {
  [tableDesignKey]: [
    {
      row_key: { id: 1991418341324681 },
      values: {
        id: 1991418341324681,
        assess_name: '年度评价',
        assess_type: 3,
        insert_person_id: 1740641443703345,
        insert_person_name: '钟远和',
        insert_time: '2025-11-20 10:24:30',
      },
    },
    {
      row_key: { id: 1991418341324682 },
      values: {
        id: 1991418341324682,
        assess_name: '季度评价',
        assess_type: 2,
        insert_person_id: 1740641443703346,
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
  [testTableDesignKey]: [
    {
      row_key: { id: 1991418341324681 },
      values: {
        id: 1991418341324681,
        assess_name: '年度评价',
        assess_type: 2,
        insert_person_id: 1740641443703345,
        insert_person_name: '钟远和',
        insert_time: '2025-11-20 10:24:30',
        extra_flag: 'legacy',
      },
    },
    {
      row_key: { id: 1991418341324683 },
      values: {
        id: 1991418341324683,
        assess_name: '半年度评价',
        assess_type: 1,
        insert_person_id: 1740641443703347,
        insert_person_name: '陈初雪',
        insert_time: '2025-12-08 08:12:45',
        extra_flag: 'stale',
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

let compareHistoryItems: CompareHistoryItem[] = []

function buildCompareHistorySummary(item: CompareHistoryItem): CompareHistorySummary {
  return {
    id: item.id,
    history_type: item.history_type,
    source_profile_id: item.source_profile_id,
    source_data_source_name: item.source_data_source_name,
    source_database: item.source_database,
    target_profile_id: item.target_profile_id,
    target_data_source_name: item.target_data_source_name,
    target_database: item.target_database,
    table_mode: item.table_mode,
    source_table_count: item.source_table_count,
    target_table_count: item.target_table_count,
    total_tables: item.total_tables,
    compared_tables: item.compared_tables,
    insert_count: item.insert_count,
    update_count: item.update_count,
    delete_count: item.delete_count,
    structure_added_count: item.structure_added_count,
    structure_modified_count: item.structure_modified_count,
    structure_deleted_count: item.structure_deleted_count,
    total_elapsed_ms: item.performance.total_elapsed_ms,
    created_at: item.created_at,
  }
}
let compareTaskCounter = 0
const compareTaskResults = new Map<string, DataCompareResponse>()
let structureCompareTaskCounter = 0
const structureCompareTaskResults = new Map<string, StructureCompareResponse>()

function sanitizeMockConnectionProfile(profile: ConnectionProfile): ConnectionProfile {
  return {
    ...profile,
    password: '',
  }
}

function sanitizeMockRedisConnectionProfile(
  profile: RedisConnectionProfile,
): RedisConnectionProfile {
  return {
    ...profile,
    password: '',
  }
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

function buildCompareTableKey(
  profileId: string,
  databaseName: string,
  tableName: string,
) {
  return `${profileId}:${databaseName}:${tableName}`
}

function normalizeCompareTableMode(
  tableMode: string,
): 'all' | 'selected' {
  return tableMode === 'selected' ? 'selected' : 'all'
}

function toComparableRow(
  row: TableDataRow,
  columns: string[],
): JsonRecord {
  if (columns.length === 0) {
    return { ...row.values }
  }

  return columns.reduce<JsonRecord>((accumulator, column) => {
    accumulator[column] = row.values[column] ?? null
    return accumulator
  }, {})
}

function stringifyRecord(record: JsonRecord) {
  return JSON.stringify(record)
}

function getComparePreviewLimit(payload: DataCompareRequest) {
  return Math.min(Math.max(payload.preview_limit ?? 20, 1), 100)
}

function discoverCommonTables(
  payload: CompareTableDiscoveryRequest,
): CompareTableDiscoveryResponse {
  const sourceTables =
    tablesByDatabase[`${payload.source_profile_id}:${payload.source_database_name}`]?.map(
      (table) => table.name,
    ) ?? []
  const targetTables =
    tablesByDatabase[`${payload.target_profile_id}:${payload.target_database_name}`]?.map(
      (table) => table.name,
    ) ?? []
  const targetSet = new Set(targetTables)

  return {
    source_tables: sourceTables,
    target_tables: targetTables,
    common_tables: sourceTables.filter((table) => targetSet.has(table)),
  }
}

function compareSingleTable(
  payload: DataCompareRequest,
  tableName: string,
  collectFullDetails = false,
) {
  const sourceDesign =
    tableDesigns[buildCompareTableKey(payload.source_profile_id, payload.source_database_name, tableName)]
  const targetDesign =
    tableDesigns[buildCompareTableKey(payload.target_profile_id, payload.target_database_name, tableName)]
  if (!sourceDesign || !targetDesign) {
    throw new Error(`表 ${tableName} 在 mock 数据中不存在`)
  }

  const sourceColumns = sourceDesign.columns.map((column) => column.name)
  const targetColumns = new Set(targetDesign.columns.map((column) => column.name))
  const comparedColumns = sourceColumns.filter((column) => targetColumns.has(column))
  const sourcePrimaryKeys = sourceDesign.columns
    .filter((column) => column.primary_key)
    .map((column) => column.name)
  const targetPrimaryKeys = targetDesign.columns
    .filter((column) => column.primary_key)
    .map((column) => column.name)
  const keyedMode =
    sourcePrimaryKeys.length > 0 &&
    sourcePrimaryKeys.join(',') === targetPrimaryKeys.join(',')
  const warnings: string[] = []

  const sourceMissingColumns = sourceColumns.filter((column) => !targetColumns.has(column))
  if (sourceMissingColumns.length > 0) {
    warnings.push(`目标表缺少字段: ${sourceMissingColumns.join(', ')}`)
  }
  const targetMissingColumns = targetDesign.columns
    .map((column) => column.name)
    .filter((column) => !new Set(sourceColumns).has(column))
  if (targetMissingColumns.length > 0) {
    warnings.push(`源表缺少字段: ${targetMissingColumns.join(', ')}`)
  }
  if (!keyedMode) {
    warnings.push('当前表未满足同主键比较条件，更新项将不单独识别。')
  }

  const previewLimit = getComparePreviewLimit(payload)
  const sourceRows =
    tableRows[buildCompareTableKey(payload.source_profile_id, payload.source_database_name, tableName)] ??
    []
  const targetRows =
    tableRows[buildCompareTableKey(payload.target_profile_id, payload.target_database_name, tableName)] ??
    []

  const sampleInserts: RowSample[] = []
  const sampleUpdates: UpdateSample[] = []
  const sampleDeletes: RowSample[] = []
  const allInserts: RowSample[] = []
  const allUpdates: UpdateSample[] = []
  const allDeletes: RowSample[] = []

  if (keyedMode) {
    const buildKey = (row: TableDataRow) =>
      stringifyRecord(
        sourcePrimaryKeys.reduce<JsonRecord>((accumulator, key) => {
          accumulator[key] = row.values[key] ?? null
          return accumulator
        }, {}),
      )

    const sourceMap = new Map(sourceRows.map((row) => [buildKey(row), row]))
    const targetMap = new Map(targetRows.map((row) => [buildKey(row), row]))

    sourceMap.forEach((sourceRow, signature) => {
      const targetRow = targetMap.get(signature)
      if (!targetRow) {
        const sample = { signature, row: { ...sourceRow.values } }
        allInserts.push(sample)
        if (sampleInserts.length < previewLimit) {
          sampleInserts.push(sample)
        }
        return
      }

      const diffColumns = comparedColumns.filter(
        (column) => sourceRow.values[column] !== targetRow.values[column],
      )
      if (diffColumns.length === 0) {
        return
      }

      const update: UpdateSample = {
        signature,
        key: sourcePrimaryKeys.reduce<JsonRecord>((accumulator, key) => {
          accumulator[key] = sourceRow.values[key] ?? null
          return accumulator
        }, {}),
        source_row: { ...sourceRow.values },
        target_row: { ...targetRow.values },
        diff_columns: diffColumns,
      }
      allUpdates.push(update)
      if (sampleUpdates.length < previewLimit) {
        sampleUpdates.push(update)
      }
    })

    targetMap.forEach((targetRow, signature) => {
      if (sourceMap.has(signature)) {
        return
      }
      const sample = { signature, row: { ...targetRow.values } }
      allDeletes.push(sample)
      if (sampleDeletes.length < previewLimit) {
        sampleDeletes.push(sample)
      }
    })
  } else {
    const signatureColumns = comparedColumns.length > 0 ? comparedColumns : sourceColumns
    const sourceMultiSet = new Map<string, JsonRecord[]>()
    const targetMultiSet = new Map<string, JsonRecord[]>()
    sourceRows.forEach((row) => {
      const comparable = toComparableRow(row, signatureColumns)
      const signature = stringifyRecord(comparable)
      sourceMultiSet.set(signature, [...(sourceMultiSet.get(signature) ?? []), { ...row.values }])
    })
    targetRows.forEach((row) => {
      const comparable = toComparableRow(row, signatureColumns)
      const signature = stringifyRecord(comparable)
      targetMultiSet.set(signature, [...(targetMultiSet.get(signature) ?? []), { ...row.values }])
    })

    sourceMultiSet.forEach((rows, signature) => {
      const targetCount = targetMultiSet.get(signature)?.length ?? 0
      rows.slice(targetCount).forEach((row) => {
        const sample = { signature, row }
        allInserts.push(sample)
        if (sampleInserts.length < previewLimit) {
          sampleInserts.push(sample)
        }
      })
    })

    targetMultiSet.forEach((rows, signature) => {
      const sourceCount = sourceMultiSet.get(signature)?.length ?? 0
      rows.slice(sourceCount).forEach((row) => {
        const sample = { signature, row }
        allDeletes.push(sample)
        if (sampleDeletes.length < previewLimit) {
          sampleDeletes.push(sample)
        }
      })
    })
  }

  const result: TableCompareResult = {
    source_table: tableName,
    target_table: tableName,
    key_columns: keyedMode ? sourcePrimaryKeys : [],
    compared_columns: comparedColumns,
    compare_mode: keyedMode ? 'keyed' : 'full_row',
    insert_count: allInserts.length,
    update_count: allUpdates.length,
    delete_count: allDeletes.length,
    warnings,
    sample_inserts: sampleInserts,
    sample_updates: sampleUpdates,
    sample_deletes: sampleDeletes,
  }

  return {
    result,
    inserts: collectFullDetails ? allInserts : [],
    updates: collectFullDetails ? allUpdates : [],
    deletes: collectFullDetails ? allDeletes : [],
  }
}

function buildDataCompareResponse(
  payload: DataCompareRequest,
): DataCompareResponse {
  const discovery = discoverCommonTables({
    source_profile_id: payload.source_profile_id,
    source_database_name: payload.source_database_name,
    target_profile_id: payload.target_profile_id,
    target_database_name: payload.target_database_name,
  })
  const tableMode = normalizeCompareTableMode(payload.table_mode)
  const selectedTables =
    tableMode === 'selected' ? payload.selected_tables : discovery.common_tables
  const commonSet = new Set(discovery.common_tables)
  const tableResults = selectedTables
    .filter((tableName) => commonSet.has(tableName))
    .map((tableName) => compareSingleTable(payload, tableName).result)
  const skippedTables = selectedTables
    .filter((tableName) => !commonSet.has(tableName))
    .map((tableName) => ({
      source_table: tableName,
      target_table: tableName,
      reason: '源库与目标库不存在同名表',
    }))

  return {
    compare_id: null,
    summary: {
      total_tables: tableResults.length,
      compared_tables: tableResults.length,
      skipped_tables: skippedTables.length,
      total_insert_count: tableResults.reduce((sum, item) => sum + item.insert_count, 0),
      total_update_count: tableResults.reduce((sum, item) => sum + item.update_count, 0),
      total_delete_count: tableResults.reduce((sum, item) => sum + item.delete_count, 0),
      total_sql_statements: tableResults.reduce(
        (sum, item) => sum + item.insert_count + item.update_count + item.delete_count,
        0,
      ),
    },
    skipped_tables: skippedTables,
    table_results: tableResults,
    performance: buildMockPerformance('数据对比', tableResults.length),
  }
}

function buildDataCompareDetailPage(
  payload: CompareDetailPageRequest,
): CompareDetailPageResponse {
  const tableDetail = compareSingleTable(payload.compare_request, payload.source_table, true)
  const limit = Math.min(Math.max(payload.limit ?? 50, 1), 500)
  const offset = Math.max(payload.offset ?? 0, 0)
  if (payload.detail_type === 'update') {
    const updateItems = tableDetail.updates.slice(offset, offset + limit)
    return {
      source_table: payload.source_table,
      target_table: payload.target_table,
      detail_type: payload.detail_type,
      total: tableDetail.updates.length,
      offset,
      limit,
      has_more: offset + limit < tableDetail.updates.length,
      row_columns: tableDetail.result.compared_columns,
      row_items: [],
      update_items: updateItems,
    }
  }

  const rows = payload.detail_type === 'insert' ? tableDetail.inserts : tableDetail.deletes
  return {
    source_table: payload.source_table,
    target_table: payload.target_table,
    detail_type: payload.detail_type,
    total: rows.length,
    offset,
    limit,
    has_more: offset + limit < rows.length,
    row_columns: tableDetail.result.compared_columns,
    row_items: rows.slice(offset, offset + limit),
    update_items: [],
  }
}

function buildStructureCompareResponse(
  payload: StructureCompareRequest,
): StructureCompareResponse {
  const discovery = discoverCommonTables({
    source_profile_id: payload.source_profile_id,
    source_database_name: payload.source_database_name,
    target_profile_id: payload.target_profile_id,
    target_database_name: payload.target_database_name,
  })
  const sourceTables = discovery.source_tables
  const targetTables = discovery.target_tables
  const sourceSet = new Set(sourceTables)
  const targetSet = new Set(targetTables)
  const addedTables = sourceTables
    .filter((tableName) => !targetSet.has(tableName))
    .map((tableName) => buildStructureTableItem(tableName))
  const deletedTables = targetTables
    .filter((tableName) => !sourceSet.has(tableName))
    .map((tableName) => buildStructureTableItem(tableName))
  const modifiedTables = discovery.common_tables
    .filter((tableName) => {
      const sourceDesign =
        tableDesigns[buildCompareTableKey(payload.source_profile_id, payload.source_database_name, tableName)]
      const targetDesign =
        tableDesigns[buildCompareTableKey(payload.target_profile_id, payload.target_database_name, tableName)]
      return sourceDesign?.ddl !== targetDesign?.ddl
    })
    .map((tableName) => buildStructureTableItem(tableName))

  return {
    summary: {
      source_table_count: sourceTables.length,
      target_table_count: targetTables.length,
      added_table_count: addedTables.length,
      modified_table_count: modifiedTables.length,
      deleted_table_count: deletedTables.length,
    },
    added_tables: addedTables,
    modified_tables: modifiedTables,
    deleted_tables: deletedTables,
    performance: buildMockPerformance('结构对比', sourceTables.length + targetTables.length),
  }
}

function buildStructureTableItem(tableName: string): StructureTableItem {
  return {
    table_name: tableName,
    preview_sql: null,
    source_sql: null,
    target_sql: null,
    source_changed_lines: [],
    target_changed_lines: [],
    warnings: [],
  }
}

function buildStructureCompareDetailResponse(
  payload: StructureCompareDetailRequest,
): StructureCompareDetailResponse {
  const sourceDesign =
    tableDesigns[
      buildCompareTableKey(
        payload.compare_request.source_profile_id,
        payload.compare_request.source_database_name,
        payload.table_name,
      )
    ]
  const targetDesign =
    tableDesigns[
      buildCompareTableKey(
        payload.compare_request.target_profile_id,
        payload.compare_request.target_database_name,
        payload.table_name,
      )
    ]

  const detail: StructureTableItem = {
    table_name: payload.table_name,
    preview_sql:
      payload.category === 'added'
        ? sourceDesign?.ddl ?? null
        : payload.category === 'deleted'
          ? `DROP TABLE IF EXISTS \`${payload.compare_request.target_database_name}\`.\`${payload.table_name}\`;`
          : `ALTER TABLE \`${payload.compare_request.target_database_name}\`.\`${payload.table_name}\` /* mock sync preview */;`,
    source_sql: sourceDesign?.ddl ?? null,
    target_sql: targetDesign?.ddl ?? null,
    source_changed_lines: sourceDesign && targetDesign ? [2, 3] : [],
    target_changed_lines: sourceDesign && targetDesign ? [2, 7] : [],
    warnings:
      payload.category === 'modified'
        ? ['当前为 mock 结构详情，示例 SQL 仅用于 UI 演示。']
        : [],
  }

  return {
    category: payload.category,
    table_name: payload.table_name,
    detail,
    performance: buildMockPerformance('结构详情', 1),
  }
}

function buildMockPerformance(label: string, itemCount: number): CompareHistoryPerformance {
  return {
    total_elapsed_ms: 180 + itemCount * 24,
    stages: [
      {
        key: 'prepare',
        label: `${label}准备`,
        elapsed_ms: 60,
        item_count: itemCount,
        note: null,
      },
      {
        key: 'execute',
        label: `${label}执行`,
        elapsed_ms: 120 + itemCount * 24,
        item_count: itemCount,
        note: null,
      },
    ],
    max_parallelism: 1,
  }
}

export const mockApi = {
  async getAppBootstrap(): Promise<AppBootstrap> {
    return {
      app_name: 'ZSZC SQL Client',
      storage_engine: 'sqlite',
      app_data_dir: '/mock/zszc-sql-client',
      current_platform: 'darwin-aarch64',
      plugin_package_extension: 'zszc-plugin',
      installed_plugins: [],
      connection_profiles: connectionProfiles.map(sanitizeMockConnectionProfile),
      data_source_groups: sortDataSourceGroups(dataSourceGroups),
    }
  },

  async listRedisConnections(): Promise<RedisConnectionProfile[]> {
    return structuredClone(redisConnectionProfiles.map(sanitizeMockRedisConnectionProfile))
  },

  async saveRedisConnection(
    payload: SaveRedisConnectionPayload,
  ): Promise<RedisConnectionProfile> {
    const connectionName = payload.connection_name.trim()
    const host = payload.host.trim()
    if (!connectionName) {
      throw new Error('Redis 连接名称不能为空')
    }
    if (!host) {
      throw new Error('Redis 主机不能为空')
    }

    const groupName = payload.group_name?.trim() ? payload.group_name.trim() : null
    ensureMockGroupExists(groupName)
    const existing = payload.id
      ? redisConnectionProfiles.find((item) => item.id === payload.id)
      : null
    const profile: RedisConnectionProfile = {
      id: existing?.id ?? `mock-redis-${Date.now()}`,
      group_name: groupName,
      connection_name: connectionName,
      host,
      port: payload.port || 6379,
      username: payload.username.trim(),
      password: payload.password || existing?.password || '',
      database_index: payload.database_index,
      connect_timeout_ms: payload.connect_timeout_ms || 5000,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    }

    redisConnectionProfiles = existing
      ? redisConnectionProfiles.map((item) => (item.id === existing.id ? profile : item))
      : [...redisConnectionProfiles, profile]
    mockRedisData[profile.id] ??= { [profile.database_index]: {} }
    mockRedisData[profile.id][profile.database_index] ??= {}

    return structuredClone(sanitizeMockRedisConnectionProfile(profile))
  },

  async deleteRedisConnection(profileId: string): Promise<void> {
    redisConnectionProfiles = redisConnectionProfiles.filter((item) => item.id !== profileId)
    delete mockRedisData[profileId]
  },

  async testRedisConnection(
    payload: SaveRedisConnectionPayload,
  ): Promise<RedisConnectionTestResult> {
    if (!payload.connection_name.trim() || !payload.host.trim()) {
      throw new Error('Redis 连接名称和主机不能为空')
    }
    return {
      server_version: '7.2.4-mock',
      database_index: payload.database_index,
      key_count: Object.keys(
        mockRedisData[payload.id ?? 'mock-redis-local']?.[payload.database_index] ?? {},
      ).length,
    }
  },

  async connectRedis(profileId: string): Promise<RedisConnectionTestResult> {
    const profile = loadMockRedisProfile(profileId)
    return {
      server_version: '7.2.4-mock',
      database_index: profile.database_index,
      key_count: Object.keys(mockRedisDatabase(profile.id, profile.database_index)).length,
    }
  },

  async disconnectRedis(profileId: string): Promise<void> {
    void profileId
    return
  },

  async scanRedisKeys(payload: RedisScanKeysRequest): Promise<RedisScanKeysResponse> {
    const database = mockRedisDatabase(payload.profile_id, payload.database_index)
    const limit = Math.min(Math.max(payload.limit, 10), 500)
    const offset = Number.parseInt(payload.cursor, 10) || 0
    const typeFilter = payload.type_filter && payload.type_filter !== 'all'
      ? payload.type_filter
      : null
    const names = Object.keys(database)
      .sort((left, right) => left.localeCompare(right))
      .filter((keyName) => matchesRedisPattern(keyName, payload.pattern || '*'))
      .filter((keyName) => !typeFilter || database[keyName].type_name === typeFilter)
    const pageNames = names.slice(offset, offset + limit)
    const nextOffset = offset + pageNames.length
    const keys: RedisKeySummary[] = pageNames.map((keyName) => ({
      key_name: keyName,
      type_name: database[keyName].type_name,
      ttl_seconds: database[keyName].ttl_seconds,
    }))

    return {
      cursor: nextOffset < names.length ? String(nextOffset) : '0',
      keys,
      has_more: nextOffset < names.length,
    }
  },

  async getRedisKeyDetail(payload: RedisKeyDetailRequest): Promise<RedisKeyDetail> {
    const record = loadMockRedisKey(payload.profile_id, payload.database_index, payload.key_name)
    return buildMockRedisKeyDetail(payload, record)
  },

  async setRedisStringValue(payload: RedisStringValuePayload): Promise<MutationResult> {
    const database = mockRedisDatabase(payload.profile_id, payload.database_index)
    database[payload.key_name] = {
      type_name: 'string',
      ttl_seconds: database[payload.key_name]?.ttl_seconds ?? null,
      string_value: payload.value,
    }
    return { affected_rows: 1, statements: [`SET ${payload.key_name}`] }
  },

  async setRedisHashField(payload: RedisHashFieldPayload): Promise<MutationResult> {
    const database = mockRedisDatabase(payload.profile_id, payload.database_index)
    const record = database[payload.key_name] ?? {
      type_name: 'hash',
      ttl_seconds: null,
      hash_entries: [],
    }
    if (record.type_name !== 'hash') {
      throw new Error('当前 key 不是 hash 类型')
    }
    const entries = record.hash_entries ?? []
    const nextEntries = entries.some((item) => item.field === payload.field)
      ? entries.map((item) =>
          item.field === payload.field ? { ...item, value: payload.value } : item,
        )
      : [...entries, { field: payload.field, value: payload.value }]
    database[payload.key_name] = { ...record, hash_entries: nextEntries }
    return { affected_rows: 1, statements: [`HSET ${payload.key_name} ${payload.field}`] }
  },

  async deleteRedisHashField(
    payload: RedisDeleteHashFieldPayload,
  ): Promise<MutationResult> {
    const record = loadMockRedisKey(payload.profile_id, payload.database_index, payload.key_name)
    if (record.type_name !== 'hash') {
      throw new Error('当前 key 不是 hash 类型')
    }
    const previousCount = record.hash_entries?.length ?? 0
    record.hash_entries = (record.hash_entries ?? []).filter(
      (item) => item.field !== payload.field,
    )
    return {
      affected_rows: previousCount === record.hash_entries.length ? 0 : 1,
      statements: [`HDEL ${payload.key_name} ${payload.field}`],
    }
  },

  async deleteRedisKey(payload: RedisKeyIdentity): Promise<MutationResult> {
    const database = mockRedisDatabase(payload.profile_id, payload.database_index)
    const exists = payload.key_name in database
    delete database[payload.key_name]
    return { affected_rows: exists ? 1 : 0, statements: [`DEL ${payload.key_name}`] }
  },

  async renameRedisKey(payload: RedisRenameKeyPayload): Promise<MutationResult> {
    const database = mockRedisDatabase(payload.profile_id, payload.database_index)
    const record = loadMockRedisKey(payload.profile_id, payload.database_index, payload.key_name)
    database[payload.new_key_name] = record
    delete database[payload.key_name]
    return {
      affected_rows: 1,
      statements: [`RENAME ${payload.key_name} ${payload.new_key_name}`],
    }
  },

  async setRedisKeyTtl(payload: RedisSetKeyTtlPayload): Promise<MutationResult> {
    const record = loadMockRedisKey(payload.profile_id, payload.database_index, payload.key_name)
    record.ttl_seconds = payload.ttl_seconds ?? null
    return {
      affected_rows: 1,
      statements: [
        payload.ttl_seconds == null
          ? `PERSIST ${payload.key_name}`
          : `EXPIRE ${payload.key_name} ${payload.ttl_seconds}`,
      ],
    }
  },

  async createDataSourceGroup(
    payload: CreateDataSourceGroupPayload,
  ): Promise<DataSourceGroup> {
    const groupName = payload.group_name.trim()
    if (!groupName) {
      throw new Error('分组名称不能为空')
    }
    if (dataSourceGroups.some((item) => item.group_name === groupName)) {
      throw new Error('分组名称已存在')
    }

    const group: DataSourceGroup = {
      id: `mock-group-${Date.now()}`,
      group_name: groupName,
      created_at: now,
      updated_at: now,
    }
    dataSourceGroups = sortDataSourceGroups([...dataSourceGroups, group])
    return group
  },

  async renameDataSourceGroup(
    payload: RenameDataSourceGroupPayload,
  ): Promise<RenameDataSourceGroupResult> {
    const nextGroupName = payload.group_name.trim()
    if (!nextGroupName) {
      throw new Error('分组名称不能为空')
    }

    const currentGroup = dataSourceGroups.find((item) => item.id === payload.group_id)
    if (!currentGroup) {
      throw new Error('数据源分组不存在')
    }
    if (
      dataSourceGroups.some(
        (item) => item.id !== payload.group_id && item.group_name === nextGroupName,
      )
    ) {
      throw new Error('分组名称已存在')
    }

    const previousGroupName = currentGroup.group_name
    dataSourceGroups = sortDataSourceGroups(
      dataSourceGroups.map((item) =>
        item.id === payload.group_id
          ? { ...item, group_name: nextGroupName, updated_at: now }
          : item,
      ),
    )

    const affectedProfileCount =
      connectionProfiles.filter((item) => item.group_name === previousGroupName).length +
      redisConnectionProfiles.filter((item) => item.group_name === previousGroupName).length
    connectionProfiles = connectionProfiles.map((item) =>
      item.group_name === previousGroupName
        ? { ...item, group_name: nextGroupName, updated_at: now }
        : item,
    )
    redisConnectionProfiles = redisConnectionProfiles.map((item) =>
      item.group_name === previousGroupName
        ? { ...item, group_name: nextGroupName, updated_at: now }
        : item,
    )

    return {
      group_id: payload.group_id,
      previous_group_name: previousGroupName,
      group_name: nextGroupName,
      affected_profile_count: affectedProfileCount,
    }
  },

  async deleteDataSourceGroup(groupId: string): Promise<DeleteDataSourceGroupResult> {
    const currentGroup = dataSourceGroups.find((item) => item.id === groupId)
    if (!currentGroup) {
      throw new Error('数据源分组不存在')
    }

    dataSourceGroups = dataSourceGroups.filter((item) => item.id !== groupId)
    const affectedProfileCount =
      connectionProfiles.filter((item) => item.group_name === currentGroup.group_name).length +
      redisConnectionProfiles.filter((item) => item.group_name === currentGroup.group_name).length
    connectionProfiles = connectionProfiles.map((item) =>
      item.group_name === currentGroup.group_name
        ? { ...item, group_name: null, updated_at: now }
        : item,
    )
    redisConnectionProfiles = redisConnectionProfiles.map((item) =>
      item.group_name === currentGroup.group_name
        ? { ...item, group_name: null, updated_at: now }
        : item,
    )

    return {
      group_id: groupId,
      group_name: currentGroup.group_name,
      affected_profile_count: affectedProfileCount,
    }
  },

  async assignProfilesToDataSourceGroup(
    payload: AssignProfilesToDataSourceGroupPayload,
  ): Promise<AssignProfilesToDataSourceGroupResult> {
    const currentGroup = dataSourceGroups.find((item) => item.id === payload.group_id)
    if (!currentGroup) {
      throw new Error('数据源分组不存在')
    }

    const profileIdSet = new Set(payload.profile_ids)
    const affectedProfileCount = connectionProfiles.filter((item) =>
      profileIdSet.has(item.id),
    ).length
    connectionProfiles = connectionProfiles.map((item) =>
      profileIdSet.has(item.id)
        ? { ...item, group_name: currentGroup.group_name, updated_at: now }
        : item,
    )

    return {
      group_id: currentGroup.id,
      group_name: currentGroup.group_name,
      affected_profile_count: affectedProfileCount,
    }
  },

  async importNavicatConnectionProfiles(): Promise<ImportConnectionProfilesResult> {
    const profile: ConnectionProfile = {
      id: `mock-navicat-${Date.now()}`,
      group_name: 'Navicat 导入',
      data_source_name: 'Navicat-采购联调库',
      host: '10.20.9.18',
      port: 3306,
      username: 'navicat_user',
      password: '******',
      created_at: now,
      updated_at: now,
    }
    connectionProfiles = [...connectionProfiles, profile]
    ensureMockGroupExists(profile.group_name)
    databasesByProfile[profile.id] = [{ name: 'cd_biz_sync', table_count: 3 }]
    tablesByDatabase[`${profile.id}:cd_biz_sync`] = [
      { name: 'sync_job', table_rows: 12, column_count: 6 },
    ]

    return {
      canceled: false,
      file_path: '/mock/NavicatConnections.ncx',
      total_count: 1,
      created_count: 1,
      updated_count: 0,
      unresolved_password_count: 0,
      skipped_count: 0,
      imported_items: [
        {
          id: profile.id,
          data_source_name: profile.data_source_name,
          password_resolved: true,
        },
      ],
      skipped_items: [],
    }
  },

  async saveConnectionProfile(
    payload: SaveConnectionProfilePayload,
  ): Promise<ConnectionProfile> {
    ensureMockGroupExists(payload.group_name ?? null)
    const existing = payload.id
      ? connectionProfiles.find((item) => item.id === payload.id)
      : null
    const profile: ConnectionProfile = {
      id: existing?.id ?? payload.id ?? `mock-${Date.now()}`,
      group_name: payload.group_name ?? null,
      data_source_name: payload.data_source_name,
      host: payload.host,
      port: payload.port,
      username: payload.username,
      password: payload.password || existing?.password || '',
      created_at: existing?.created_at ?? now,
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

    return sanitizeMockConnectionProfile(profile)
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

  async loadSqlAutocomplete(
    payload: LoadSqlAutocompletePayload,
  ): Promise<SqlAutocompleteSchema> {
    const tables = (tablesByDatabase[`${payload.profile_id}:${payload.database_name}`] ?? []).map(
      (table) => {
        const design = tableDesigns[
          `${payload.profile_id}:${payload.database_name}:${table.name}`
        ]

        return {
          name: table.name,
          columns:
            design?.columns.map((column) => ({
              name: column.name,
              data_type: column.full_data_type,
              nullable: column.nullable,
              primary_key: column.primary_key,
              auto_increment: column.auto_increment,
              comment: column.comment,
            })) ?? [],
        }
      },
    )

    return {
      profile_id: payload.profile_id,
      database_name: payload.database_name,
      tables,
    }
  },

  async compareDiscoverTables(
    payload: CompareTableDiscoveryRequest,
  ): Promise<CompareTableDiscoveryResponse> {
    return discoverCommonTables(payload)
  },

  async runDataCompare(payload: DataCompareRequest): Promise<DataCompareResponse> {
    return buildDataCompareResponse(payload)
  },

  async startDataCompareTask(
    payload: DataCompareRequest,
  ): Promise<CompareTaskStartResponse> {
    compareTaskCounter += 1
    const compareId = `mock-compare-${compareTaskCounter}`
    compareTaskResults.set(compareId, buildDataCompareResponse(payload))
    return { compare_id: compareId }
  },

  async getDataCompareTaskProgress(
    compareId: string,
  ): Promise<CompareTaskProgressResponse> {
    const result = compareTaskResults.get(compareId)
    return {
      compare_id: compareId,
      status: result ? 'completed' : 'failed',
      total_tables: result?.summary.total_tables ?? 0,
      completed_tables: result?.summary.compared_tables ?? 0,
      current_table: null,
      current_phase: result ? 'completed' : null,
      current_phase_progress: result
        ? {
            current: result.summary.compared_tables,
            total: result.summary.total_tables,
          }
        : null,
      error_message: result ? null : 'mock 任务不存在',
    }
  },

  async getDataCompareTaskResult(
    compareId: string,
  ): Promise<CompareTaskResultResponse> {
    const result = compareTaskResults.get(compareId) ?? null
    compareTaskResults.delete(compareId)
    return {
      compare_id: compareId,
      status: result ? 'completed' : 'failed',
      result,
      error_message: result ? null : 'mock 任务不存在',
    }
  },

  async cancelDataCompareTask(
    compareId: string,
  ): Promise<CompareTaskCancelResponse> {
    compareTaskResults.delete(compareId)
    return {
      compare_id: compareId,
      accepted: true,
    }
  },

  async cleanupDataCompareCache(compareId: string): Promise<void> {
    compareTaskResults.delete(compareId)
  },

  async chooseSqlExportPath(
    payload?: ChooseFilePayload,
  ): Promise<SaveFileDialogResult> {
    const defaultFileName = payload?.default_file_name?.trim() || 'mock-export.sql'
    return {
      canceled: false,
      file_path: `/tmp/${defaultFileName}`,
    }
  },

  async chooseExportPath(payload?: ChooseFilePayload): Promise<SaveFileDialogResult> {
    const fallbackExtension = payload?.filters?.[0]?.extensions?.[0] || 'csv'
    const defaultFileName =
      payload?.default_file_name?.trim() || `mock-export.${fallbackExtension}`
    return {
      canceled: false,
      file_path: `/tmp/${defaultFileName}`,
    }
  },

  async loadDataCompareDetailPage(
    payload: CompareDetailPageRequest,
  ): Promise<CompareDetailPageResponse> {
    return buildDataCompareDetailPage(payload)
  },

  async exportDataCompareSqlFile(
    payload: ExportSqlFileRequest,
  ): Promise<ExportSqlFileResponse> {
    return {
      file_path: payload.file_path,
      insert_count: payload.table_selections.reduce(
        (total, item) => total + (item.insert_enabled ? 1 : 0),
        0,
      ),
      update_count: payload.table_selections.reduce(
        (total, item) => total + (item.update_enabled ? 1 : 0),
        0,
      ),
      delete_count: payload.table_selections.reduce(
        (total, item) => total + (item.delete_enabled ? 1 : 0),
        0,
      ),
    }
  },

  async exportTableDataFile(
    payload: ExportTableDataFileRequest,
  ): Promise<ExportDataFileResponse> {
    return {
      file_path: payload.file_path,
      row_count: payload.rows.length,
      export_format: payload.export_format,
      scope: payload.scope,
    }
  },

  async exportTableDataSqlText(
    payload: ExportTableDataSqlTextRequest,
  ): Promise<ExportSqlTextResponse> {
    return {
      content: `-- mock table export\n-- scope: ${payload.scope}\n`,
      row_count: payload.rows.length,
      scope: payload.scope,
    }
  },

  async exportQueryResultFile(
    payload: ExportQueryResultFileRequest,
  ): Promise<ExportDataFileResponse> {
    return {
      file_path: payload.file_path,
      row_count: payload.rows.length,
      export_format: payload.export_format,
      scope: payload.scope,
    }
  },

  async exportQueryResultSqlText(
    payload: ExportQueryResultSqlTextRequest,
  ): Promise<ExportSqlTextResponse> {
    return {
      content: `-- mock query export\n-- scope: ${payload.scope}\n`,
      row_count: payload.rows.length,
      scope: payload.scope,
    }
  },

  async runStructureCompare(
    payload: StructureCompareRequest,
  ): Promise<StructureCompareResponse> {
    return buildStructureCompareResponse(payload)
  },

  async startStructureCompareTask(
    payload: StructureCompareRequest,
  ): Promise<CompareTaskStartResponse> {
    structureCompareTaskCounter += 1
    const compareId = `mock-structure-compare-${structureCompareTaskCounter}`
    structureCompareTaskResults.set(compareId, buildStructureCompareResponse(payload))
    return { compare_id: compareId }
  },

  async getStructureCompareTaskProgress(
    compareId: string,
  ): Promise<CompareTaskProgressResponse> {
    const result = structureCompareTaskResults.get(compareId)
    const totalTables = result
      ? result.summary.added_table_count +
        result.summary.modified_table_count +
        result.summary.deleted_table_count
      : 0

    return {
      compare_id: compareId,
      status: result ? 'completed' : 'failed',
      total_tables: totalTables,
      completed_tables: totalTables,
      current_table: null,
      current_phase: result ? 'completed' : null,
      current_phase_progress: result
        ? {
            current: totalTables,
            total: totalTables,
          }
        : null,
      error_message: result ? null : 'mock 任务不存在',
    }
  },

  async getStructureCompareTaskResult(
    compareId: string,
  ): Promise<StructureCompareTaskResultResponse> {
    const result = structureCompareTaskResults.get(compareId) ?? null
    structureCompareTaskResults.delete(compareId)
    return {
      compare_id: compareId,
      status: result ? 'completed' : 'failed',
      result,
      error_message: result ? null : 'mock 任务不存在',
    }
  },

  async cancelStructureCompareTask(
    compareId: string,
  ): Promise<CompareTaskCancelResponse> {
    structureCompareTaskResults.delete(compareId)
    return {
      compare_id: compareId,
      accepted: true,
    }
  },

  async loadStructureCompareDetail(
    payload: StructureCompareDetailRequest,
  ): Promise<StructureCompareDetailResponse> {
    return buildStructureCompareDetailResponse(payload)
  },

  async exportStructureCompareSqlFile(
    payload: StructureExportSqlFileRequest,
  ): Promise<StructureExportSqlFileResponse> {
    return {
      file_path: payload.file_path,
      added_count: payload.selection.added_tables.length,
      modified_count: payload.selection.modified_tables.length,
      deleted_count: payload.selection.deleted_tables.length,
    }
  },

  async listCompareHistory(limit = 100): Promise<CompareHistorySummary[]> {
    return structuredClone(
      compareHistoryItems.slice(0, limit).map(buildCompareHistorySummary),
    )
  },

  async getCompareHistoryDetail(historyId: number): Promise<CompareHistoryItem | null> {
    const item = compareHistoryItems.find((history) => history.id === historyId) ?? null
    return structuredClone(item)
  },

  async addCompareHistory(payload: CompareHistoryInput): Promise<CompareHistoryItem> {
    const item: CompareHistoryItem = {
      ...payload,
      total_elapsed_ms: payload.performance.total_elapsed_ms,
      id: Date.now(),
      created_at: new Date().toISOString(),
    }
    compareHistoryItems = [item, ...compareHistoryItems]
    return structuredClone(item)
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
      row_count_exact: true,
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
        row_count_exact: true,
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
      row_count_exact: true,
      truncated: false,
      message: 'Mock 模式下语句已执行。',
    }
  },
}

function ensureMockGroupExists(groupName: string | null) {
  const normalizedGroupName = groupName?.trim()
  if (!normalizedGroupName) {
    return
  }
  if (dataSourceGroups.some((item) => item.group_name === normalizedGroupName)) {
    return
  }

  dataSourceGroups = sortDataSourceGroups([
    ...dataSourceGroups,
    {
      id: `mock-group-${Date.now()}-${dataSourceGroups.length}`,
      group_name: normalizedGroupName,
      created_at: now,
      updated_at: now,
    },
  ])
}

function loadMockRedisProfile(profileId: string) {
  const profile = redisConnectionProfiles.find((item) => item.id === profileId)
  if (!profile) {
    throw new Error('Redis 连接配置不存在')
  }
  return profile
}

function mockRedisDatabase(profileId: string, databaseIndex: number) {
  if (!redisConnectionProfiles.some((item) => item.id === profileId)) {
    throw new Error('Redis 连接配置不存在')
  }
  mockRedisData[profileId] ??= {}
  mockRedisData[profileId][databaseIndex] ??= {}
  return mockRedisData[profileId][databaseIndex]
}

function loadMockRedisKey(profileId: string, databaseIndex: number, keyName: string) {
  const database = mockRedisDatabase(profileId, databaseIndex)
  const record = database[keyName]
  if (!record) {
    throw new Error('Redis key 不存在')
  }
  return record
}

function buildMockRedisKeyDetail(
  payload: RedisKeyDetailRequest,
  record: MockRedisKeyRecord,
): RedisKeyDetail {
  const limit = Math.min(Math.max(payload.limit, 10), 500)
  const offset = Math.max(payload.offset, 0)
  const stringValue = record.string_value ?? null
  const hashEntries = record.hash_entries ?? []
  const listItems = record.list_items ?? []
  const setMembers = record.set_members ?? []
  const zsetEntries = record.zset_entries ?? []
  const streamEntries = record.stream_entries ?? []
  const lengthByType: Record<string, number> = {
    string: stringValue?.length ?? 0,
    hash: hashEntries.length,
    list: listItems.length,
    set: setMembers.length,
    zset: zsetEntries.length,
    stream: streamEntries.length,
  }
  const listPage: RedisListItem[] = listItems
    .slice(offset, offset + limit)
    .map((value, index) => ({ index: offset + index, value }))

  return {
    profile_id: payload.profile_id,
    database_index: payload.database_index,
    key_name: payload.key_name,
    type_name: record.type_name,
    ttl_seconds: record.ttl_seconds,
    length: lengthByType[record.type_name] ?? 0,
    string_value: stringValue,
    hash_entries: hashEntries.slice(0, limit),
    list_items: listPage,
    set_members: setMembers.slice(0, limit),
    zset_entries: zsetEntries.slice(offset, offset + limit),
    stream_entries: streamEntries.slice(0, limit),
    truncated: (lengthByType[record.type_name] ?? 0) > limit + offset,
  }
}

function matchesRedisPattern(keyName: string, pattern: string) {
  const normalizedPattern = pattern.trim() || '*'
  const source = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.')
  return new RegExp(`^${source}$`).test(keyName)
}

function sortDataSourceGroups(groups: DataSourceGroup[]) {
  return [...groups].sort((left, right) =>
    left.group_name.localeCompare(right.group_name, 'zh-CN'),
  )
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

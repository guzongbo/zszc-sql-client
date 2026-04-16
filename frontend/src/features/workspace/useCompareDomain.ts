import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addCompareHistory,
  cancelDataCompareTask,
  cancelStructureCompareTask,
  cleanupDataCompareCache,
  chooseSqlExportPath,
  compareDiscoverTables,
  exportDataCompareSqlFile,
  exportStructureCompareSqlFile,
  getDataCompareTaskProgress,
  getDataCompareTaskResult,
  getStructureCompareTaskProgress,
  getStructureCompareTaskResult,
  loadDataCompareDetailPage,
  loadStructureCompareDetail,
  startDataCompareTask,
  startStructureCompareTask,
} from '../../api'
import {
  buildDataCompareResultTableKey,
  buildDataCompareTableSelections,
  buildPrunedDataCompareDetailPages,
  buildStructureCompareDetailKey,
  buildStructureSqlSelection,
  createDataCompareSelectionState,
  createEmptyDataCompareDetailState,
  createEmptyDataCompareSelectionItem,
  createStructureSelectionState,
  getDataCompareActionTotalCount,
  getStructureItemsByCategory,
  pickFirstStructureCategory,
  toggleExcludedSignature,
} from '../compare/state'
import { waitForCompareTask } from '../compare/taskRuntime'
import type {
  CompareDetailType,
  ConnectionProfile,
  DataCompareRequest,
  DataCompareResponse,
  StructureCompareRequest,
  StructureCompareResponse,
  StructureDetailCategory,
} from '../../types'
import type {
  CompareFormState,
  CompareWorkflowStep,
  DataCompareSelectionItem,
  DataCompareState,
  StructureCompareState,
} from '../compare/types'
import {
  defaultCompareForm,
  defaultDataCompareState,
  defaultStructureCompareState,
  type ToastTone,
} from './appTypes'
import {
  buildDataCompareHistoryInput,
  buildDataCompareSqlFileName,
  buildStructureCompareHistoryInput,
  buildStructureCompareSqlFileName,
  parsePositiveIntegerOrNull,
} from './appHelpers'

type UseCompareDomainOptions = {
  appendOutputLog: (
    scope: string,
    message: string,
    tone?: ToastTone,
    sql?: string,
  ) => void
  ensureDatabasesLoaded: (
    profileId: string,
    options?: { silent?: boolean; force?: boolean },
  ) => Promise<unknown>
  profiles: ConnectionProfile[]
  pushToast: (message: string, tone: ToastTone) => void
  refreshCompareHistoryState: () => Promise<void>
}

function resetDataCompareResultState(state: DataCompareState): DataCompareState {
  return {
    ...state,
    result: null,
    current_request: null,
    selection_by_table: {},
    active_table_key: '',
    active_detail_type: 'insert',
    detail_pages: {},
  }
}

export function useCompareDomain({
  appendOutputLog,
  ensureDatabasesLoaded,
  profiles,
  pushToast,
  refreshCompareHistoryState,
}: UseCompareDomainOptions) {
  const [compareForm, setCompareForm] = useState<CompareFormState>(defaultCompareForm)
  const [dataCompareState, setDataCompareState] = useState<DataCompareState>(
    defaultDataCompareState,
  )
  const [structureCompareState, setStructureCompareState] = useState<StructureCompareState>(
    defaultStructureCompareState,
  )
  const [structureDetailConcurrencyInput, setStructureDetailConcurrencyInput] = useState('')
  const activeCompareCacheIdRef = useRef<string | null>(null)

  useEffect(() => {
    const currentCompareId = dataCompareState.result?.compare_id ?? null
    const previousCompareId = activeCompareCacheIdRef.current

    if (previousCompareId && currentCompareId && previousCompareId !== currentCompareId) {
      void cleanupDataCompareCache(previousCompareId)
    }

    activeCompareCacheIdRef.current = currentCompareId
  }, [dataCompareState.result?.compare_id])

  useEffect(() => {
    return () => {
      const compareId = activeCompareCacheIdRef.current
      if (compareId) {
        void cleanupDataCompareCache(compareId)
      }
    }
  }, [])

  const filteredDataCompareTables = useMemo(() => {
    const commonTables = dataCompareState.discovery?.common_tables
    if (!commonTables) {
      return []
    }

    const normalizedFilter = dataCompareState.table_filter.trim().toLowerCase()
    if (!normalizedFilter) {
      return commonTables
    }

    return commonTables.filter((tableName) =>
      tableName.toLowerCase().includes(normalizedFilter),
    )
  }, [dataCompareState.discovery?.common_tables, dataCompareState.table_filter])

  function resolveDataSourceName(profileId: string) {
    return profiles.find((profile) => profile.id === profileId)?.data_source_name ?? ''
  }

  async function updateCompareProfile(
    side: 'source' | 'target',
    profileId: string,
  ) {
    setCompareForm((previous) =>
      side === 'source'
        ? {
            ...previous,
            source_profile_id: profileId,
            source_database_name: '',
          }
        : {
            ...previous,
            target_profile_id: profileId,
            target_database_name: '',
          },
    )
    setDataCompareState(defaultDataCompareState)
    setStructureCompareState(defaultStructureCompareState)
    if (profileId) {
      await ensureDatabasesLoaded(profileId, { silent: true })
    }
  }

  function updateCompareDatabase(
    side: 'source' | 'target',
    databaseName: string,
  ) {
    setCompareForm((previous) =>
      side === 'source'
        ? { ...previous, source_database_name: databaseName }
        : { ...previous, target_database_name: databaseName },
    )
    setDataCompareState(defaultDataCompareState)
    setStructureCompareState(defaultStructureCompareState)
  }

  function setDataCompareStep(step: CompareWorkflowStep) {
    setDataCompareState((previous) => ({ ...previous, current_step: step }))
  }

  function setStructureCompareStep(step: CompareWorkflowStep) {
    setStructureCompareState((previous) => ({ ...previous, current_step: step }))
  }

  function updateDataCompareTableFilter(value: string) {
    setDataCompareState((previous) => ({ ...previous, table_filter: value }))
  }

  function toggleDataCompareTable(tableName: string, checked: boolean) {
    setDataCompareState((previous) => {
      const selected = new Set(previous.selected_tables)
      if (checked) {
        selected.add(tableName)
      } else {
        selected.delete(tableName)
      }
      return resetDataCompareResultState({
        ...previous,
        selected_tables: Array.from(selected),
      })
    })
  }

  function selectAllDataCompareTables() {
    setDataCompareState((previous) =>
      resetDataCompareResultState({
        ...previous,
        selected_tables: previous.discovery?.common_tables ?? [],
      }),
    )
  }

  function clearAllDataCompareTables() {
    setDataCompareState((previous) =>
      resetDataCompareResultState({
        ...previous,
        selected_tables: [],
      }),
    )
  }

  function buildDataCompareRequestFromForm(): DataCompareRequest {
    const { source_profile_id, source_database_name, target_profile_id, target_database_name } =
      compareForm
    if (!source_profile_id || !source_database_name) {
      throw new Error('请先选择源端数据源和数据库')
    }
    if (!target_profile_id || !target_database_name) {
      throw new Error('请先选择目标端数据源和数据库')
    }

    const selectedTables = dataCompareState.selected_tables
    const commonTables = dataCompareState.discovery?.common_tables ?? []

    return {
      source_profile_id,
      source_database_name,
      target_profile_id,
      target_database_name,
      table_mode:
        selectedTables.length === commonTables.length ? 'all' : 'selected',
      selected_tables:
        selectedTables.length === commonTables.length ? [] : selectedTables,
      preview_limit: 20,
    }
  }

  function buildStructureCompareRequestFromForm(): StructureCompareRequest {
    const { source_profile_id, source_database_name, target_profile_id, target_database_name } =
      compareForm
    const detailConcurrency = parsePositiveIntegerOrNull(structureDetailConcurrencyInput)
    if (!source_profile_id || !source_database_name) {
      throw new Error('请先选择源端数据源和数据库')
    }
    if (!target_profile_id || !target_database_name) {
      throw new Error('请先选择目标端数据源和数据库')
    }

    return {
      source_profile_id,
      source_database_name,
      target_profile_id,
      target_database_name,
      preload_details: false,
      ...(detailConcurrency ? { detail_concurrency: detailConcurrency } : {}),
    }
  }

  async function discoverCompareTables() {
    try {
      const { source_profile_id, source_database_name, target_profile_id, target_database_name } =
        compareForm
      if (!source_profile_id || !source_database_name) {
        throw new Error('请先选择源端数据源和数据库')
      }
      if (!target_profile_id || !target_database_name) {
        throw new Error('请先选择目标端数据源和数据库')
      }

      setDataCompareState((previous) => ({
        ...previous,
        loading_tables: true,
      }))

      const discovery = await compareDiscoverTables({
        source_profile_id,
        source_database_name,
        target_profile_id,
        target_database_name,
      })

      setDataCompareState((previous) =>
        resetDataCompareResultState({
          ...previous,
          discovery,
          current_step: 2,
          selected_tables: discovery.common_tables,
          loading_tables: false,
        }),
      )

      if (discovery.common_tables.length === 0) {
        pushToast('源库与目标库之间没有同名表可比较', 'info')
      }
    } catch (error) {
      setDataCompareState((previous) => ({ ...previous, loading_tables: false }))
      pushToast(error instanceof Error ? error.message : '加载对比表失败', 'error')
    }
  }

  async function ensureDataCompareDetailLoaded(
    tableKey: string,
    detailType: CompareDetailType,
    request = dataCompareState.current_request,
    reset = false,
    result = dataCompareState.result,
  ) {
    if (!request) {
      return
    }

    const targetTable = result?.table_results.find(
      (item) => buildDataCompareResultTableKey(item) === tableKey,
    )
    if (!targetTable) {
      return
    }

    const currentDetailState =
      dataCompareState.detail_pages[tableKey]?.[detailType] ?? createEmptyDataCompareDetailState()
    const actionTotal = getDataCompareActionTotalCount(targetTable, detailType)
    if (
      !reset &&
      (currentDetailState.loading ||
        (!currentDetailState.has_more && currentDetailState.loaded) ||
        actionTotal === 0)
    ) {
      return
    }

    setDataCompareState((previous) => {
      const tableDetailPages = {
        insert:
          previous.detail_pages[tableKey]?.insert ?? createEmptyDataCompareDetailState(),
        update:
          previous.detail_pages[tableKey]?.update ?? createEmptyDataCompareDetailState(),
        delete:
          previous.detail_pages[tableKey]?.delete ?? createEmptyDataCompareDetailState(),
      }
      const nextDetailState = reset
        ? {
            ...createEmptyDataCompareDetailState(),
            total: actionTotal,
            has_more: actionTotal > 0,
          }
        : {
            ...tableDetailPages[detailType],
            total: actionTotal,
          }

      return {
        ...previous,
        active_table_key: tableKey,
        active_detail_type: detailType,
        detail_pages: {
          ...previous.detail_pages,
          [tableKey]: {
            ...tableDetailPages,
            [detailType]: {
              ...nextDetailState,
              loading: actionTotal > 0,
              loaded: actionTotal === 0 ? true : nextDetailState.loaded,
              error: '',
            },
          },
        },
      }
    })

    if (actionTotal === 0) {
      return
    }

    try {
      const detailPage = await loadDataCompareDetailPage({
        compare_id: result?.compare_id ?? undefined,
        compare_request: request,
        source_table: targetTable.source_table,
        target_table: targetTable.target_table,
        detail_type: detailType,
        expected_total: actionTotal,
        offset: reset ? 0 : currentDetailState.fetched,
        limit: 50,
      })
      setDataCompareState((previous) => ({
        ...previous,
        detail_pages: buildPrunedDataCompareDetailPages(
          previous.detail_pages,
          tableKey,
          detailType,
          detailPage,
          reset,
        ),
      }))
    } catch (error) {
      setDataCompareState((previous) => ({
        ...previous,
        detail_pages: {
          ...previous.detail_pages,
          [tableKey]: {
            insert:
              previous.detail_pages[tableKey]?.insert ?? createEmptyDataCompareDetailState(),
            update:
              previous.detail_pages[tableKey]?.update ?? createEmptyDataCompareDetailState(),
            delete:
              previous.detail_pages[tableKey]?.delete ?? createEmptyDataCompareDetailState(),
            [detailType]: {
              ...(previous.detail_pages[tableKey]?.[detailType] ??
                createEmptyDataCompareDetailState()),
              loading: false,
              error: error instanceof Error ? error.message : '读取对比详情失败',
            },
          },
        },
      }))
    }
  }

  async function runDataCompareFlow() {
    try {
      const request = buildDataCompareRequestFromForm()
      if (request.table_mode === 'selected' && request.selected_tables.length === 0) {
        throw new Error('请至少勾选一张待比较数据表')
      }

      setDataCompareState((previous) => ({
        ...previous,
        running: true,
        task_progress: null,
        result: null,
        selection_by_table: {},
        active_table_key: '',
        active_detail_type: 'insert',
        detail_pages: {},
      }))

      const task = await startDataCompareTask(request)
      const response = await waitForCompareTask<DataCompareResponse>({
        compareId: task.compare_id,
        getProgress: getDataCompareTaskProgress,
        getResult: getDataCompareTaskResult,
        onProgress: (progress) => {
          setDataCompareState((previous) => ({
            ...previous,
            task_progress: progress,
          }))
        },
      })
      if (!response.result) {
        throw new Error(response.error_message ?? '数据对比未返回结果')
      }
      const compareResult = response.result
      const firstTableKey = compareResult.table_results[0]
        ? buildDataCompareResultTableKey(compareResult.table_results[0])
        : ''

      setDataCompareState((previous) => ({
        ...previous,
        current_step: 3,
        running: false,
        task_progress: null,
        result: compareResult,
        current_request: request,
        selection_by_table: createDataCompareSelectionState(compareResult),
        active_table_key: firstTableKey,
        active_detail_type: 'insert',
        detail_pages: {},
      }))

      await addCompareHistory(
        buildDataCompareHistoryInput(
          compareResult,
          request,
          resolveDataSourceName(request.source_profile_id),
          resolveDataSourceName(request.target_profile_id),
        ),
      )
      await refreshCompareHistoryState()
      pushToast('数据对比完成', 'success')
      if (firstTableKey) {
        await ensureDataCompareDetailLoaded(
          firstTableKey,
          'insert',
          request,
          true,
          compareResult,
        )
      }
    } catch (error) {
      setDataCompareState((previous) => ({
        ...previous,
        running: false,
        task_progress: null,
      }))
      pushToast(error instanceof Error ? error.message : '数据对比失败', 'error')
    }
  }

  async function exportSelectedDataCompareSql() {
    try {
      if (!dataCompareState.result || !dataCompareState.current_request) {
        throw new Error('当前没有可导出的数据对比结果')
      }

      const tableSelections = buildDataCompareTableSelections(
        dataCompareState.result,
        dataCompareState.selection_by_table,
      )
      const selectedStatementCount = tableSelections.reduce((total, item) => {
        if (!item.table_enabled) {
          return total
        }
        return (
          total +
          Number(item.insert_enabled) +
          Number(item.update_enabled) +
          Number(item.delete_enabled)
        )
      }, 0)

      if (selectedStatementCount === 0) {
        throw new Error('当前没有已选中的差异 SQL 可导出')
      }

      const saveTarget = await chooseSqlExportPath({
        default_file_name: buildDataCompareSqlFileName(compareForm),
      })
      if (saveTarget.canceled || !saveTarget.file_path) {
        return
      }

      const result = await exportDataCompareSqlFile({
        compare_id: dataCompareState.result.compare_id,
        compare_request: dataCompareState.current_request,
        table_selections: tableSelections,
        file_path: saveTarget.file_path,
      })

      pushToast('数据对比 SQL 已导出', 'success')
      appendOutputLog(
        '数据对比导出',
        `已导出到 ${result.file_path}，INSERT ${result.insert_count}，UPDATE ${result.update_count}，DELETE ${result.delete_count}`,
        'success',
      )
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '导出 SQL 失败', 'error')
    }
  }

  async function cancelRunningDataCompare() {
    const compareId = dataCompareState.task_progress?.compare_id
    if (!compareId) {
      return
    }
    try {
      await cancelDataCompareTask(compareId)
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '取消数据对比失败', 'error')
    }
  }

  function updateDataCompareSelection(
    tableKey: string,
    updater: (current: DataCompareSelectionItem) => DataCompareSelectionItem,
  ) {
    setDataCompareState((previous) => ({
      ...previous,
      selection_by_table: {
        ...previous.selection_by_table,
        [tableKey]: updater(
          previous.selection_by_table[tableKey] ?? createEmptyDataCompareSelectionItem(),
        ),
      },
    }))
  }

  function toggleDataCompareResultTableSelection(tableKey: string, checked: boolean) {
    updateDataCompareSelection(tableKey, (current) => ({
      ...current,
      table_enabled: checked,
      insert_enabled: checked,
      update_enabled: checked,
      delete_enabled: checked,
      excluded_insert_signatures: checked ? [] : current.excluded_insert_signatures,
      excluded_update_signatures: checked ? [] : current.excluded_update_signatures,
      excluded_delete_signatures: checked ? [] : current.excluded_delete_signatures,
    }))
  }

  function toggleDataCompareResultActionSelection(
    tableKey: string,
    detailType: CompareDetailType,
    checked: boolean,
  ) {
    updateDataCompareSelection(tableKey, (current) => {
      const next: DataCompareSelectionItem = {
        ...current,
        table_enabled: checked ? true : current.table_enabled,
      }

      if (detailType === 'insert') {
        next.insert_enabled = checked
        next.excluded_insert_signatures = checked ? [] : current.excluded_insert_signatures
      } else if (detailType === 'update') {
        next.update_enabled = checked
        next.excluded_update_signatures = checked ? [] : current.excluded_update_signatures
      } else {
        next.delete_enabled = checked
        next.excluded_delete_signatures = checked ? [] : current.excluded_delete_signatures
      }

      if (!next.insert_enabled && !next.update_enabled && !next.delete_enabled) {
        next.table_enabled = false
      }

      return next
    })
  }

  function toggleDataCompareDetailSelection(
    tableKey: string,
    detailType: CompareDetailType,
    signature: string,
    checked: boolean,
  ) {
    if (!signature) {
      return
    }

    updateDataCompareSelection(tableKey, (current) => {
      const next = { ...current }
      if (detailType === 'insert') {
        next.excluded_insert_signatures = toggleExcludedSignature(
          current.excluded_insert_signatures,
          signature,
          checked,
        )
      } else if (detailType === 'update') {
        next.excluded_update_signatures = toggleExcludedSignature(
          current.excluded_update_signatures,
          signature,
          checked,
        )
      } else {
        next.excluded_delete_signatures = toggleExcludedSignature(
          current.excluded_delete_signatures,
          signature,
          checked,
        )
      }
      return next
    })
  }

  function selectDataCompareResultTable(tableKey: string) {
    const detailType = dataCompareState.active_detail_type
    setDataCompareState((previous) => ({
      ...previous,
      active_table_key: tableKey,
    }))
    void ensureDataCompareDetailLoaded(
      tableKey,
      detailType,
      dataCompareState.current_request,
      false,
    )
  }

  function switchDataCompareDetailType(detailType: CompareDetailType) {
    const tableKey = dataCompareState.active_table_key
    setDataCompareState((previous) => ({
      ...previous,
      active_detail_type: detailType,
    }))
    if (tableKey) {
      void ensureDataCompareDetailLoaded(
        tableKey,
        detailType,
        dataCompareState.current_request,
        false,
      )
    }
  }

  async function runStructureCompareFlow() {
    try {
      const request = buildStructureCompareRequestFromForm()
      setStructureCompareState((previous) => ({
        ...previous,
        loading: true,
        task_progress: null,
      }))

      const task = await startStructureCompareTask(request)
      const response = await waitForCompareTask<StructureCompareResponse>({
        compareId: task.compare_id,
        getProgress: getStructureCompareTaskProgress,
        getResult: getStructureCompareTaskResult,
        onProgress: (progress) => {
          setStructureCompareState((previous) => ({
            ...previous,
            task_progress: progress,
          }))
        },
      })
      if (!response.result) {
        throw new Error(response.error_message ?? '结构对比未返回结果')
      }
      const result = response.result
      const activeCategory = pickFirstStructureCategory(result)

      setStructureCompareState({
        current_step: 2,
        loading: false,
        task_progress: null,
        result,
        current_request: request,
        selection_by_category: createStructureSelectionState(result),
        active_category: activeCategory,
        expanded_detail_keys: [],
        detail_cache: {},
      })

      await addCompareHistory(
        buildStructureCompareHistoryInput(
          result,
          request,
          resolveDataSourceName(request.source_profile_id),
          resolveDataSourceName(request.target_profile_id),
        ),
      )
      await refreshCompareHistoryState()
      pushToast('结构对比完成', 'success')
    } catch (error) {
      setStructureCompareState((previous) => ({
        ...previous,
        loading: false,
        task_progress: null,
      }))
      pushToast(error instanceof Error ? error.message : '结构对比失败', 'error')
    }
  }

  async function cancelRunningStructureCompare() {
    const compareId = structureCompareState.task_progress?.compare_id
    if (!compareId) {
      return
    }
    try {
      await cancelStructureCompareTask(compareId)
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '取消结构对比失败', 'error')
    }
  }

  async function exportSelectedStructureCompareSql() {
    try {
      if (!structureCompareState.result || !structureCompareState.current_request) {
        throw new Error('当前没有可导出的结构对比结果')
      }

      const selection = buildStructureSqlSelection(
        structureCompareState.selection_by_category,
      )
      const selectedCount =
        selection.added_tables.length +
        selection.modified_tables.length +
        selection.deleted_tables.length

      if (selectedCount === 0) {
        throw new Error('请至少选择一张表后再导出 SQL')
      }

      const saveTarget = await chooseSqlExportPath({
        default_file_name: buildStructureCompareSqlFileName(compareForm),
      })
      if (saveTarget.canceled || !saveTarget.file_path) {
        return
      }

      const result = await exportStructureCompareSqlFile({
        compare_request: structureCompareState.current_request,
        selection,
        file_path: saveTarget.file_path,
      })

      pushToast('结构对比 SQL 已导出', 'success')
      appendOutputLog(
        '结构对比导出',
        `已导出到 ${result.file_path}，新增 ${result.added_count}，修改 ${result.modified_count}，删除 ${result.deleted_count}`,
        'success',
      )
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '导出结构 SQL 失败', 'error')
    }
  }

  function toggleStructureCategorySelection(
    category: StructureDetailCategory,
    checked: boolean,
  ) {
    setStructureCompareState((previous) => ({
      ...previous,
      selection_by_category: {
        ...previous.selection_by_category,
        [category]: checked
          ? getStructureItemsByCategory(previous.result, category).map((item) => item.table_name)
          : [],
      },
    }))
  }

  function setActiveStructureCategory(category: StructureDetailCategory) {
    setStructureCompareState((previous) => ({
      ...previous,
      active_category: category,
    }))
  }

  function toggleStructureTableSelection(
    category: StructureDetailCategory,
    tableName: string,
    checked: boolean,
  ) {
    setStructureCompareState((previous) => {
      const selection = new Set(previous.selection_by_category[category])
      if (checked) {
        selection.add(tableName)
      } else {
        selection.delete(tableName)
      }

      return {
        ...previous,
        selection_by_category: {
          ...previous.selection_by_category,
          [category]: Array.from(selection).sort((left, right) =>
            left.localeCompare(right, 'zh-CN'),
          ),
        },
      }
    })
  }

  async function toggleStructureDetail(
    category: StructureDetailCategory,
    tableName: string,
    request = structureCompareState.current_request,
    forceReload = false,
  ) {
    if (!request) {
      return
    }

    const detailKey = buildStructureCompareDetailKey(category, tableName)
    const alreadyExpanded = structureCompareState.expanded_detail_keys.includes(detailKey)
    if (alreadyExpanded && !forceReload) {
      setStructureCompareState((previous) => ({
        ...previous,
        expanded_detail_keys: previous.expanded_detail_keys.filter((item) => item !== detailKey),
      }))
      return
    }

    setStructureCompareState((previous) => ({
      ...previous,
      active_category: category,
      expanded_detail_keys: alreadyExpanded
        ? previous.expanded_detail_keys
        : [...previous.expanded_detail_keys, detailKey],
    }))

    try {
      setStructureCompareState((previous) => ({
        ...previous,
        detail_cache: {
          ...previous.detail_cache,
          [detailKey]: {
            loading: true,
            error: '',
            detail: previous.detail_cache[detailKey]?.detail ?? null,
          },
        },
      }))

      const detail = await loadStructureCompareDetail({
        compare_request: request,
        category,
        table_name: tableName,
      })
      setStructureCompareState((previous) => ({
        ...previous,
        detail_cache: {
          ...previous.detail_cache,
          [detailKey]: {
            loading: false,
            error: '',
            detail,
          },
        },
      }))
    } catch (error) {
      setStructureCompareState((previous) => ({
        ...previous,
        detail_cache: {
          ...previous.detail_cache,
          [detailKey]: {
            loading: false,
            error: error instanceof Error ? error.message : '读取结构详情失败',
            detail: previous.detail_cache[detailKey]?.detail ?? null,
          },
        },
      }))
    }
  }

  return {
    cancelRunningDataCompare,
    cancelRunningStructureCompare,
    clearAllDataCompareTables,
    compareForm,
    dataCompareState,
    discoverCompareTables,
    ensureDataCompareDetailLoaded,
    exportSelectedDataCompareSql,
    exportSelectedStructureCompareSql,
    filteredDataCompareTables,
    runDataCompareFlow,
    runStructureCompareFlow,
    setActiveStructureCategory,
    setDataCompareStep,
    setStructureCompareStep,
    setStructureDetailConcurrencyInput,
    structureCompareState,
    structureDetailConcurrencyInput,
    switchDataCompareDetailType,
    toggleDataCompareDetailSelection,
    toggleDataCompareResultActionSelection,
    toggleDataCompareResultTableSelection,
    toggleDataCompareTable,
    toggleStructureCategorySelection,
    toggleStructureDetail,
    toggleStructureTableSelection,
    selectAllDataCompareTables,
    selectDataCompareResultTable,
    updateCompareDatabase,
    updateCompareProfile,
    updateDataCompareTableFilter,
  }
}

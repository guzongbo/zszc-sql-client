import { CompareConnectionForm } from './CompareConnectionForm'
import {
  CompareDatabaseTablePanel,
  CompareDifferenceCard,
  CompareResultCheckbox,
  DataCompareRowTable,
  SyncedUpdateFieldTables,
} from './CompareResultViews'
import {
  buildDataCompareResultTableKey,
  createEmptyDataCompareDetailState,
  getDataCompareActionSelectionStats,
  isDataCompareDetailSelected,
  getDataCompareSelectionSummary,
  getDataCompareTableSelectionStats,
} from './state'
import { formatCompareTaskPhaseLabel } from './taskRuntime'
import type { CompareFormState, DataCompareState } from './types'
import { EmptyNotice } from '../../shared/components/EmptyNotice'
import { SummaryCards } from '../../shared/components/SummaryCards'
import type {
  CompareDetailType,
  CompareHistorySummary,
  ConnectionProfile,
  DatabaseEntry,
} from '../../types'

type ProfileConnectionState = Record<string, 'idle' | 'connected' | 'error'>

export function DataCompareWorkspace({
  state,
  compareForm,
  profiles,
  compareHistoryItems,
  databasesByProfile,
  nodeLoading,
  profileConnectionState,
  filteredTables,
  onSourceProfileChange,
  onSourceDatabaseChange,
  onTargetProfileChange,
  onTargetDatabaseChange,
  onDiscover,
  onBackToSourceStep,
  onTableFilterChange,
  onTableToggle,
  onSelectAllTables,
  onClearAllTables,
  onRunCompare,
  onExportSql,
  onCancelCompare,
  onResultTablePick,
  onDetailTypeChange,
  onResultTableToggle,
  onResultActionToggle,
  onDetailToggle,
  onLoadMoreDetail,
}: {
  state: DataCompareState
  compareForm: CompareFormState
  profiles: ConnectionProfile[]
  compareHistoryItems: CompareHistorySummary[]
  databasesByProfile: Record<string, DatabaseEntry[]>
  nodeLoading: Record<string, boolean>
  profileConnectionState: ProfileConnectionState
  filteredTables: string[]
  onSourceProfileChange: (value: string) => void
  onSourceDatabaseChange: (value: string) => void
  onTargetProfileChange: (value: string) => void
  onTargetDatabaseChange: (value: string) => void
  onDiscover: () => void
  onBackToSourceStep: () => void
  onTableFilterChange: (value: string) => void
  onTableToggle: (tableName: string, checked: boolean) => void
  onSelectAllTables: () => void
  onClearAllTables: () => void
  onRunCompare: () => void
  onExportSql: () => void
  onCancelCompare: () => void
  onResultTablePick: (tableKey: string) => void
  onDetailTypeChange: (detailType: CompareDetailType) => void
  onResultTableToggle: (tableKey: string, checked: boolean) => void
  onResultActionToggle: (
    tableKey: string,
    detailType: CompareDetailType,
    checked: boolean,
  ) => void
  onDetailToggle: (
    tableKey: string,
    detailType: CompareDetailType,
    signature: string,
    checked: boolean,
  ) => void
  onLoadMoreDetail: () => void
}) {
  const sourceProfile =
    profiles.find((profile) => profile.id === compareForm.source_profile_id) ?? null
  const targetProfile =
    profiles.find((profile) => profile.id === compareForm.target_profile_id) ?? null
  const sourceTables =
    state.discovery?.source_tables.filter((tableName) =>
      tableName.toLowerCase().includes(state.table_filter.trim().toLowerCase()),
    ) ?? []
  const targetTables =
    state.discovery?.target_tables.filter((tableName) =>
      tableName.toLowerCase().includes(state.table_filter.trim().toLowerCase()),
    ) ?? []
  const commonTableSet = new Set(state.discovery?.common_tables ?? [])
  const sourceOnlyTables = (state.discovery?.source_tables ?? []).filter(
    (tableName) => !commonTableSet.has(tableName),
  )
  const targetOnlyTables = (state.discovery?.target_tables ?? []).filter(
    (tableName) => !commonTableSet.has(tableName),
  )
  const activeResult =
    state.result?.table_results.find(
      (item) => buildDataCompareResultTableKey(item) === state.active_table_key,
    ) ?? null
  const activeDetailState =
    (activeResult
      ? state.detail_pages[state.active_table_key]?.[state.active_detail_type]
      : null) ?? createEmptyDataCompareDetailState()
  const selectionSummary = getDataCompareSelectionSummary(
    state.result,
    state.selection_by_table,
  )

  if (state.current_step === 1) {
    return (
      <div className="compare-workspace compare-flow-workspace">
        <div className="compare-page-header">
          <div>
            <strong>数据对比</strong>
            <p>直接在当前页面选择源端与目标端数据库，不再依赖数据源树的额外点击流程。</p>
          </div>
          <div className="editor-actions">
            <button
              className="flat-button primary"
              disabled={state.loading_tables || state.running || profiles.length === 0}
              type="button"
              onClick={onDiscover}
            >
              {state.loading_tables ? '加载中...' : '加载同名表'}
            </button>
          </div>
        </div>

        <div className="glass-card compare-results-card">
          <div className="section-head">
            <div>
              <h2>步骤 1 / 3</h2>
              <p>选择数据源后即可直接加载数据库列表，并进入同名表筛选阶段。</p>
            </div>
          </div>
          {profiles.length === 0 ? (
            <EmptyNotice title="暂无数据源" text="先新增或导入数据源，再开始数据对比。" />
          ) : (
            <>
              <CompareConnectionForm
                compareForm={compareForm}
                profiles={profiles}
                compareHistoryItems={compareHistoryItems}
                databasesByProfile={databasesByProfile}
                nodeLoading={nodeLoading}
                profileConnectionState={profileConnectionState}
                onSourceProfileChange={onSourceProfileChange}
                onSourceDatabaseChange={onSourceDatabaseChange}
                onTargetProfileChange={onTargetProfileChange}
                onTargetDatabaseChange={onTargetDatabaseChange}
              />
              <div className="compare-pair-summary">
                <div className="compare-pair-item">
                  <span>源端</span>
                  <strong>
                    {sourceProfile
                      ? `${sourceProfile.data_source_name} / ${compareForm.source_database_name || '未选择数据库'}`
                      : '未选择'}
                  </strong>
                </div>
                <div className="compare-pair-arrow">→</div>
                <div className="compare-pair-item">
                  <span>目标端</span>
                  <strong>
                    {targetProfile
                      ? `${targetProfile.data_source_name} / ${compareForm.target_database_name || '未选择数据库'}`
                      : '未选择'}
                  </strong>
                </div>
              </div>
            </>
          )}
          {state.task_progress ? (
            <div className="status-panel compare-status-panel">
              <strong>任务状态</strong>
              <span>
                {state.task_progress.completed_tables}/{state.task_progress.total_tables} 表
              </span>
              <span>{formatCompareTaskPhaseLabel(state.task_progress.current_phase)}</span>
              {state.task_progress.current_phase_progress?.total ? (
                <span>
                  阶段进度 {state.task_progress.current_phase_progress.current}/
                  {state.task_progress.current_phase_progress.total}
                </span>
              ) : null}
              {state.task_progress.current_table ? (
                <span>{state.task_progress.current_table}</span>
              ) : null}
              {state.running ? (
                <button className="flat-button danger" type="button" onClick={onCancelCompare}>
                  取消任务
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (state.current_step === 2) {
    return (
      <div className="compare-workspace compare-flow-workspace">
        <div className="compare-page-header">
          <div>
            <strong>数据对比</strong>
            <p>完全沿用 mysql-data-compare 的表范围筛选方式：三栏表目录、同名表勾选和差异预检查。</p>
          </div>
          <div className="editor-actions">
            <button className="flat-button" type="button" onClick={onBackToSourceStep}>
              上一步
            </button>
            <button className="flat-button" type="button" onClick={onSelectAllTables}>
              全选所有表
            </button>
            <button className="flat-button" type="button" onClick={onClearAllTables}>
              清空所有表
            </button>
            <button
              className="flat-button primary"
              disabled={state.running || state.selected_tables.length === 0}
              type="button"
              onClick={onRunCompare}
            >
              {state.running ? '对比中...' : '比较并预览'}
            </button>
          </div>
        </div>

        <SummaryCards
          items={[
            ['源表总数', String(state.discovery?.source_tables.length ?? 0)],
            ['目标表总数', String(state.discovery?.target_tables.length ?? 0)],
            ['可比较同名表', String(state.discovery?.common_tables.length ?? 0)],
            ['当前选中', String(state.selected_tables.length)],
          ]}
        />

        <div className="glass-card compare-results-card">
          <div className="compare-pair-summary">
            <div className="compare-pair-item">
              <span>源端</span>
              <strong>
                {sourceProfile
                  ? `${sourceProfile.data_source_name} / ${compareForm.source_database_name}`
                  : '未选择'}
              </strong>
            </div>
            <div className="compare-pair-arrow">→</div>
            <div className="compare-pair-item">
              <span>目标端</span>
              <strong>
                {targetProfile
                  ? `${targetProfile.data_source_name} / ${compareForm.target_database_name}`
                  : '未选择'}
              </strong>
            </div>
          </div>

          <div className="form-card compact-form-card compare-filter-card">
            <label className="form-item">
              <span>搜索表名</span>
              <input
                value={state.table_filter}
                onChange={(event) => onTableFilterChange(event.target.value)}
                placeholder="输入关键字筛选源表、同名表和目标表"
              />
            </label>
          </div>

          <div className="compare-database-grid">
            <CompareDatabaseTablePanel
              items={sourceTables}
              title="源数据库表"
              matchLabel="同名可比较"
              matchedSet={commonTableSet}
              soloLabel="仅源端"
            />

            <div className="compare-catalog-card">
              <div className="table-panel-head">
                <div>可比较同名表</div>
                <div className="small-text">共 {filteredTables.length} 条匹配结果</div>
              </div>
              <div className="compare-table-list compare-catalog-list">
                {filteredTables.length === 0 ? (
                  <div className="empty-inline">当前没有匹配的可比较表</div>
                ) : (
                  filteredTables.map((tableName) => (
                    <label className="compare-table-item" key={tableName}>
                      <input
                        checked={state.selected_tables.includes(tableName)}
                        type="checkbox"
                        onChange={(event) =>
                          onTableToggle(tableName, event.target.checked)
                        }
                      />
                      <span>{tableName}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <CompareDatabaseTablePanel
              items={targetTables}
              title="目标数据库表"
              matchLabel="同名可比较"
              matchedSet={commonTableSet}
              soloLabel="仅目标端"
            />
          </div>

          <div className="compare-difference-grid">
            <CompareDifferenceCard items={sourceOnlyTables} title="仅在源端存在" />
            <CompareDifferenceCard items={targetOnlyTables} title="仅在目标端存在" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="compare-workspace compare-flow-workspace">
      <div className="compare-page-header">
        <div>
          <strong>数据对比</strong>
        </div>
        <div className="editor-actions">
          <button className="flat-button" type="button" onClick={onBackToSourceStep}>
            返回表选择
          </button>
          <button
            className="flat-button"
            disabled={
              selectionSummary.insert_selected +
                selectionSummary.update_selected +
                selectionSummary.delete_selected ===
              0
            }
            type="button"
            onClick={onExportSql}
          >
            导出 SQL
          </button>
          <button className="flat-button primary" type="button" onClick={onRunCompare}>
            重新执行
          </button>
        </div>
      </div>

      {state.result ? (
        <>
          <SummaryCards
            items={[
              ['总表数', String(state.result.summary.total_tables)],
              ['已选表', `${selectionSummary.selected_tables}/${state.result.summary.compared_tables}`],
              ['总耗时', `${state.result.performance.total_elapsed_ms} ms`],
              [
                'INSERT（已选/总数）',
                `${selectionSummary.insert_selected}/${state.result.summary.total_insert_count}`,
              ],
              [
                'UPDATE（已选/总数）',
                `${selectionSummary.update_selected}/${state.result.summary.total_update_count}`,
              ],
              [
                'DELETE（已选/总数）',
                `${selectionSummary.delete_selected}/${state.result.summary.total_delete_count}`,
              ],
            ]}
          />

          {state.result.skipped_tables.length > 0 ? (
            <div className="status-panel warning compare-warning-panel">
              <strong>跳过的表</strong>
              {state.result.skipped_tables.map((item) => (
                <span key={`${item.source_table}:${item.reason}`}>
                  {item.source_table} {'->'} {item.target_table}：{item.reason}
                </span>
              ))}
            </div>
          ) : null}

          <div className="compare-main-grid compare-main-stack">
            <div className="glass-card compare-results-card">
              <div className="section-head">
                <div>
                  <h2>表对比结果</h2>
                </div>
              </div>
              <div className="result-table-wrap">
                <table className="result-table">
                  <thead>
                    <tr>
                      <th>表名</th>
                      <th>模式</th>
                      <th>整表（已选/总数）</th>
                      <th>INSERT（已选/总数）</th>
                      <th>UPDATE（已选/总数）</th>
                      <th>DELETE（已选/总数）</th>
                      <th>告警</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.result.table_results.map((item) => {
                      const tableKey = buildDataCompareResultTableKey(item)
                      const tableStats = getDataCompareTableSelectionStats(
                        item,
                        state.selection_by_table,
                      )

                      return (
                        <tr
                          className={state.active_table_key === tableKey ? 'active-row' : ''}
                          key={tableKey}
                          onClick={() => onResultTablePick(tableKey)}
                        >
                          <td>
                            <button
                              className="link-button"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                onResultTablePick(tableKey)
                              }}
                            >
                              {item.source_table}
                            </button>
                            {item.target_table !== item.source_table ? (
                              <div className="result-table-meta">
                                目标表：{item.target_table}
                              </div>
                            ) : null}
                          </td>
                          <td>{item.compare_mode}</td>
                          <td>
                            <CompareResultCheckbox
                              checked={tableStats.table_checked}
                              countLabel={`${tableStats.selected_total}/${tableStats.total_total}`}
                              indeterminate={tableStats.table_indeterminate}
                              label="整表"
                              onChange={(checked) =>
                                onResultTableToggle(tableKey, checked)
                              }
                            />
                          </td>
                          <td>
                            <CompareResultCheckbox
                              checked={tableStats.insert_checked}
                              countLabel={`${tableStats.insert_selected}/${tableStats.insert_total}`}
                              indeterminate={tableStats.insert_indeterminate}
                              label="INSERT"
                              onChange={(checked) =>
                                onResultActionToggle(tableKey, 'insert', checked)
                              }
                            />
                          </td>
                          <td>
                            <CompareResultCheckbox
                              checked={tableStats.update_checked}
                              countLabel={`${tableStats.update_selected}/${tableStats.update_total}`}
                              indeterminate={tableStats.update_indeterminate}
                              label="UPDATE"
                              onChange={(checked) =>
                                onResultActionToggle(tableKey, 'update', checked)
                              }
                            />
                          </td>
                          <td>
                            <CompareResultCheckbox
                              checked={tableStats.delete_checked}
                              countLabel={`${tableStats.delete_selected}/${tableStats.delete_total}`}
                              indeterminate={tableStats.delete_indeterminate}
                              label="DELETE"
                              onChange={(checked) =>
                                onResultActionToggle(tableKey, 'delete', checked)
                              }
                            />
                          </td>
                          <td>{item.warnings.length > 0 ? item.warnings.join('；') : '--'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="glass-card compare-detail-card">
              <div className="section-head">
                <div>
                  <h2>表差异详情</h2>
                  <p>
                    {activeResult
                      ? `${activeResult.source_table} -> ${activeResult.target_table}`
                      : '请选择一张表'}
                  </p>
                </div>
                {activeResult ? (
                  <div className="compare-history-tabs">
                    {(['insert', 'update', 'delete'] as CompareDetailType[]).map((detailType) => (
                      <button
                        className={`flat-button ${state.active_detail_type === detailType ? 'primary' : ''}`}
                        key={detailType}
                        type="button"
                        onClick={() => onDetailTypeChange(detailType)}
                      >
                        {detailType.toUpperCase()}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {activeResult ? (
                <>
                  <div className="compare-detail-summary">
                    <span>
                      主键/唯一键：
                      {(activeResult.key_columns ?? []).length > 0
                        ? activeResult.key_columns.join('、')
                        : '未识别'}
                    </span>
                    <span>
                      当前分类已选{' '}
                      {
                        getDataCompareActionSelectionStats(
                          activeResult,
                          state.selection_by_table,
                          state.active_detail_type,
                        ).selected
                      }
                      /
                      {
                        getDataCompareActionSelectionStats(
                          activeResult,
                          state.selection_by_table,
                          state.active_detail_type,
                        ).total
                      }
                    </span>
                    <span>
                      已加载 {activeDetailState.fetched}/{activeDetailState.total}
                    </span>
                  </div>

                  {activeResult.warnings.length > 0 ? (
                    <div className="status-panel warning compare-warning-panel">
                      {activeResult.warnings.map((warning) => (
                        <span key={warning}>{warning}</span>
                      ))}
                    </div>
                  ) : null}

                  {activeDetailState.error ? (
                    <EmptyNotice title="读取差异详情失败" text={activeDetailState.error} />
                  ) : state.active_detail_type === 'update' ? (
                    <div className="compare-detail-list">
                      {activeDetailState.update_items.length === 0 && activeDetailState.loading ? (
                        <div className="empty-inline">正在加载差异详情...</div>
                      ) : null}
                      {activeDetailState.update_items.length === 0 &&
                      !activeDetailState.loading ? (
                        <div className="empty-inline">当前分类下没有差异数据</div>
                      ) : null}
                      {activeDetailState.update_items.map((item) => (
                        <div className="compare-detail-item compare-update-item" key={item.signature}>
                          <div className="compare-update-head">
                            <label className="detail-check">
                              <input
                                checked={isDataCompareDetailSelected(
                                  activeResult,
                                  state.selection_by_table,
                                  'update',
                                  item.signature,
                                )}
                                type="checkbox"
                                onChange={(event) =>
                                  onDetailToggle(
                                    state.active_table_key,
                                    'update',
                                    item.signature,
                                    event.target.checked,
                                  )
                                }
                              />
                              <span>纳入 SQL</span>
                            </label>
                            <span className="status-tag warning">UPDATE</span>
                            <span className="compare-update-signature">
                              签名：{item.signature}，差异字段：
                              {item.diff_columns.length > 0
                                ? item.diff_columns.join('、')
                                : '无'}
                            </span>
                          </div>
                          <div className="compare-update-grid">
                            <SyncedUpdateFieldTables
                              diffColumns={item.diff_columns}
                              sourceRow={item.source_row}
                              targetRow={item.target_row}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <DataCompareRowTable
                      columns={activeDetailState.row_columns}
                      detailType={state.active_detail_type}
                      items={activeDetailState.row_items}
                      selectionByTable={state.selection_by_table}
                      tableKey={state.active_table_key}
                      tableResult={activeResult}
                      onToggle={onDetailToggle}
                    />
                  )}

                  {activeDetailState.loading && activeDetailState.fetched > 0 ? (
                    <div className="status-panel">正在加载更多差异...</div>
                  ) : null}

                  {activeDetailState.has_more ? (
                    <div className="compare-detail-loadmore">
                      <button className="flat-button" type="button" onClick={onLoadMoreDetail}>
                        加载更多
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <EmptyNotice title="请选择结果表" text="先在左侧结果表格中选择一张表。" />
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="empty-workspace compare-empty-workspace">
          <strong>等待执行数据对比</strong>
          <p>完成同名表加载并执行比较后，在这里查看统计结果与明细。</p>
          <span>当前筛选 {filteredTables.length} 张可比表</span>
        </div>
      )}
    </div>
  )
}

import { CompareConnectionForm } from './CompareConnectionForm'
import { CompareDifferenceCard, StructureDetailPanel } from './CompareResultViews'
import {
  buildStructureCompareDetailKey,
  getStructureItemsByCategory,
  getStructureSelectionTotal,
} from './state'
import type { CompareFormState, StructureCompareState } from './types'
import { EmptyNotice } from '../../shared/components/EmptyNotice'
import { SummaryCards } from '../../shared/components/SummaryCards'
import type {
  CompareHistoryItem,
  ConnectionProfile,
  DatabaseEntry,
  StructureDetailCategory,
} from '../../types'

type ProfileConnectionState = Record<string, 'idle' | 'connected' | 'error'>

export function StructureCompareWorkspace({
  state,
  compareForm,
  profiles,
  compareHistoryItems,
  databasesByProfile,
  nodeLoading,
  profileConnectionState,
  onSourceProfileChange,
  onSourceDatabaseChange,
  onTargetProfileChange,
  onTargetDatabaseChange,
  onRunCompare,
  onBackToSourceStep,
  onGoToSummaryStep,
  onBackToDiffStep,
  detailConcurrencyInput,
  onDetailConcurrencyInputChange,
  onExportSql,
  onCategoryChange,
  onCategoryToggle,
  onTableToggle,
  onDetailToggle,
}: {
  state: StructureCompareState
  compareForm: CompareFormState
  profiles: ConnectionProfile[]
  compareHistoryItems: CompareHistoryItem[]
  databasesByProfile: Record<string, DatabaseEntry[]>
  nodeLoading: Record<string, boolean>
  profileConnectionState: ProfileConnectionState
  onSourceProfileChange: (value: string) => void
  onSourceDatabaseChange: (value: string) => void
  onTargetProfileChange: (value: string) => void
  onTargetDatabaseChange: (value: string) => void
  onRunCompare: () => void
  onBackToSourceStep: () => void
  onGoToSummaryStep: () => void
  onBackToDiffStep: () => void
  detailConcurrencyInput: string
  onDetailConcurrencyInputChange: (value: string) => void
  onExportSql: () => void
  onCategoryChange: (category: StructureDetailCategory) => void
  onCategoryToggle: (category: StructureDetailCategory, checked: boolean) => void
  onTableToggle: (
    category: StructureDetailCategory,
    tableName: string,
    checked: boolean,
  ) => void
  onDetailToggle: (
    category: StructureDetailCategory,
    tableName: string,
    forceReload?: boolean,
  ) => void
}) {
  const sourceProfile =
    profiles.find((profile) => profile.id === compareForm.source_profile_id) ?? null
  const targetProfile =
    profiles.find((profile) => profile.id === compareForm.target_profile_id) ?? null
  const activeItems = getStructureItemsByCategory(state.result, state.active_category)
  const selectedTotal = getStructureSelectionTotal(state.selection_by_category)

  if (state.current_step === 1) {
    return (
      <div className="compare-workspace compare-flow-workspace">
        <div className="compare-page-header">
          <div>
            <strong>结构对比</strong>
            <p>结构对比的源端与目标端选择已经内聚到当前页面，不再依赖数据源页的额外创建链接。</p>
          </div>
          <div className="editor-actions">
            <button
              className="flat-button primary"
              disabled={state.loading || profiles.length === 0}
              type="button"
              onClick={onRunCompare}
            >
              {state.loading ? '比较中...' : '比较结构'}
            </button>
          </div>
        </div>

        <div className="glass-card compare-results-card">
          <div className="section-head">
            <div>
              <h2>步骤 1 / 3</h2>
              <p>直接在当前结构对比页选择源端与目标端数据库，然后进入差异分类勾选。</p>
            </div>
          </div>
          {profiles.length === 0 ? (
            <EmptyNotice title="暂无数据源" text="先新增或导入数据源，再开始结构对比。" />
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
              <div className="form-card compact-form-card compare-form-card">
                <div className="form-grid single-column-grid">
                  <label className="form-item">
                    <span>结构详情并发度</span>
                    <input
                      max={16}
                      min={1}
                      placeholder="留空表示自动，首屏仍保持按需加载"
                      step={1}
                      type="number"
                      value={detailConcurrencyInput}
                      onChange={(event) =>
                        onDetailConcurrencyInputChange(event.target.value)
                      }
                    />
                  </label>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  if (state.current_step === 2) {
    return (
      <div className="compare-workspace compare-flow-workspace">
        <div className="compare-page-header">
          <div>
            <strong>结构对比</strong>
            <p>按新增、修改、删除三类查看结构差异，并对每张表单独控制是否保留在本次结果中。</p>
          </div>
          <div className="editor-actions">
            <button className="flat-button" type="button" onClick={onBackToSourceStep}>
              上一步
            </button>
            <button
              className="flat-button primary"
              disabled={selectedTotal === 0}
              type="button"
              onClick={onGoToSummaryStep}
            >
              下一步
            </button>
          </div>
        </div>

        {state.result ? (
          <>
            <SummaryCards
              items={[
                ['源表数', String(state.result.summary.source_table_count)],
                ['目标表数', String(state.result.summary.target_table_count)],
                [
                  '新增项',
                  `${state.selection_by_category.added.length}/${state.result.summary.added_table_count}`,
                ],
                [
                  '修改项',
                  `${state.selection_by_category.modified.length}/${state.result.summary.modified_table_count}`,
                ],
                [
                  '删除项',
                  `${state.selection_by_category.deleted.length}/${state.result.summary.deleted_table_count}`,
                ],
              ]}
            />

            <div className="glass-card compare-results-card">
              <div className="compare-structure-tabstrip">
                {(['added', 'modified', 'deleted'] as StructureDetailCategory[]).map((category) => {
                  const total = getStructureItemsByCategory(state.result, category).length
                  const selected = state.selection_by_category[category].length

                  return (
                    <div
                      className={`structure-tab-group ${
                        state.active_category === category ? 'active' : ''
                      }`}
                      key={category}
                    >
                      <label className="structure-tab-check">
                        <input
                          checked={total > 0 && selected === total}
                          ref={(element) => {
                            if (!element) {
                              return
                            }
                            element.indeterminate = selected > 0 && selected < total
                          }}
                          type="checkbox"
                          onChange={(event) =>
                            onCategoryToggle(category, event.target.checked)
                          }
                        />
                      </label>
                      <button
                        className={`flat-button ${state.active_category === category ? 'primary' : ''}`}
                        type="button"
                        onClick={() => onCategoryChange(category)}
                      >
                        {getStructureCategoryLabel(category)} {selected}/{total}
                      </button>
                    </div>
                  )
                })}
              </div>

              <div className="section-head">
                <div>
                  <h2>{getStructureCategoryLabel(state.active_category)}</h2>
                  <p>{getStructureCategoryDescription(state.active_category)}</p>
                </div>
              </div>

              <div className="compare-detail-list">
                {activeItems.length === 0 ? (
                  <EmptyNotice title="当前分类为空" text="这一类结构差异本轮未命中。" />
                ) : (
                  activeItems.map((item) => {
                    const detailKey = buildStructureCompareDetailKey(
                      state.active_category,
                      item.table_name,
                    )
                    const expanded = state.expanded_detail_keys.includes(detailKey)
                    const detailState = state.detail_cache[detailKey]

                    return (
                      <div className="compare-detail-item structure-detail-item" key={detailKey}>
                        <div className="structure-row">
                          <label className="structure-row-main">
                            <input
                              checked={state.selection_by_category[state.active_category].includes(
                                item.table_name,
                              )}
                              type="checkbox"
                              onChange={(event) =>
                                onTableToggle(
                                  state.active_category,
                                  item.table_name,
                                  event.target.checked,
                                )
                              }
                            />
                            <span className="structure-row-name">{item.table_name}</span>
                          </label>
                          <button
                            className="flat-button"
                            type="button"
                            onClick={() =>
                              onDetailToggle(state.active_category, item.table_name)
                            }
                          >
                            {detailState?.loading ? '加载中...' : expanded ? '收起详情' : '查看详情'}
                          </button>
                        </div>
                        {expanded ? (
                          <StructureDetailPanel
                            category={state.active_category}
                            detailState={detailState}
                            item={item}
                            onReload={() =>
                              onDetailToggle(state.active_category, item.table_name, true)
                            }
                          />
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </>
        ) : (
          <EmptyNotice title="等待执行结构对比" text="先完成源端与目标端选择。" />
        )}
      </div>
    )
  }

  return (
    <div className="compare-workspace compare-flow-workspace">
      <div className="compare-page-header">
        <div>
          <strong>结构对比</strong>
          <p>当前汇总的是本次保留的结构改动范围，便于继续复核和后续导出 SQL。</p>
        </div>
        <div className="editor-actions">
          <button className="flat-button" type="button" onClick={onBackToDiffStep}>
            返回差异筛选
          </button>
          <button
            className="flat-button"
            disabled={selectedTotal === 0}
            type="button"
            onClick={onExportSql}
          >
            导出结构 SQL
          </button>
          <button className="flat-button primary" type="button" onClick={onRunCompare}>
            重新比较
          </button>
        </div>
      </div>

      {state.result ? (
        <>
          <SummaryCards
            items={[
              ['已选新增表', String(state.selection_by_category.added.length)],
              ['已选修改表', String(state.selection_by_category.modified.length)],
              ['已选删除表', String(state.selection_by_category.deleted.length)],
              ['总耗时', `${state.result.performance.total_elapsed_ms} ms`],
            ]}
          />
          <div className="compare-structure-summary-grid">
            <CompareDifferenceCard
              items={state.selection_by_category.added}
              title="新增项"
            />
            <CompareDifferenceCard
              items={state.selection_by_category.modified}
              title="修改项"
            />
            <CompareDifferenceCard
              items={state.selection_by_category.deleted}
              title="删除项"
            />
          </div>
          <div className="status-panel compare-status-panel">
            <strong>当前库对</strong>
            <span>
              {sourceProfile
                ? `${sourceProfile.data_source_name} / ${compareForm.source_database_name}`
                : compareForm.source_database_name}
              {' -> '}
              {targetProfile
                ? `${targetProfile.data_source_name} / ${compareForm.target_database_name}`
                : compareForm.target_database_name}
            </span>
            <span>已选结构差异共 {selectedTotal} 项</span>
          </div>
        </>
      ) : (
        <div className="empty-workspace compare-empty-workspace">
          <strong>等待执行结构对比</strong>
          <p>先完成结构比较，再在这里汇总本次保留的结构改动。</p>
        </div>
      )}
    </div>
  )
}

function getStructureCategoryLabel(category: StructureDetailCategory) {
  if (category === 'added') {
    return '新增项'
  }
  if (category === 'modified') {
    return '修改项'
  }
  return '删除项'
}

function getStructureCategoryDescription(category: StructureDetailCategory) {
  if (category === 'added') {
    return '这些表仅存在于源库。'
  }
  if (category === 'modified') {
    return '这些表在两端同名，但建表语句存在差异。'
  }
  return '这些表仅存在于目标库。'
}

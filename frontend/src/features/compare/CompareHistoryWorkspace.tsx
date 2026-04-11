import type {
  CompareHistoryItem,
  CompareHistorySummary,
  CompareHistoryType,
} from '../../types'
import { EmptyNotice } from '../../shared/components/EmptyNotice'
import { SummaryCards } from '../../shared/components/SummaryCards'

type CompareHistoryWorkspaceProps = {
  historyItems: CompareHistorySummary[]
  selectedHistorySummary: CompareHistorySummary | null
  selectedHistoryItem: CompareHistoryItem | null
  loadingHistoryDetail: boolean
  historyType: CompareHistoryType
  onSelect: (historyId: number) => void
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function CompareHistoryWorkspace({
  historyItems,
  selectedHistorySummary,
  selectedHistoryItem,
  loadingHistoryDetail,
  historyType,
  onSelect,
}: CompareHistoryWorkspaceProps) {
  const detailBase = selectedHistoryItem ?? selectedHistorySummary

  return (
    <div className="compare-workspace">
      <div className="compare-page-header">
        <div>
          <strong>对比记录</strong>
          <p>查看本地保存的 {historyType === 'data' ? '数据对比' : '结构对比'} 历史记录。</p>
        </div>
      </div>

      <div className="compare-main-grid">
        <div className="glass-card compare-results-card">
          <div className="section-head">
            <div>
              <h2>记录列表</h2>
              <p>点击左侧记录，在右侧查看具体统计和涉及表。</p>
            </div>
          </div>
          <div className="compare-detail-list">
            {historyItems.length === 0 ? (
              <EmptyNotice title="暂无记录" text="完成一次对比后会自动写入本地记录。" />
            ) : (
              historyItems.map((item) => (
                <button
                  className={`compare-list-button ${detailBase?.id === item.id ? 'active' : ''}`}
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                >
                  <strong>{item.source_data_source_name}</strong>
                  <span>
                    {item.source_database} {'->'} {item.target_database}
                  </span>
                  <span>{formatDateTime(item.created_at)}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="glass-card compare-detail-card">
          <div className="section-head">
            <div>
              <h2>记录详情</h2>
              <p>{detailBase ? '展示表范围、统计和耗时信息。' : '请选择一条记录。'}</p>
            </div>
          </div>
          {detailBase ? (
            <div className="compare-detail-list">
              <SummaryCards
                items={
                  detailBase.history_type === 'data'
                    ? [
                        ['已对比表', String(detailBase.compared_tables)],
                        ['INSERT', String(detailBase.insert_count)],
                        ['UPDATE', String(detailBase.update_count)],
                        ['DELETE', String(detailBase.delete_count)],
                      ]
                    : [
                        ['源端表数', String(detailBase.source_table_count)],
                        ['新增表', String(detailBase.structure_added_count)],
                        ['修改表', String(detailBase.structure_modified_count)],
                        ['删除表', String(detailBase.structure_deleted_count)],
                      ]
                }
              />
              <div className="status-panel">
                {detailBase.source_data_source_name} / {detailBase.source_database}
                {' -> '}
                {detailBase.target_data_source_name} / {detailBase.target_database}
              </div>
              <div className="compare-summary-list">
                <span>表范围：{detailBase.table_mode === 'all' ? '全部同名表' : '手动选择'}</span>
                <span>记录时间：{formatDateTime(detailBase.created_at)}</span>
                <span>总耗时：{detailBase.total_elapsed_ms} ms</span>
                <span>涉及表数：{detailBase.total_tables}</span>
              </div>
              {selectedHistoryItem ? (
                <pre className="code-block">
                  {JSON.stringify(selectedHistoryItem.table_detail, null, 2)}
                </pre>
              ) : loadingHistoryDetail ? (
                <div className="status-panel">正在按需加载该条记录的详细表范围与性能阶段信息。</div>
              ) : (
                <div className="status-panel">该记录的详细信息暂不可用。</div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

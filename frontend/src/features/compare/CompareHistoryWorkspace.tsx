import type { CompareHistoryItem, CompareHistoryType } from '../../types'
import { EmptyNotice } from '../../shared/components/EmptyNotice'
import { SummaryCards } from '../../shared/components/SummaryCards'

type CompareHistoryWorkspaceProps = {
  historyItems: CompareHistoryItem[]
  selectedHistoryItem: CompareHistoryItem | null
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
  selectedHistoryItem,
  historyType,
  onSelect,
}: CompareHistoryWorkspaceProps) {
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
                  className={`compare-list-button ${selectedHistoryItem?.id === item.id ? 'active' : ''}`}
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
              <p>{selectedHistoryItem ? '展示表范围、统计和耗时信息。' : '请选择一条记录。'}</p>
            </div>
          </div>
          {selectedHistoryItem ? (
            <div className="compare-detail-list">
              <SummaryCards
                items={
                  selectedHistoryItem.history_type === 'data'
                    ? [
                        ['已对比表', String(selectedHistoryItem.compared_tables)],
                        ['INSERT', String(selectedHistoryItem.insert_count)],
                        ['UPDATE', String(selectedHistoryItem.update_count)],
                        ['DELETE', String(selectedHistoryItem.delete_count)],
                      ]
                    : [
                        ['源端表数', String(selectedHistoryItem.source_table_count)],
                        ['新增表', String(selectedHistoryItem.structure_added_count)],
                        ['修改表', String(selectedHistoryItem.structure_modified_count)],
                        ['删除表', String(selectedHistoryItem.structure_deleted_count)],
                      ]
                }
              />
              <div className="status-panel">
                {selectedHistoryItem.source_data_source_name} / {selectedHistoryItem.source_database}
                {' -> '}
                {selectedHistoryItem.target_data_source_name} / {selectedHistoryItem.target_database}
              </div>
              <div className="compare-summary-list">
                <span>表范围：{selectedHistoryItem.table_mode === 'all' ? '全部同名表' : '手动选择'}</span>
                <span>记录时间：{formatDateTime(selectedHistoryItem.created_at)}</span>
                <span>总耗时：{selectedHistoryItem.performance.total_elapsed_ms} ms</span>
                <span>涉及表数：{selectedHistoryItem.total_tables}</span>
              </div>
              <pre className="code-block">
                {JSON.stringify(selectedHistoryItem.table_detail, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

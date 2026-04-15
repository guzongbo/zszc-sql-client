import { EmptyNotice } from '../../shared/components/EmptyNotice'
import type { DesignTab } from '../workspace/appTypes'
import { commonDataTypes, parseOptionalNumber } from './schema'
import type { TableColumn } from '../../types'

export function DesignEditorView({
  tab,
  onRefresh,
  onAddColumn,
  onDeleteColumns,
  onRestoreColumns,
  onPreview,
  onCommit,
  onToggleAll,
  onToggleOne,
  onTableNameChange,
  onChange,
}: {
  tab: DesignTab
  onRefresh: () => void
  onAddColumn: () => void
  onDeleteColumns: () => void
  onRestoreColumns: () => void
  onPreview: () => void
  onCommit: () => void
  onToggleAll: (checked: boolean) => void
  onToggleOne: (clientId: string, checked: boolean) => void
  onTableNameChange: (tabId: string, value: string) => void
  onChange: (
    tabId: string,
    clientId: string,
    field: keyof TableColumn,
    value: string | boolean | number | null,
  ) => void
}) {
  return (
    <div className="editor-page">
      <div className="editor-header">
        <div>
          <strong>{tab.title}</strong>
          <p>
            {tab.design.mode === 'create'
              ? '新建表会按当前字段定义生成 CREATE TABLE 语句。'
              : '表结构编辑页。仅覆盖原型中的字段定义维度，不扩展索引与外键面板。'}
          </p>
        </div>

        <div className="editor-actions">
          {tab.design.mode === 'edit' ? (
            <button className="flat-button" type="button" onClick={onRefresh}>
              刷新
            </button>
          ) : null}
          <button className="flat-button" type="button" onClick={onAddColumn}>
            新增字段
          </button>
          <button className="flat-button" type="button" onClick={onDeleteColumns}>
            删除字段
          </button>
          <button className="flat-button" type="button" onClick={onRestoreColumns}>
            恢复所选
          </button>
          <button className="flat-button" type="button" onClick={onPreview}>
            预览 SQL
          </button>
          <button className="flat-button primary" type="button" onClick={onCommit}>
            {tab.design.mode === 'create' ? '创建表' : '提交'}
          </button>
        </div>
      </div>

      {tab.design.mode === 'create' ? (
        <div className="form-card compact-form-card">
          <label className="form-item">
            <span>表名</span>
            <input
              value={tab.design.draft_table_name}
              onChange={(event) => onTableNameChange(tab.id, event.target.value)}
              placeholder="请输入新表名称"
            />
          </label>
        </div>
      ) : null}

      {tab.design.error ? (
        <EmptyNotice title="读取表结构失败" text={tab.design.error} />
      ) : null}

      <div className="grid-shell">
        <div className="grid-head structure-grid">
          <label className="grid-cell center-cell">
            <input
              type="checkbox"
              checked={
                tab.design.draft_columns.length > 0 &&
                tab.design.draft_columns.every((column) => column.selected)
              }
              onChange={(event) => onToggleAll(event.target.checked)}
            />
          </label>
          <div className="grid-cell">字段名</div>
          <div className="grid-cell">类型</div>
          <div className="grid-cell">长度</div>
          <div className="grid-cell">小数位</div>
          <div className="grid-cell center-cell">允许空</div>
          <div className="grid-cell center-cell">主键</div>
          <div className="grid-cell center-cell">自增</div>
          <div className="grid-cell">默认值</div>
          <div className="grid-cell">注释</div>
        </div>

        <div className="grid-body">
          {tab.design.draft_columns.map((column) => (
            <div className="grid-row structure-grid" key={column.client_id}>
              <label className="grid-cell center-cell">
                <input
                  type="checkbox"
                  checked={column.selected}
                  onChange={(event) =>
                    onToggleOne(column.client_id, event.target.checked)
                  }
                />
              </label>

              <div className="grid-cell">
                <input
                  className="cell-input"
                  value={column.name}
                  onChange={(event) =>
                    onChange(tab.id, column.client_id, 'name', event.target.value)
                  }
                />
              </div>

              <div className="grid-cell">
                <select
                  className="cell-input"
                  value={column.data_type}
                  onChange={(event) =>
                    onChange(tab.id, column.client_id, 'data_type', event.target.value)
                  }
                >
                  {commonDataTypes.map((dataType) => (
                    <option key={dataType} value={dataType}>
                      {dataType}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid-cell">
                <input
                  className="cell-input"
                  inputMode="numeric"
                  value={column.length ?? ''}
                  onChange={(event) =>
                    onChange(
                      tab.id,
                      column.client_id,
                      'length',
                      parseOptionalNumber(event.target.value),
                    )
                  }
                />
              </div>

              <div className="grid-cell">
                <input
                  className="cell-input"
                  inputMode="numeric"
                  value={column.scale ?? ''}
                  onChange={(event) =>
                    onChange(
                      tab.id,
                      column.client_id,
                      'scale',
                      parseOptionalNumber(event.target.value),
                    )
                  }
                />
              </div>

              <label className="grid-cell center-cell">
                <input
                  type="checkbox"
                  checked={column.nullable}
                  onChange={(event) =>
                    onChange(tab.id, column.client_id, 'nullable', event.target.checked)
                  }
                />
              </label>

              <label className="grid-cell center-cell">
                <input
                  type="checkbox"
                  checked={column.primary_key}
                  onChange={(event) =>
                    onChange(tab.id, column.client_id, 'primary_key', event.target.checked)
                  }
                />
              </label>

              <label className="grid-cell center-cell">
                <input
                  type="checkbox"
                  checked={column.auto_increment}
                  onChange={(event) =>
                    onChange(
                      tab.id,
                      column.client_id,
                      'auto_increment',
                      event.target.checked,
                    )
                  }
                />
              </label>

              <div className="grid-cell">
                <input
                  className="cell-input"
                  value={column.default_value ?? ''}
                  onChange={(event) =>
                    onChange(
                      tab.id,
                      column.client_id,
                      'default_value',
                      event.target.value || null,
                    )
                  }
                />
              </div>

              <div className="grid-cell">
                <input
                  className="cell-input"
                  value={column.comment}
                  onChange={(event) =>
                    onChange(tab.id, column.client_id, 'comment', event.target.value)
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <footer className="page-footer">
        <span>{tab.design.draft_columns.length} 个字段</span>
      </footer>
    </div>
  )
}

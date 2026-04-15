import type { ReactNode, RefObject } from 'react'

import type { OutputLogEntry } from '../../features/workspace/appTypes'

export function OutputDock({
  logs,
  outputBodyRef,
  onClear,
}: {
  logs: OutputLogEntry[]
  outputBodyRef: RefObject<HTMLDivElement | null>
  onClear: () => void
}) {
  return (
    <div className="output-dock">
      <div className="output-dock-header">
        <div className="output-dock-title">
          <strong>输出</strong>
          <span>{logs.length} 条记录</span>
        </div>
        <div className="editor-actions">
          <button className="flat-button" type="button" onClick={onClear}>
            清空
          </button>
        </div>
      </div>

      <div className="output-dock-body" ref={outputBodyRef}>
        {logs.length === 0 ? (
          <div className="output-empty">执行 SQL 或打开数据表后，这里会持续记录对应的 SQL 操作。</div>
        ) : (
          logs.map((log) => (
            <div className={`output-entry output-${log.tone}`} key={log.id}>
              <div className="output-entry-meta">
                <span>[{log.timestamp}]</span>
                <span>{log.scope}&gt;</span>
                <span>{log.message}</span>
              </div>
              {log.sql ? <pre className="output-entry-sql">{log.sql}</pre> : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function WorkspacePanelPlaceholder({
  title,
  description,
  tone = 'default',
}: {
  title: string
  description: string
  tone?: 'default' | 'accent'
}) {
  return (
    <div className={`workspace-panel-placeholder workspace-panel-placeholder-${tone}`}>
      <div className="workspace-panel-placeholder-badge">Layout</div>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  )
}

export function EmptyWorkspace() {
  return <div className="empty-workspace" />
}

export function WorkspaceLoadingState({
  title,
  text,
}: {
  title: string
  text: string
}) {
  return (
    <div className="empty-workspace">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  )
}

export function SquareIconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      className="icon-button"
      disabled={disabled}
      title={label}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function SquareActionButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active?: boolean
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`text-button ${active ? 'active' : ''}`}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function Modal({
  title,
  subtitle,
  children,
  actions,
  onClose,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
  onClose: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <strong>{title}</strong>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">{children}</div>
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>
  )
}

export function CompareSidebar({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="compare-sidebar">
      <div className="pane-header compare-pane-header">
        <div className="pane-title compare-pane-title">
          <DatabaseGlyph />
          <strong>{title}</strong>
        </div>
        <p className="compare-pane-subtitle">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

export function DatabaseGlyph() {
  return (
    <svg className="pane-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="6.5" rx="7" ry="3.5" />
      <path d="M5 6.5v11c0 1.93 3.13 3.5 7 3.5s7-1.57 7-3.5v-11" />
      <path d="M5 12c0 1.93 3.13 3.5 7 3.5s7-1.57 7-3.5" />
    </svg>
  )
}

export function DatabaseSettingsGlyph() {
  return (
    <svg className="settings-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="9" cy="6.5" rx="5" ry="2.5" />
      <path d="M4 6.5V14c0 1.38 2.24 2.5 5 2.5 0.51 0 1-0.04 1.47-0.12" />
      <path d="M4 10.5C4 11.88 6.24 13 9 13" />
      <path d="M17.5 13.25a1.75 1.75 0 0 0-3.5 0v0.17a4.6 4.6 0 0 0-0.95 0.55l-0.15-0.09a1.75 1.75 0 0 0-1.75 3.03l0.15 0.09a4.72 4.72 0 0 0 0 1.1l-0.15 0.09a1.75 1.75 0 1 0 1.75 3.03l0.15-0.09c0.3 0.22 0.62 0.4 0.95 0.55v0.17a1.75 1.75 0 0 0 3.5 0v-0.17c0.33-0.15 0.65-0.33 0.95-0.55l0.15 0.09a1.75 1.75 0 0 0 1.75-3.03l-0.15-0.09a4.72 4.72 0 0 0 0-1.1l0.15-0.09a1.75 1.75 0 1 0-1.75-3.03l-0.15 0.09a4.6 4.6 0 0 0-0.95-0.55z" />
      <circle cx="15.75" cy="17" r="1.6" />
    </svg>
  )
}

export function TreeDatabaseGlyph() {
  return (
    <span className="tree-node-glyph tree-database-glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <ellipse cx="12" cy="6" rx="6.5" ry="3" />
        <path d="M5.5 6v8.5c0 1.66 2.91 3 6.5 3s6.5-1.34 6.5-3V6" />
        <path d="M5.5 10.5c0 1.66 2.91 3 6.5 3s6.5-1.34 6.5-3" />
      </svg>
    </span>
  )
}

export function TreeTableGlyph() {
  return (
    <span className="tree-node-glyph tree-table-glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M4 9h16" />
        <path d="M9 9v10" />
        <path d="M15 9v10" />
        <path d="M4 14h16" />
      </svg>
    </span>
  )
}

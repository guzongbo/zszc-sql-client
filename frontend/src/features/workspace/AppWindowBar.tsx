import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import type { InstalledPlugin } from '../../types'

type PanelToggleItem = {
  key: string
  label: string
  active: boolean
  onClick: () => void
}

type AppWindowBarProps = {
  activeWorkspaceId: string
  activeWorkspaceLabel: string
  databaseWorkspaceId: string
  installedPlugins: InstalledPlugin[]
  onManagePlugins: () => void
  onPointerDown: React.PointerEventHandler<HTMLElement>
  onSelectWorkspace: (workspaceId: string) => void
  onToggleMenu: () => void
  panelToggleItems: PanelToggleItem[]
  redisWorkspaceId: string
  workspaceMenuOpen: boolean
  cpuText: string
  memoryText: string
}

export function AppWindowBar({
  activeWorkspaceId,
  activeWorkspaceLabel,
  databaseWorkspaceId,
  installedPlugins,
  onManagePlugins,
  onPointerDown,
  onSelectWorkspace,
  onToggleMenu,
  panelToggleItems,
  redisWorkspaceId,
  workspaceMenuOpen,
  cpuText,
  memoryText,
}: AppWindowBarProps) {
  return (
    <header className="window-bar" onPointerDown={onPointerDown}>
      <div className="window-bar-content">
        <WorkspaceSwitcher
          activeWorkspaceId={activeWorkspaceId}
          activeWorkspaceLabel={activeWorkspaceLabel}
          databaseWorkspaceId={databaseWorkspaceId}
          installedPlugins={installedPlugins}
          onManagePlugins={onManagePlugins}
          onSelectWorkspace={onSelectWorkspace}
          onToggleMenu={onToggleMenu}
          redisWorkspaceId={redisWorkspaceId}
          workspaceMenuOpen={workspaceMenuOpen}
        />
        <div
          className="window-bar-center"
          aria-label="布局面板开关"
          data-window-drag-ignore="true"
        >
          <div className="panel-visibility-group">
            {panelToggleItems.map((item) => (
              <button
                key={item.key}
                className={`panel-visibility-button ${item.active ? 'active' : ''}`}
                type="button"
                onClick={item.onClick}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="window-bar-metrics" aria-label="运行指标">
          <div className="window-metric-chip">
            <span className="window-metric-label">CPU</span>
            <strong>{cpuText}</strong>
          </div>
          <div className="window-metric-chip">
            <span className="window-metric-label">内存</span>
            <strong>{memoryText}</strong>
          </div>
        </div>
      </div>
    </header>
  )
}

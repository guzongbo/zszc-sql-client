import type { InstalledPlugin } from '../../types'

type WorkspaceSwitcherProps = {
  activeWorkspaceId: string
  activeWorkspaceLabel: string
  databaseWorkspaceId: string
  redisWorkspaceId: string
  installedPlugins: InstalledPlugin[]
  workspaceMenuOpen: boolean
  onManagePlugins: () => void
  onSelectWorkspace: (workspaceId: string) => void
  onToggleMenu: () => void
}

export function WorkspaceSwitcher({
  activeWorkspaceId,
  activeWorkspaceLabel,
  databaseWorkspaceId,
  redisWorkspaceId,
  installedPlugins,
  workspaceMenuOpen,
  onManagePlugins,
  onSelectWorkspace,
  onToggleMenu,
}: WorkspaceSwitcherProps) {
  return (
    <div className="workspace-switcher" onClick={(event) => event.stopPropagation()}>
      <span className="workspace-switcher-label">工作区:</span>
      <button
        aria-expanded={workspaceMenuOpen}
        aria-haspopup="menu"
        className={`workspace-switcher-trigger ${workspaceMenuOpen ? 'open' : ''}`}
        type="button"
        onClick={onToggleMenu}
      >
        <span className="workspace-switcher-name">{activeWorkspaceLabel}</span>
        <span className="workspace-switcher-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {workspaceMenuOpen ? (
        <div className="workspace-menu glass-card" role="menu">
          <div className="workspace-menu-section">
            <div className="workspace-menu-section-title">内置工作区</div>
            <button
              className={`workspace-menu-item ${
                activeWorkspaceId === databaseWorkspaceId ? 'active' : ''
              }`}
              role="menuitem"
              type="button"
              onClick={() => onSelectWorkspace(databaseWorkspaceId)}
            >
              <span>MySQL客户端</span>
              <small>当前主工作区</small>
            </button>
            <button
              className={`workspace-menu-item ${
                activeWorkspaceId === redisWorkspaceId ? 'active' : ''
              }`}
              role="menuitem"
              type="button"
              onClick={() => onSelectWorkspace(redisWorkspaceId)}
            >
              <span>Redis客户端</span>
              <small>内置 Redis 工作区</small>
            </button>
          </div>

          <div className="workspace-menu-section">
            <div className="workspace-menu-section-title">已安装插件</div>
            {installedPlugins.length === 0 ? (
              <div className="workspace-menu-empty">暂无插件，可在下方进入管理页安装</div>
            ) : (
              installedPlugins.map((plugin) => (
                <button
                  className={`workspace-menu-item ${
                    activeWorkspaceId === `plugin:${plugin.id}` ? 'active' : ''
                  }`}
                  key={plugin.id}
                  role="menuitem"
                  type="button"
                  onClick={() => onSelectWorkspace(`plugin:${plugin.id}`)}
                >
                  <span>{plugin.name}</span>
                  <small>{plugin.version}</small>
                </button>
              ))
            )}
          </div>

          <div className="workspace-menu-footer">
            <button
              className="workspace-menu-manage"
              role="menuitem"
              type="button"
              onClick={onManagePlugins}
            >
              管理插件
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

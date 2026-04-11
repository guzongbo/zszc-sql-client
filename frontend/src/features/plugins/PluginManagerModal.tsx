import type { InstalledPlugin } from '../../types'

type PluginManagerModalProps = {
  currentPlatform: string
  installedPlugins: InstalledPlugin[]
  packageExtension: string
  selectedWorkspaceId: string
  busy: boolean
  uninstallingPluginId: string | null
  onClose: () => void
  onInstall: () => Promise<void>
  onOpenPlugin: (pluginId: string) => void
  onUninstallPlugin: (pluginId: string) => Promise<void>
}

export function PluginManagerModal({
  currentPlatform,
  installedPlugins,
  packageExtension,
  selectedWorkspaceId,
  busy,
  uninstallingPluginId,
  onClose,
  onInstall,
  onOpenPlugin,
  onUninstallPlugin,
}: PluginManagerModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card glass-card plugin-manager-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <strong>插件管理</strong>
            <p>当前平台 {currentPlatform}，安装包格式 .{packageExtension}</p>
          </div>
          <button className="flat-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="modal-body plugin-manager-body">
          <div className="plugin-manager-toolbar">
            <div className="status-panel">
              已安装 {installedPlugins.length} 个插件。插件切换会替换顶部栏以下的整个工作区。
            </div>
            <button
              className="flat-button primary"
              disabled={busy}
              type="button"
              onClick={() => void onInstall()}
            >
              {busy ? '安装中...' : '从磁盘安装插件'}
            </button>
          </div>

          {installedPlugins.length === 0 ? (
            <div className="plugin-manager-empty">
              <strong>暂无插件</strong>
              <p>从磁盘选择 .{packageExtension} 安装包后，即可在顶部工作区下拉中切换。</p>
            </div>
          ) : (
            <div className="plugin-manager-list">
              {installedPlugins.map((plugin) => {
                const selected = selectedWorkspaceId === `plugin:${plugin.id}`

                return (
                  <section className="plugin-manager-item" key={plugin.id}>
                    <div className="plugin-manager-item-head">
                      <div>
                        <strong>{plugin.name}</strong>
                        <span className="plugin-manager-version">v{plugin.version}</span>
                      </div>
                      <span className="plugin-manager-badge">
                        {plugin.backend_required ? 'Rust 后端' : '纯前端'}
                      </span>
                    </div>

                    <p className="plugin-manager-description">
                      {plugin.description || '未提供插件描述'}
                    </p>

                    <div className="plugin-manager-meta">
                      <span>ID {plugin.id}</span>
                      <span>权限 {plugin.permissions.join(', ') || '未声明'}</span>
                      <span>支持 {plugin.supported_platforms.join(' / ')}</span>
                    </div>

                    <div className="plugin-manager-actions">
                      <button
                        className={`flat-button ${selected ? 'primary' : ''}`}
                        type="button"
                        onClick={() => onOpenPlugin(plugin.id)}
                      >
                        {selected ? '当前工作区' : '打开工作区'}
                      </button>
                      <button
                        className="flat-button danger"
                        disabled={busy || uninstallingPluginId === plugin.id}
                        type="button"
                        onClick={() => void onUninstallPlugin(plugin.id)}
                      >
                        {uninstallingPluginId === plugin.id ? '卸载中...' : '卸载'}
                      </button>
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { PluginManagerModal } from '../plugins/PluginManagerModal'
import { Modal } from '../../shared/components/AppChrome'
import type {
  ConfirmDialogState,
  CreateDatabaseDialogState,
  ExportDialogState,
  SqlPreviewState,
  ToastItem,
  TreeContextMenuState,
} from './appTypes'
import type {
  DataSourceGroup,
  ExportFileFormat,
  ExportScope,
  InstalledPlugin,
} from '../../types'
import { getExportScopeOptions, getExportScopeText } from './appHelpers'

type AppOverlaysProps = {
  activeWorkspaceId: string
  confirmDialog: ConfirmDialogState | null
  createDatabaseDialog: CreateDatabaseDialogState | null
  currentPlatform: string
  dataSourceGroups: DataSourceGroup[]
  ddlDialog: { title: string; ddl: string } | null
  exportDialog: ExportDialogState | null
  installedPlugins: InstalledPlugin[]
  packageExtension: string
  pluginManagerBusy: boolean
  pluginManagerVisible: boolean
  sqlPreview: SqlPreviewState | null
  toasts: ToastItem[]
  treeContextMenu: TreeContextMenuState | null
  uninstallingPluginId: string | null
  onCloseConfirmDialog: () => void
  onCloseCreateDatabaseDialog: () => void
  onCloseDdlDialog: () => void
  onCloseExportDialog: () => void
  onClosePluginManager: () => void
  onCloseSqlPreview: () => void
  onCloseTreeContextMenu: () => void
  onConfirmExportDialog: () => void
  onConfirmSqlPreview: () => void
  onConfirmUnimplementedAction: (title: string, body: string) => void
  onCopyExportDialogSql: () => void
  onInstallPlugin: () => Promise<void>
  onOpenCreateDatabaseDialog: (profileId: string) => void
  onOpenCreateTableTab: (profileId: string, databaseName: string) => void
  onOpenGroupAssignmentTab: (group: DataSourceGroup) => void
  onOpenPluginWorkspace: (pluginId: string) => void
  onOpenTableData: (profileId: string, databaseName: string, tableName: string) => void
  onOpenTableDesign: (profileId: string, databaseName: string, tableName: string) => void
  onOpenTableDdl: (profileId: string, databaseName: string, tableName: string) => void
  onOpenTableExportDialog: (
    profileId: string,
    databaseName: string,
    tableName: string,
  ) => void
  onUninstallPlugin: (pluginId: string) => Promise<void>
  onUpdateCreateDatabaseField: (value: string) => void
  onUpdateExportDialogFormat: (format: ExportFileFormat) => void
  onUpdateExportDialogScope: (scope: ExportScope) => void
  onSaveCreateDatabaseDialog: () => void
  onShowToast: (message: string, tone: ToastItem['tone']) => void
}

export function AppOverlays({
  activeWorkspaceId,
  confirmDialog,
  createDatabaseDialog,
  currentPlatform,
  dataSourceGroups,
  ddlDialog,
  exportDialog,
  installedPlugins,
  packageExtension,
  pluginManagerBusy,
  pluginManagerVisible,
  sqlPreview,
  toasts,
  treeContextMenu,
  uninstallingPluginId,
  onCloseConfirmDialog,
  onCloseCreateDatabaseDialog,
  onCloseDdlDialog,
  onCloseExportDialog,
  onClosePluginManager,
  onCloseSqlPreview,
  onCloseTreeContextMenu,
  onConfirmExportDialog,
  onConfirmSqlPreview,
  onConfirmUnimplementedAction,
  onCopyExportDialogSql,
  onInstallPlugin,
  onOpenCreateDatabaseDialog,
  onOpenCreateTableTab,
  onOpenGroupAssignmentTab,
  onOpenPluginWorkspace,
  onOpenTableData,
  onOpenTableDesign,
  onOpenTableDdl,
  onOpenTableExportDialog,
  onUninstallPlugin,
  onUpdateCreateDatabaseField,
  onUpdateExportDialogFormat,
  onUpdateExportDialogScope,
  onSaveCreateDatabaseDialog,
  onShowToast,
}: AppOverlaysProps) {
  return (
    <>
      {pluginManagerVisible ? (
        <PluginManagerModal
          currentPlatform={currentPlatform}
          installedPlugins={installedPlugins}
          packageExtension={packageExtension}
          selectedWorkspaceId={activeWorkspaceId}
          busy={pluginManagerBusy}
          uninstallingPluginId={uninstallingPluginId}
          onClose={onClosePluginManager}
          onInstall={onInstallPlugin}
          onOpenPlugin={(pluginId) => {
            onOpenPluginWorkspace(pluginId)
            onClosePluginManager()
          }}
          onUninstallPlugin={onUninstallPlugin}
        />
      ) : null}

      {ddlDialog ? (
        <Modal
          title={ddlDialog.title}
          subtitle="当前表的 CREATE TABLE 语句"
          onClose={onCloseDdlDialog}
          actions={
            <button className="flat-button primary" type="button" onClick={onCloseDdlDialog}>
              关闭
            </button>
          }
        >
          <pre className="code-block">{ddlDialog.ddl}</pre>
        </Modal>
      ) : null}

      {sqlPreview ? (
        <Modal
          title={sqlPreview.title}
          subtitle="提交前请确认待执行 SQL"
          onClose={() => {
            if (!sqlPreview.busy) {
              onCloseSqlPreview()
            }
          }}
          actions={
            <>
              <button
                className="flat-button"
                disabled={sqlPreview.busy}
                type="button"
                onClick={onCloseSqlPreview}
              >
                取消
              </button>
              {sqlPreview.confirm_label && sqlPreview.on_confirm ? (
                <button
                  className="flat-button primary"
                  disabled={sqlPreview.busy}
                  type="button"
                  onClick={onConfirmSqlPreview}
                >
                  {sqlPreview.busy ? '处理中...' : sqlPreview.confirm_label}
                </button>
              ) : null}
            </>
          }
        >
          <pre className="code-block">{sqlPreview.statements.join('\n\n')}</pre>
        </Modal>
      ) : null}

      {exportDialog ? (
        <Modal
          title={exportDialog.title}
          subtitle={exportDialog.subtitle}
          onClose={() => {
            if (!exportDialog.busy) {
              onCloseExportDialog()
            }
          }}
          actions={
            <>
              <button
                className="flat-button"
                disabled={exportDialog.busy}
                type="button"
                onClick={onCloseExportDialog}
              >
                取消
              </button>
              {exportDialog.format === 'sql' ? (
                <button
                  className="flat-button"
                  disabled={exportDialog.busy}
                  type="button"
                  onClick={onCopyExportDialogSql}
                >
                  {exportDialog.busy ? '处理中...' : '复制到剪贴板'}
                </button>
              ) : null}
              <button
                className="flat-button primary"
                disabled={exportDialog.busy}
                type="button"
                onClick={onConfirmExportDialog}
              >
                {exportDialog.busy ? '处理中...' : '下载文件'}
              </button>
            </>
          }
        >
          <div className="form-card compact-form-card export-dialog-card">
            <label className="form-item">
              <span>导出格式</span>
              <select
                value={exportDialog.format}
                disabled={exportDialog.busy}
                onChange={(event) =>
                  onUpdateExportDialogFormat(event.target.value as ExportFileFormat)
                }
              >
                <option value="csv">CSV</option>
                <option value="sql">SQL</option>
                {exportDialog.kind === 'query_result' ? (
                  <option value="json">JSON</option>
                ) : null}
              </select>
            </label>

            <div className="form-item">
              <span>导出范围</span>
              <div className="export-scope-list">
                {getExportScopeOptions(exportDialog).map((option) => (
                  <label
                    className={`export-scope-item ${option.disabled ? 'disabled' : ''}`}
                    key={option.value}
                  >
                    <input
                      checked={exportDialog.scope === option.value}
                      disabled={exportDialog.busy || option.disabled}
                      name="export_scope"
                      type="radio"
                      value={option.value}
                      onChange={() => onUpdateExportDialogScope(option.value)}
                    />
                    <div className="export-scope-copy">
                      <strong>{option.label}</strong>
                      <p>{option.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="status-panel export-summary">
              当前将以 {exportDialog.format.toUpperCase()} 格式导出
              {getExportScopeText(exportDialog)}。
              {exportDialog.format === 'sql'
                ? ' 可直接下载文件，也可复制到剪贴板。'
                : null}
            </div>
          </div>
        </Modal>
      ) : null}

      {createDatabaseDialog ? (
        <Modal
          title="新增数据库"
          subtitle={`当前数据源：${createDatabaseDialog.data_source_name}`}
          onClose={() => {
            if (!createDatabaseDialog.busy) {
              onCloseCreateDatabaseDialog()
            }
          }}
          actions={
            <>
              <button
                className="flat-button"
                disabled={createDatabaseDialog.busy}
                type="button"
                onClick={onCloseCreateDatabaseDialog}
              >
                取消
              </button>
              <button
                className="flat-button primary"
                disabled={createDatabaseDialog.busy}
                type="button"
                onClick={onSaveCreateDatabaseDialog}
              >
                {createDatabaseDialog.busy ? '创建中...' : '确认创建'}
              </button>
            </>
          }
        >
          <div className="form-card compact-form-card">
            <label className="form-item">
              <span>数据库名</span>
              <input
                autoFocus
                value={createDatabaseDialog.form.database_name}
                onChange={(event) => onUpdateCreateDatabaseField(event.target.value)}
                placeholder="请输入数据库名"
              />
            </label>
          </div>
        </Modal>
      ) : null}

      {confirmDialog ? (
        <Modal
          title={confirmDialog.title}
          subtitle={confirmDialog.body}
          onClose={() => {
            if (!confirmDialog.busy) {
              onCloseConfirmDialog()
            }
          }}
          actions={
            <>
              <button
                className="flat-button"
                disabled={confirmDialog.busy}
                type="button"
                onClick={onCloseConfirmDialog}
              >
                取消
              </button>
              <button
                className="flat-button primary"
                disabled={confirmDialog.busy}
                type="button"
                onClick={() => void confirmDialog.on_confirm()}
              >
                {confirmDialog.busy ? '处理中...' : confirmDialog.confirm_label}
              </button>
            </>
          }
        >
          <div className="status-panel">{confirmDialog.body}</div>
        </Modal>
      ) : null}

      {treeContextMenu ? (
        <div
          className="context-menu"
          role="menu"
          style={{ left: treeContextMenu.x, top: treeContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {treeContextMenu.kind === 'group' ? (
            <button
              className="context-menu-item"
              type="button"
              onClick={() => {
                const targetGroup = dataSourceGroups.find(
                  (group) => group.id === treeContextMenu.group_id,
                )
                if (targetGroup) {
                  onOpenGroupAssignmentTab(targetGroup)
                } else {
                  onShowToast('目标分组不存在', 'error')
                }
                onCloseTreeContextMenu()
              }}
            >
              添加数据源到分组
            </button>
          ) : null}

          {treeContextMenu.kind === 'profile' ? (
            <button
              className="context-menu-item"
              type="button"
              onClick={() => {
                onOpenCreateDatabaseDialog(treeContextMenu.profile_id)
                onCloseTreeContextMenu()
              }}
            >
              新增数据库
            </button>
          ) : null}

          {treeContextMenu.kind === 'database' ? (
            <button
              className="context-menu-item"
              type="button"
              onClick={() => {
                onOpenCreateTableTab(
                  treeContextMenu.profile_id,
                  treeContextMenu.database_name,
                )
                onCloseTreeContextMenu()
              }}
            >
              新增表
            </button>
          ) : null}

          {treeContextMenu.kind === 'table' ? (
            <>
              <button
                className="context-menu-item"
                type="button"
                onClick={() => {
                  onOpenTableData(
                    treeContextMenu.profile_id,
                    treeContextMenu.database_name,
                    treeContextMenu.table_name,
                  )
                  onCloseTreeContextMenu()
                }}
              >
                修改表数据
              </button>
              <button
                className="context-menu-item"
                type="button"
                onClick={() => {
                  onOpenTableDesign(
                    treeContextMenu.profile_id,
                    treeContextMenu.database_name,
                    treeContextMenu.table_name,
                  )
                  onCloseTreeContextMenu()
                }}
              >
                修改表结构
              </button>
              <button
                className="context-menu-item"
                type="button"
                onClick={() => {
                  onOpenTableDdl(
                    treeContextMenu.profile_id,
                    treeContextMenu.database_name,
                    treeContextMenu.table_name,
                  )
                  onCloseTreeContextMenu()
                }}
              >
                查看 DDL
              </button>
              <button
                className="context-menu-item"
                type="button"
                onClick={() => {
                  onConfirmUnimplementedAction(
                    '复制表',
                    `确认复制表 ${treeContextMenu.database_name}.${treeContextMenu.table_name} 吗？`,
                  )
                  onCloseTreeContextMenu()
                }}
              >
                复制表
              </button>
              <button
                className="context-menu-item"
                type="button"
                onClick={() => {
                  onOpenTableExportDialog(
                    treeContextMenu.profile_id,
                    treeContextMenu.database_name,
                    treeContextMenu.table_name,
                  )
                  onCloseTreeContextMenu()
                }}
              >
                导出表
              </button>
              <button
                className="context-menu-item danger"
                type="button"
                onClick={() => {
                  onConfirmUnimplementedAction(
                    '删除表',
                    `确认删除表 ${treeContextMenu.database_name}.${treeContextMenu.table_name} 吗？`,
                  )
                  onCloseTreeContextMenu()
                }}
              >
                删除表
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div className={`toast toast-${toast.tone}`} key={toast.id}>
            {toast.message}
          </div>
        ))}
      </div>
    </>
  )
}

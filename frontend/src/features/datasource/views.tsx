import type {
  GroupAssignmentTab,
  ProfileTab,
} from '../workspace/appTypes'
import { normalizeGroupName } from '../workspace/navigation'
import type {
  DataSourceGroup,
  SaveConnectionProfilePayload,
} from '../../types'

export function GroupAssignmentView({
  tab,
  profiles,
  dataSourceGroups,
  onFilterChange,
  onToggleProfile,
  onSelectAll,
  onClearSelection,
  onApply,
}: {
  tab: GroupAssignmentTab
  profiles: Array<{
    id: string
    group_name: string | null
    data_source_name: string
    host: string
    port: number
  }>
  dataSourceGroups: DataSourceGroup[]
  onFilterChange: (tabId: string, value: string) => void
  onToggleProfile: (tabId: string, profileId: string, checked: boolean) => void
  onSelectAll: (tabId: string, profileIds: string[]) => void
  onClearSelection: (tabId: string) => void
  onApply: (tab: GroupAssignmentTab) => Promise<void>
}) {
  const targetGroup =
    dataSourceGroups.find((group) => group.id === tab.assignment.target_group_id) ?? null
  const selectedProfileIdSet = new Set(tab.assignment.selected_profile_ids)
  const validSelectedCount = profiles.filter((profile) =>
    selectedProfileIdSet.has(profile.id),
  ).length
  const filterText = tab.assignment.filter_text.trim().toLowerCase()
  const filteredProfiles = profiles.filter((profile) => {
    if (!filterText) {
      return true
    }

    const currentGroupName = normalizeGroupName(profile.group_name)
    return [
      profile.data_source_name,
      profile.host,
      `${profile.host}:${profile.port}`,
      currentGroupName,
    ].some((value) => value.toLowerCase().includes(filterText))
  })
  const filteredProfileIds = filteredProfiles.map((profile) => profile.id)
  const allFilteredSelected =
    filteredProfiles.length > 0 &&
    filteredProfiles.every((profile) => selectedProfileIdSet.has(profile.id))

  return (
    <div className="editor-page group-assignment-page">
      <div className="editor-header">
        <div>
          <strong>{targetGroup ? `添加数据源到 ${targetGroup.group_name} 分组` : '分组归类'}</strong>
          <p>右侧展示全部数据源和当前所属分组。勾选后可一次性加入当前目标分组。</p>
        </div>

        <div className="editor-actions">
          <button
            className="flat-button"
            disabled={filteredProfiles.length === 0 || allFilteredSelected || tab.assignment.submitting}
            type="button"
            onClick={() => onSelectAll(tab.id, filteredProfileIds)}
          >
            全选当前列表
          </button>
          <button
            className="flat-button"
            disabled={validSelectedCount === 0 || tab.assignment.submitting}
            type="button"
            onClick={() => onClearSelection(tab.id)}
          >
            清空选择
          </button>
        </div>
      </div>

      <div className="form-card">
        <div className="group-assignment-toolbar">
          <label className="form-item">
            <span>筛选数据源</span>
            <input
              value={tab.assignment.filter_text}
              onChange={(event) => onFilterChange(tab.id, event.target.value)}
              placeholder="按数据源名称、主机或当前分组筛选"
            />
          </label>

          <div className="group-assignment-summary">
            <span>目标分组</span>
            <strong>{targetGroup?.group_name ?? '分组不存在'}</strong>
            <small>当前共 {profiles.length} 个数据源，已选择 {validSelectedCount} 个</small>
          </div>
        </div>
      </div>

      {tab.error ? <div className="status-panel warning">{tab.error}</div> : null}

      <div className="form-card group-assignment-card">
        <div className="group-assignment-list">
          {filteredProfiles.length === 0 ? (
            <div className="group-manager-empty">暂无匹配的数据源。</div>
          ) : (
            filteredProfiles.map((profile) => {
              const checked = selectedProfileIdSet.has(profile.id)

              return (
                <label
                  className={`group-assignment-row ${checked ? 'selected' : ''}`}
                  key={profile.id}
                >
                  <input
                    checked={checked}
                    disabled={tab.assignment.submitting}
                    type="checkbox"
                    onChange={(event) =>
                      onToggleProfile(tab.id, profile.id, event.target.checked)
                    }
                  />

                  <div className="group-assignment-main">
                    <strong>{profile.data_source_name}</strong>
                    <span>
                      {profile.host}:{profile.port}
                    </span>
                  </div>

                  <div className="group-assignment-meta">
                    <span>当前分组</span>
                    <strong>{normalizeGroupName(profile.group_name)}</strong>
                  </div>
                </label>
              )
            })
          )}
        </div>

        <div className="group-assignment-footer">
          <span>勾选后会覆盖所选数据源原有的分组归属。</span>
          <button
            className="flat-button primary"
            disabled={!targetGroup || validSelectedCount === 0 || tab.assignment.submitting}
            type="button"
            onClick={() => void onApply(tab)}
          >
            {tab.assignment.submitting
              ? '处理中...'
              : `添加 ${validSelectedCount} 个数据源到 ${targetGroup?.group_name ?? ''} 分组`}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ProfileEditorView({
  tab,
  dataSourceGroups,
  onFieldChange,
  onToggleGroupManager,
  onCreateGroupNameChange,
  onCreateGroup,
  onStartRenameGroup,
  onCancelRenameGroup,
  onEditingGroupNameChange,
  onRenameGroup,
  onDeleteGroup,
  onImportNavicat,
  onSave,
  onTest,
  onDelete,
}: {
  tab: ProfileTab
  dataSourceGroups: DataSourceGroup[]
  onFieldChange: (
    tabId: string,
    field: keyof SaveConnectionProfilePayload,
    value: string | number | null,
  ) => void
  onToggleGroupManager: (tabId: string) => void
  onCreateGroupNameChange: (tabId: string, value: string) => void
  onCreateGroup: (tab: ProfileTab) => Promise<void>
  onStartRenameGroup: (tabId: string, group: DataSourceGroup) => void
  onCancelRenameGroup: (tabId: string) => void
  onEditingGroupNameChange: (tabId: string, value: string) => void
  onRenameGroup: (tab: ProfileTab) => Promise<void>
  onDeleteGroup: (tab: ProfileTab, group: DataSourceGroup) => Promise<void>
  onImportNavicat: () => void
  onSave: (tab: ProfileTab) => Promise<void>
  onTest: (tab: ProfileTab) => Promise<void>
  onDelete: (tab: ProfileTab) => Promise<void>
}) {
  return (
    <div className="editor-page">
      <div className="editor-header">
        <div>
          <strong>{tab.editor.mode === 'create' ? '新增数据源' : '编辑数据源'}</strong>
          <p>在这里直接选择分组或维护分组目录。整个结构为：分组 - 数据源 - 数据库 - 表。</p>
        </div>

        <div className="editor-actions">
          {tab.editor.mode === 'create' ? (
            <button className="flat-button" type="button" onClick={onImportNavicat}>
              导入 Navicat
            </button>
          ) : null}
          {tab.editor.mode === 'edit' ? (
            <button className="flat-button danger" type="button" onClick={() => void onDelete(tab)}>
              删除
            </button>
          ) : null}
          <button
            className="flat-button"
            disabled={tab.editor.testing || tab.editor.saving}
            type="button"
            onClick={() => void onTest(tab)}
          >
            {tab.editor.testing ? '测试中...' : '测试连接'}
          </button>
          <button
            className="flat-button primary"
            disabled={tab.editor.testing || tab.editor.saving}
            type="button"
            onClick={() => void onSave(tab)}
          >
            {tab.editor.saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      <div className="form-card">
        <div className="form-grid">
          <div className="form-item form-item-span-2">
            <span>所属分组</span>
            <div className="group-select-row">
              <select
                value={tab.editor.form.group_name ?? ''}
                onChange={(event) =>
                  onFieldChange(tab.id, 'group_name', event.target.value || null)
                }
              >
                <option value="">未分组</option>
                {dataSourceGroups.map((group) => (
                  <option key={group.id} value={group.group_name}>
                    {group.group_name}
                  </option>
                ))}
              </select>
              <button
                className="flat-button"
                disabled={tab.editor.group_busy}
                type="button"
                onClick={() => onToggleGroupManager(tab.id)}
              >
                {tab.editor.group_manager_open ? '收起分组维护' : '维护分组'}
              </button>
            </div>
            <small className="form-hint">
              新增数据源时可直接下拉选组；没有合适分组时，在这里新增即可。
            </small>
          </div>

          <label className="form-item">
            <span>数据源名称</span>
            <input
              value={tab.editor.form.data_source_name}
              onChange={(event) =>
                onFieldChange(tab.id, 'data_source_name', event.target.value)
              }
              placeholder="例如：采购生产库"
            />
          </label>

          <label className="form-item">
            <span>主机</span>
            <input
              value={tab.editor.form.host}
              onChange={(event) => onFieldChange(tab.id, 'host', event.target.value)}
              placeholder="例如：10.20.8.12"
            />
          </label>

          <label className="form-item">
            <span>端口</span>
            <input
              inputMode="numeric"
              value={tab.editor.form.port}
              onChange={(event) =>
                onFieldChange(
                  tab.id,
                  'port',
                  Number.parseInt(event.target.value || '3306', 10),
                )
              }
              placeholder="3306"
            />
          </label>

          <label className="form-item">
            <span>用户名</span>
            <input
              value={tab.editor.form.username}
              onChange={(event) => onFieldChange(tab.id, 'username', event.target.value)}
              placeholder="root"
            />
          </label>

          <label className="form-item">
            <span>密码</span>
            <input
              type="password"
              value={tab.editor.form.password}
              onChange={(event) => onFieldChange(tab.id, 'password', event.target.value)}
              placeholder={
                tab.editor.mode === 'edit' ? '留空表示保持当前密码' : '请输入密码'
              }
            />
            <small className="form-hint">
              {tab.editor.mode === 'edit'
                ? '编辑已有数据源时，留空会继续使用本地已保存密码；只有输入新值时才会更新。'
                : '首次保存时必须输入密码。'}
            </small>
          </label>
        </div>

        {tab.editor.group_manager_open ? (
          <div className="group-manager-card">
            <div className="group-manager-header">
              <div>
                <strong>分组维护</strong>
                <p>删除分组后，已有数据源会自动回到“未分组”。</p>
              </div>
            </div>

            <div className="group-manager-create">
              <input
                value={tab.editor.create_group_name}
                onChange={(event) => onCreateGroupNameChange(tab.id, event.target.value)}
                placeholder="输入新的分组名称"
              />
              <button
                className="flat-button primary"
                disabled={tab.editor.group_busy}
                type="button"
                onClick={() => void onCreateGroup(tab)}
              >
                {tab.editor.group_busy ? '处理中...' : '新增分组'}
              </button>
            </div>

            <div className="group-manager-list">
              {dataSourceGroups.length === 0 ? (
                <div className="group-manager-empty">
                  暂无分组，新增后即可在上方下拉框中选择。
                </div>
              ) : (
                dataSourceGroups.map((group) => {
                  const editing = tab.editor.editing_group_id === group.id
                  return (
                    <div className="group-manager-row" key={group.id}>
                      {editing ? (
                        <>
                          <input
                            value={tab.editor.editing_group_name}
                            onChange={(event) =>
                              onEditingGroupNameChange(tab.id, event.target.value)
                            }
                            placeholder="请输入分组名称"
                          />
                          <button
                            className="flat-button primary"
                            disabled={tab.editor.group_busy}
                            type="button"
                            onClick={() => void onRenameGroup(tab)}
                          >
                            保存
                          </button>
                          <button
                            className="flat-button"
                            disabled={tab.editor.group_busy}
                            type="button"
                            onClick={() => onCancelRenameGroup(tab.id)}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="group-manager-name">{group.group_name}</div>
                          <div className="group-manager-actions">
                            <button
                              className="flat-button"
                              disabled={tab.editor.group_busy}
                              type="button"
                              onClick={() => onStartRenameGroup(tab.id, group)}
                            >
                              重命名
                            </button>
                            <button
                              className="flat-button danger"
                              disabled={tab.editor.group_busy}
                              type="button"
                              onClick={() => void onDeleteGroup(tab, group)}
                            >
                              删除
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ) : null}

        {tab.editor.test_result ? (
          <div className="status-panel">{tab.editor.test_result}</div>
        ) : null}
      </div>
    </div>
  )
}

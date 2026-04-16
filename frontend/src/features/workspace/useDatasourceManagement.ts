import { useState, type Dispatch, type SetStateAction } from 'react'
import {
  assignProfilesToDataSourceGroup,
  createDataSourceGroup,
  createDatabase,
  deleteConnectionProfile,
  deleteDataSourceGroup,
  disconnectConnectionProfile,
  getAppBootstrap,
  importNavicatConnectionProfiles,
  renameDataSourceGroup,
  saveConnectionProfile,
  testConnectionProfile,
} from '../../api'
import type {
  AppBootstrap,
  AssignProfilesToDataSourceGroupResult,
  ConnectionProfile,
  DataSourceGroup,
  SaveConnectionProfilePayload,
} from '../../types'
import {
  createGroupAssignmentState,
  createProfileEditorState,
  defaultConnectionForm,
  type CreateDatabaseDialogState,
  type GroupAssignmentTab,
  type ProfileEditorState,
  type ProfileTab,
  type SelectionState,
  type ToastTone,
  type WorkspaceTab,
} from './appTypes'
import {
  expandAncestorsForProfile,
  normalizeGroupName,
  normalizeProfileForm,
  profileToForm,
  sortDataSourceGroups,
  sortProfiles,
  upsertProfile,
} from './navigation'
import { quoteIdentifier } from './appHelpers'

type UseDatasourceManagementOptions = {
  appendOutputLog: (
    scope: string,
    message: string,
    tone?: ToastTone,
    sql?: string,
  ) => void
  clearExpandedKeys: () => void
  clearProfileCaches: (profileId: string) => void
  clearSqlAutocompleteCache: (profileId: string, databaseName?: string) => void
  dataSourceGroups: DataSourceGroup[]
  ensureDatabasesLoaded: (
    profileId: string,
    options?: { silent?: boolean; force?: boolean },
  ) => Promise<unknown>
  patchTab: (tabId: string, updater: (tab: WorkspaceTab) => WorkspaceTab) => void
  profiles: ConnectionProfile[]
  pushToast: (message: string, tone: ToastTone) => void
  removeTab: (tabId: string) => void
  replaceTab: (tabId: string, nextTab: WorkspaceTab) => void
  setActiveTabId: Dispatch<SetStateAction<string>>
  setBootstrap: Dispatch<SetStateAction<AppBootstrap | null>>
  setDataSourceGroups: Dispatch<SetStateAction<DataSourceGroup[]>>
  setExpandedKeys: Dispatch<SetStateAction<Set<string>>>
  setProfileConnectionStatus: (
    profileId: string,
    status: 'idle' | 'connected' | 'error' | null,
  ) => void
  setProfiles: Dispatch<SetStateAction<ConnectionProfile[]>>
  setSelectedGroupKey: Dispatch<SetStateAction<string>>
  setSelection: Dispatch<SetStateAction<SelectionState>>
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>
  upsertTab: (nextTab: WorkspaceTab) => void
}

export function useDatasourceManagement({
  appendOutputLog,
  clearExpandedKeys,
  clearProfileCaches,
  clearSqlAutocompleteCache,
  dataSourceGroups,
  ensureDatabasesLoaded,
  patchTab,
  profiles,
  pushToast,
  removeTab,
  replaceTab,
  setActiveTabId,
  setBootstrap,
  setDataSourceGroups,
  setExpandedKeys,
  setProfileConnectionStatus,
  setProfiles,
  setSelectedGroupKey,
  setSelection,
  setTabs,
  upsertTab,
}: UseDatasourceManagementOptions) {
  const [createDatabaseDialog, setCreateDatabaseDialog] =
    useState<CreateDatabaseDialogState | null>(null)

  function openGroupAssignmentTab(group: DataSourceGroup) {
    upsertTab({
      id: `group-assignment:${group.id}`,
      kind: 'group_assignment',
      title: `分组归类 · ${group.group_name}`,
      subtitle: '勾选数据源后批量加入当前分组',
      status: 'ready',
      error: '',
      assignment: createGroupAssignmentState(group.id),
    })
  }

  function updateGroupAssignmentFilter(tabId: string, value: string) {
    patchTab(tabId, (tab) =>
      tab.kind === 'group_assignment'
        ? {
            ...tab,
            assignment: {
              ...tab.assignment,
              filter_text: value,
            },
          }
        : tab,
    )
  }

  function toggleGroupAssignmentProfile(tabId: string, profileId: string, checked: boolean) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'group_assignment') {
        return tab
      }

      const selected = new Set(tab.assignment.selected_profile_ids)
      if (checked) {
        selected.add(profileId)
      } else {
        selected.delete(profileId)
      }

      return {
        ...tab,
        assignment: {
          ...tab.assignment,
          selected_profile_ids: Array.from(selected),
        },
      }
    })
  }

  function selectAllGroupAssignmentProfiles(tabId: string, profileIds: string[]) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'group_assignment') {
        return tab
      }

      const selected = new Set(tab.assignment.selected_profile_ids)
      profileIds.forEach((profileId) => selected.add(profileId))
      return {
        ...tab,
        assignment: {
          ...tab.assignment,
          selected_profile_ids: Array.from(selected),
        },
      }
    })
  }

  function clearGroupAssignmentSelection(tabId: string) {
    patchTab(tabId, (tab) =>
      tab.kind === 'group_assignment'
        ? {
            ...tab,
            assignment: {
              ...tab.assignment,
              selected_profile_ids: [],
            },
          }
        : tab,
    )
  }

  async function importNavicatProfiles() {
    try {
      const result = await importNavicatConnectionProfiles()
      if (result.canceled) {
        return
      }

      const payload = await getAppBootstrap()
      const nextProfiles = sortProfiles(payload.connection_profiles)
      setBootstrap(payload)
      setProfiles(nextProfiles)
      setDataSourceGroups(sortDataSourceGroups(payload.data_source_groups))
      clearExpandedKeys()

      pushToast(
        `Navicat 导入完成：新增 ${result.created_count}，更新 ${result.updated_count}，跳过 ${result.skipped_count}`,
        'success',
      )
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '导入 Navicat 失败', 'error')
    }
  }

  function openProfileEditorTab(profile?: ConnectionProfile) {
    const tabId = profile ? `profile:${profile.id}` : 'profile:create'

    upsertTab({
      id: tabId,
      kind: 'profile',
      title: profile ? `数据源 · ${profile.data_source_name}` : '新增数据源',
      subtitle: profile ? `${profile.host}:${profile.port}` : '在右侧编辑后保存',
      status: 'ready',
      error: '',
      editor: createProfileEditorState(
        profile ? 'edit' : 'create',
        profile ? profileToForm(profile) : { ...defaultConnectionForm },
      ),
    })
  }

  function openCreateDatabaseDialog(profileId: string) {
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) {
      pushToast('当前数据源不存在', 'error')
      return
    }

    setCreateDatabaseDialog({
      profile_id: profileId,
      data_source_name: profile.data_source_name,
      form: {
        profile_id: profileId,
        database_name: '',
      },
      busy: false,
    })
  }

  function updateProfileTabField(
    tabId: string,
    field: keyof SaveConnectionProfilePayload,
    value: string | number | null,
  ) {
    patchTab(tabId, (tab) => {
      if (tab.kind !== 'profile') {
        return tab
      }

      return {
        ...tab,
        editor: {
          ...tab.editor,
          test_result: '',
          form: {
            ...tab.editor.form,
            [field]: value,
          },
        },
      }
    })
  }

  function patchProfileEditor(
    tabId: string,
    updater: (editor: ProfileEditorState) => ProfileEditorState,
  ) {
    patchTab(tabId, (tab) =>
      tab.kind === 'profile'
        ? {
            ...tab,
            editor: updater(tab.editor),
          }
        : tab,
    )
  }

  function toggleProfileGroupManager(tabId: string) {
    patchProfileEditor(tabId, (editor) => ({
      ...editor,
      group_manager_open: !editor.group_manager_open,
      editing_group_id: null,
      editing_group_name: '',
    }))
  }

  function updateProfileGroupCreateName(tabId: string, value: string) {
    patchProfileEditor(tabId, (editor) => ({
      ...editor,
      create_group_name: value,
    }))
  }

  function startRenameProfileGroup(tabId: string, group: DataSourceGroup) {
    patchProfileEditor(tabId, (editor) => ({
      ...editor,
      editing_group_id: group.id,
      editing_group_name: group.group_name,
    }))
  }

  function cancelRenameProfileGroup(tabId: string) {
    patchProfileEditor(tabId, (editor) => ({
      ...editor,
      editing_group_id: null,
      editing_group_name: '',
    }))
  }

  function updateProfileEditingGroupName(tabId: string, value: string) {
    patchProfileEditor(tabId, (editor) => ({
      ...editor,
      editing_group_name: value,
    }))
  }

  function syncGroupNameAcrossState(
    previousGroupName: string,
    nextGroupName: string | null,
  ) {
    setProfiles((previous) =>
      sortProfiles(
        previous.map((profile) =>
          profile.group_name === previousGroupName
            ? { ...profile, group_name: nextGroupName }
            : profile,
        ),
      ),
    )
    setExpandedKeys((previous) => {
      const next = new Set(previous)
      next.delete(`group:${normalizeGroupName(previousGroupName)}`)
      if (nextGroupName) {
        next.add(`group:${normalizeGroupName(nextGroupName)}`)
      }
      return next
    })
    setTabs((previous) =>
      previous.map((currentTab) => {
        if (currentTab.kind !== 'profile') {
          return currentTab
        }

        if (currentTab.editor.form.group_name !== previousGroupName) {
          return currentTab
        }

        return {
          ...currentTab,
          editor: {
            ...currentTab.editor,
            form: {
              ...currentTab.editor.form,
              group_name: nextGroupName,
            },
          },
        }
      }),
    )
  }

  function syncGroupAssignmentTabs(groupId: string, nextGroupName: string | null) {
    setTabs((previous) => {
      if (nextGroupName == null) {
        return previous.filter(
          (tab) => !(tab.kind === 'group_assignment' && tab.assignment.target_group_id === groupId),
        )
      }

      return previous.map((tab) =>
        tab.kind === 'group_assignment' && tab.assignment.target_group_id === groupId
          ? {
              ...tab,
              title: `分组归类 · ${nextGroupName}`,
              subtitle: '勾选数据源后批量加入当前分组',
            }
          : tab,
      )
    })
    setActiveTabId((previous) => {
      if (nextGroupName == null && previous === `group-assignment:${groupId}`) {
        return ''
      }
      return previous
    })
  }

  function applyGroupAssignmentResult(
    result: AssignProfilesToDataSourceGroupResult,
    profileIds: string[],
  ) {
    const profileIdSet = new Set(profileIds)
    setProfiles((previous) =>
      sortProfiles(
        previous.map((profile) =>
          profileIdSet.has(profile.id)
            ? { ...profile, group_name: result.group_name }
            : profile,
        ),
      ),
    )
    setExpandedKeys((previous) => {
      const next = new Set(previous)
      next.add(`group:${normalizeGroupName(result.group_name)}`)
      return next
    })
    setTabs((previous) =>
      previous.map((tab) =>
        tab.kind === 'profile' && profileIdSet.has(tab.editor.form.id ?? '')
          ? {
              ...tab,
              editor: {
                ...tab.editor,
                form: {
                  ...tab.editor.form,
                  group_name: result.group_name,
                },
              },
            }
          : tab,
      ),
    )
  }

  async function createProfileGroupFromTab(tab: ProfileTab) {
    patchProfileEditor(tab.id, (editor) => ({
      ...editor,
      group_busy: true,
    }))

    try {
      const group = await createDataSourceGroup({
        group_name: tab.editor.create_group_name,
      })
      setDataSourceGroups((previous) => sortDataSourceGroups([...previous, group]))
      patchProfileEditor(tab.id, (editor) => ({
        ...editor,
        group_busy: false,
        create_group_name: '',
        form: {
          ...editor.form,
          group_name: group.group_name,
        },
      }))
      pushToast(`分组“${group.group_name}”已创建`, 'success')
    } catch (error) {
      patchProfileEditor(tab.id, (editor) => ({
        ...editor,
        group_busy: false,
      }))
      pushToast(error instanceof Error ? error.message : '创建分组失败', 'error')
    }
  }

  async function renameProfileGroupFromTab(tab: ProfileTab) {
    const groupId = tab.editor.editing_group_id
    if (!groupId) {
      return
    }

    patchProfileEditor(tab.id, (editor) => ({
      ...editor,
      group_busy: true,
    }))

    try {
      const result = await renameDataSourceGroup({
        group_id: groupId,
        group_name: tab.editor.editing_group_name,
      })
      setDataSourceGroups((previous) =>
        sortDataSourceGroups(
          previous.map((group) =>
            group.id === groupId
              ? { ...group, group_name: result.group_name }
              : group,
          ),
        ),
      )
      syncGroupNameAcrossState(result.previous_group_name, result.group_name)
      syncGroupAssignmentTabs(groupId, result.group_name)
      patchProfileEditor(tab.id, (editor) => ({
        ...editor,
        group_busy: false,
        editing_group_id: null,
        editing_group_name: '',
      }))
      pushToast(
        result.affected_profile_count > 0
          ? `分组已重命名，已同步 ${result.affected_profile_count} 个数据源`
          : '分组已重命名',
        'success',
      )
    } catch (error) {
      patchProfileEditor(tab.id, (editor) => ({
        ...editor,
        group_busy: false,
      }))
      pushToast(error instanceof Error ? error.message : '重命名分组失败', 'error')
    }
  }

  async function deleteProfileGroupFromTab(tab: ProfileTab, group: DataSourceGroup) {
    patchProfileEditor(tab.id, (editor) => ({
      ...editor,
      group_busy: true,
    }))

    try {
      const result = await deleteDataSourceGroup(group.id)
      setDataSourceGroups((previous) =>
        previous.filter((currentGroup) => currentGroup.id !== group.id),
      )
      syncGroupNameAcrossState(result.group_name, null)
      syncGroupAssignmentTabs(group.id, null)
      patchProfileEditor(tab.id, (editor) => ({
        ...editor,
        group_busy: false,
        editing_group_id:
          editor.editing_group_id === group.id ? null : editor.editing_group_id,
        editing_group_name: editor.editing_group_id === group.id ? '' : editor.editing_group_name,
        form: {
          ...editor.form,
          group_name:
            editor.form.group_name === group.group_name ? null : editor.form.group_name,
        },
      }))
      pushToast(
        result.affected_profile_count > 0
          ? `分组已删除，${result.affected_profile_count} 个数据源已移入未分组`
          : '分组已删除',
        'success',
      )
    } catch (error) {
      patchProfileEditor(tab.id, (editor) => ({
        ...editor,
        group_busy: false,
      }))
      pushToast(error instanceof Error ? error.message : '删除分组失败', 'error')
    }
  }

  async function applyProfilesToGroup(tab: GroupAssignmentTab) {
    const targetGroup = dataSourceGroups.find(
      (group) => group.id === tab.assignment.target_group_id,
    )
    if (!targetGroup) {
      pushToast('目标分组不存在', 'error')
      removeTab(tab.id)
      return
    }

    if (tab.assignment.selected_profile_ids.length === 0) {
      pushToast('请先勾选要加入分组的数据源', 'info')
      return
    }

    patchTab(tab.id, (currentTab) =>
      currentTab.kind === 'group_assignment'
        ? {
            ...currentTab,
            status: 'busy',
            error: '',
            assignment: {
              ...currentTab.assignment,
              submitting: true,
            },
          }
        : currentTab,
    )

    try {
      const result = await assignProfilesToDataSourceGroup({
        group_id: tab.assignment.target_group_id,
        profile_ids: tab.assignment.selected_profile_ids,
      })
      applyGroupAssignmentResult(result, tab.assignment.selected_profile_ids)
      patchTab(tab.id, (currentTab) =>
        currentTab.kind === 'group_assignment'
          ? {
              ...currentTab,
              status: 'ready',
              error: '',
              assignment: {
                ...currentTab.assignment,
                selected_profile_ids: [],
                submitting: false,
              },
            }
          : currentTab,
      )
      pushToast(
        `已将 ${result.affected_profile_count} 个数据源加入“${result.group_name}”`,
        'success',
      )
    } catch (error) {
      patchTab(tab.id, (currentTab) =>
        currentTab.kind === 'group_assignment'
          ? {
              ...currentTab,
              status: 'ready',
              error: error instanceof Error ? error.message : '批量设置分组失败',
              assignment: {
                ...currentTab.assignment,
                submitting: false,
              },
            }
          : currentTab,
      )
      pushToast(error instanceof Error ? error.message : '批量设置分组失败', 'error')
    }
  }

  async function testProfileTab(tab: ProfileTab) {
    patchTab(tab.id, (currentTab) =>
      currentTab.kind === 'profile'
        ? {
            ...currentTab,
            status: 'busy',
            editor: { ...currentTab.editor, testing: true, test_result: '' },
          }
        : currentTab,
    )

    try {
      const result = await testConnectionProfile(normalizeProfileForm(tab.editor.form))
      patchTab(tab.id, (currentTab) =>
        currentTab.kind === 'profile'
          ? {
              ...currentTab,
              status: 'ready',
              editor: {
                ...currentTab.editor,
                testing: false,
                test_result: `连接成功，MySQL ${result.server_version}${
                  result.current_database ? `，当前库 ${result.current_database}` : ''
                }`,
              },
            }
          : currentTab,
      )
    } catch (error) {
      patchTab(tab.id, (currentTab) =>
        currentTab.kind === 'profile'
          ? {
              ...currentTab,
              status: 'ready',
              editor: {
                ...currentTab.editor,
                testing: false,
                test_result: error instanceof Error ? error.message : '连接测试失败',
              },
            }
          : currentTab,
      )
    }
  }

  async function saveProfileTab(tab: ProfileTab) {
    patchTab(tab.id, (currentTab) =>
      currentTab.kind === 'profile'
        ? {
            ...currentTab,
            status: 'busy',
            editor: { ...currentTab.editor, saving: true, test_result: '' },
          }
        : currentTab,
    )

    try {
      const savedProfile = await saveConnectionProfile(
        normalizeProfileForm(tab.editor.form),
      )

      setProfiles((previous) => sortProfiles(upsertProfile(previous, savedProfile)))
      clearProfileCaches(savedProfile.id)
      void ensureDatabasesLoaded(savedProfile.id, { silent: true })
      setSelectedGroupKey('')
      setSelection({ kind: 'profile', profile_id: savedProfile.id })
      setExpandedKeys((previous) => expandAncestorsForProfile(previous, savedProfile))

      replaceTab(tab.id, {
        id: `profile:${savedProfile.id}`,
        kind: 'profile',
        title: `数据源 · ${savedProfile.data_source_name}`,
        subtitle: `${savedProfile.host}:${savedProfile.port}`,
        status: 'ready',
        error: '',
        editor: {
          ...createProfileEditorState('edit', profileToForm(savedProfile)),
          test_result: '数据源已保存',
        },
      })

      pushToast('数据源已保存', 'success')
    } catch (error) {
      patchTab(tab.id, (currentTab) =>
        currentTab.kind === 'profile'
          ? {
              ...currentTab,
              status: 'ready',
              editor: {
                ...currentTab.editor,
                saving: false,
                test_result: error instanceof Error ? error.message : '保存失败',
              },
            }
          : currentTab,
      )
    }
  }

  async function deleteProfileFromTab(tab: ProfileTab) {
    const profileId = tab.editor.form.id
    if (!profileId) {
      removeTab(tab.id)
      return
    }

    try {
      await deleteConnectionProfile(profileId)
      clearProfileCaches(profileId)
      setProfiles((previous) => previous.filter((profile) => profile.id !== profileId))
      setTabs((previous) =>
        previous.filter(
          (currentTab) =>
            !(
              ('profile_id' in currentTab && currentTab.profile_id === profileId) ||
              currentTab.id === tab.id
            ),
        ),
      )
      setSelectedGroupKey('')
      setSelection({ kind: 'none' })
      setActiveTabId('')
      pushToast('数据源已删除', 'success')
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '删除失败', 'error')
    }
  }

  async function saveCreateDatabaseDialog() {
    if (!createDatabaseDialog) {
      return
    }

    const databaseName = createDatabaseDialog.form.database_name.trim()
    if (!databaseName) {
      pushToast('数据库名不能为空', 'info')
      return
    }

    setCreateDatabaseDialog((previous) =>
      previous ? { ...previous, busy: true } : previous,
    )

    try {
      const startedAt = performance.now()
      const result = await createDatabase({
        profile_id: createDatabaseDialog.profile_id,
        database_name: databaseName,
      })
      setCreateDatabaseDialog(null)
      setExpandedKeys((previous) => {
        const next = new Set(previous)
        next.add(`profile:${createDatabaseDialog.profile_id}`)
        return next
      })
      await ensureDatabasesLoaded(createDatabaseDialog.profile_id, { force: true })
      clearSqlAutocompleteCache(createDatabaseDialog.profile_id, databaseName)
      setSelectedGroupKey('')
      setSelection({
        kind: 'database',
        profile_id: createDatabaseDialog.profile_id,
        database_name: databaseName,
      })
      pushToast(`数据库 ${databaseName} 已创建`, 'success')
      appendOutputLog(
        databaseName,
        `在 ${Math.max(1, Math.round(performance.now() - startedAt))} ms 内创建数据库成功`,
        'success',
        result.statements.join(';\n'),
      )
    } catch (error) {
      setCreateDatabaseDialog((previous) =>
        previous ? { ...previous, busy: false } : previous,
      )
      appendOutputLog(
        databaseName,
        error instanceof Error ? error.message : '创建数据库失败',
        'error',
        `CREATE DATABASE ${quoteIdentifier(databaseName)}`,
      )
      pushToast(error instanceof Error ? error.message : '创建数据库失败', 'error')
    }
  }

  function updateCreateDatabaseField(value: string) {
    setCreateDatabaseDialog((previous) =>
      previous
        ? {
            ...previous,
            form: {
              ...previous.form,
              database_name: value,
            },
          }
        : previous,
    )
  }

  async function disconnectSelectedProfile(selection: SelectionState) {
    const profileId =
      selection.kind === 'profile'
        ? selection.profile_id
        : selection.kind === 'database'
          ? selection.profile_id
        : selection.kind === 'table'
          ? selection.profile_id
          : ''

    if (!profileId) {
      pushToast('请先选择一个数据源', 'info')
      return
    }

    try {
      await disconnectConnectionProfile(profileId)
      setProfileConnectionStatus(profileId, 'idle')
      pushToast('连接池已释放', 'success')
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '断开连接失败', 'error')
    }
  }

  return {
    applyProfilesToGroup,
    cancelRenameProfileGroup,
    clearGroupAssignmentSelection,
    createDatabaseDialog,
    createProfileGroupFromTab,
    deleteProfileFromTab,
    deleteProfileGroupFromTab,
    disconnectSelectedProfile,
    importNavicatProfiles,
    openCreateDatabaseDialog,
    openGroupAssignmentTab,
    openProfileEditorTab,
    renameProfileGroupFromTab,
    saveCreateDatabaseDialog,
    saveProfileTab,
    setCreateDatabaseDialog,
    selectAllGroupAssignmentProfiles,
    startRenameProfileGroup,
    testProfileTab,
    toggleGroupAssignmentProfile,
    toggleProfileGroupManager,
    updateCreateDatabaseField,
    updateGroupAssignmentFilter,
    updateProfileEditingGroupName,
    updateProfileGroupCreateName,
    updateProfileTabField,
  }
}

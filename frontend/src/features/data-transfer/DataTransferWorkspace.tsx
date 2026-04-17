import { useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelDataTransferTask,
  chooseDataTransferFiles,
  getDataTransferSnapshot,
  refreshDataTransferDiscovery,
  resolveDataTransferSelectedFiles,
  removeDataTransferPublishedShare,
  setDataTransferRegistrationEnabled,
  startDataTransferDirectSend,
  updateDataTransferFavorite,
} from '../../api'
import type {
  DataTransferFavoriteNode,
  DataTransferNode,
  DataTransferSelectedFile,
  DataTransferSnapshot,
  DataTransferTask,
} from '../../types'
import './dataTransfer.css'

type NoticeTone = 'success' | 'error' | 'info'
type HistoryFilter = 'all' | 'sent' | 'received' | 'failed'
type NodeFilter = 'all' | 'online' | 'favorite' | 'recent'
type WorkspaceSection = 'dashboard' | 'nodes' | 'transfer' | 'history'

type NoticeState = {
  tone: NoticeTone
  message: string
}

type FavoriteNodeView = {
  favorite: DataTransferFavoriteNode
  online_node: DataTransferNode | null
}

type NodeListItem = {
  key: string
  record_id: string
  online_node_id: string | null
  alias: string
  fingerprint: string
  device_model: string | null
  device_type: string
  ip: string | null
  port: number | null
  source: string
  is_online: boolean
  is_favorite: boolean
  last_active_at: string
}

const SNAPSHOT_POLL_INTERVAL_MS = 1500
const NOTICE_HIDE_DELAY_MS = 3200
const HISTORY_PAGE_SIZE = 5
const NODE_PAGE_SIZE = 5

const WORKSPACE_SECTIONS: Array<{
  id: WorkspaceSection
  icon: string
  label: string
  title: string
  description: string
}> = [
  {
    id: 'dashboard',
    icon: '◫',
    label: '工作台',
    title: '工作台',
    description: '欢迎回来，管理你的节点网络与文件传输',
  },
  {
    id: 'nodes',
    icon: '◌',
    label: '节点列表',
    title: '节点列表',
    description: '管理网络中的所有节点，查看状态并快速发起文件传输',
  },
  {
    id: 'transfer',
    icon: '⇪',
    label: '文件传输',
    title: '文件传输',
    description: '选择文件、勾选节点并批量发起传输，底部持续查看当前任务进度',
  },
  {
    id: 'history',
    icon: '↺',
    label: '传输历史',
    title: '传输历史',
    description: '按任务查看传输记录、进度结果、节点对象与后续操作',
  },
]

export function DataTransferWorkspace() {
  const [snapshot, setSnapshot] = useState<DataTransferSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('dashboard')
  const [busyMessage, setBusyMessage] = useState('')
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [selectedTransferFiles, setSelectedTransferFiles] = useState<DataTransferSelectedFile[]>(
    [],
  )
  const [selectedTransferNodeIds, setSelectedTransferNodeIds] = useState<string[]>([])
  const [transferNodeSearch, setTransferNodeSearch] = useState('')
  const [nodeSearch, setNodeSearch] = useState('')
  const [nodeFilter, setNodeFilter] = useState<NodeFilter>('all')
  const [nodePage, setNodePage] = useState(1)
  const [historySearch, setHistorySearch] = useState('')
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')
  const [historyPage, setHistoryPage] = useState(1)
  const noticeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadInitialSnapshot() {
      try {
        const nextSnapshot = await getDataTransferSnapshot()
        if (cancelled) {
          return
        }
        applySnapshot(nextSnapshot)
      } catch (error) {
        if (!cancelled) {
          pushNotice(toErrorText(error, '读取数据传输工作区失败'), 'error')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadInitialSnapshot()

    async function pollSnapshot() {
      try {
        const nextSnapshot = await getDataTransferSnapshot()
        if (!cancelled) {
          applySnapshot(nextSnapshot)
        }
      } catch {
        // 轮询失败不打断当前页面，避免节点切换时不断弹错误。
      }
    }

    const timer = window.setInterval(() => {
      void pollSnapshot()
    }, SNAPSHOT_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      if (noticeTimerRef.current != null) {
        window.clearTimeout(noticeTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!notice) {
      return
    }

    if (noticeTimerRef.current != null) {
      window.clearTimeout(noticeTimerRef.current)
    }

    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null)
      noticeTimerRef.current = null
    }, NOTICE_HIDE_DELAY_MS)

    return () => {
      if (noticeTimerRef.current != null) {
        window.clearTimeout(noticeTimerRef.current)
        noticeTimerRef.current = null
      }
    }
  }, [notice])

  const nodes = useMemo(() => snapshot?.nodes ?? [], [snapshot?.nodes])
  const sortedTasks = useMemo(
    () =>
      [...(snapshot?.tasks ?? [])].sort(
        (left, right) =>
          new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
      ),
    [snapshot?.tasks],
  )
  const runningTasks = useMemo(
    () =>
      sortedTasks.filter(
        (task) => task.status === 'running' || task.status === 'pending',
      ),
    [sortedTasks],
  )
  const transferQueueTasks = useMemo(
    () =>
      sortedTasks
        .filter((task) => task.status === 'running' || task.status === 'pending')
        .sort(compareTransferQueueTasks),
    [sortedTasks],
  )
  const dashboardTasks = useMemo(
    () => (runningTasks.length > 0 ? runningTasks : sortedTasks.slice(0, 3)),
    [runningTasks, sortedTasks],
  )
  const favoriteNodes = useMemo<FavoriteNodeView[]>(
    () =>
      (snapshot?.favorite_nodes ?? []).map((favorite) => ({
        favorite,
        online_node:
          nodes.find((node) => node.fingerprint === favorite.fingerprint) ?? null,
      })),
    [nodes, snapshot?.favorite_nodes],
  )
  const sectionMeta = useMemo(
    () => WORKSPACE_SECTIONS.find((item) => item.id === activeSection) ?? WORKSPACE_SECTIONS[0],
    [activeSection],
  )
  const completedTransferBytes = useMemo(
    () =>
      sortedTasks
        .filter((task) => task.status === 'completed')
        .reduce((total, task) => total + task.total_bytes, 0),
    [sortedTasks],
  )
  const recentPublishedShares = useMemo(
    () => (snapshot?.published_shares ?? []).slice(0, 4),
    [snapshot?.published_shares],
  )
  const nodeListItems = useMemo<NodeListItem[]>(() => {
    const items = new Map<string, NodeListItem>()

    nodes.forEach((node) => {
      items.set(node.fingerprint, {
        key: node.fingerprint,
        record_id: node.id,
        online_node_id: node.id,
        alias: node.alias,
        fingerprint: node.fingerprint,
        device_model: node.device_model,
        device_type: node.device_type,
        ip: node.ip,
        port: node.port,
        source: node.source,
        is_online: true,
        is_favorite: node.favorite,
        last_active_at: node.last_seen_at,
      })
    })

    favoriteNodes.forEach(({ favorite }) => {
      const current = items.get(favorite.fingerprint)

      items.set(favorite.fingerprint, {
        key: favorite.fingerprint,
        record_id: current?.record_id ?? shortFingerprint(favorite.fingerprint),
        online_node_id: current?.online_node_id ?? null,
        alias: favorite.alias || current?.alias || shortFingerprint(favorite.fingerprint),
        fingerprint: favorite.fingerprint,
        device_model: favorite.device_model ?? current?.device_model ?? null,
        device_type: favorite.device_type || current?.device_type || 'desktop',
        ip: current?.ip ?? favorite.last_known_ip,
        port: current?.port ?? favorite.last_known_port,
        source: current?.source ?? 'favorite_scan',
        is_online: current?.is_online ?? false,
        is_favorite: true,
        last_active_at: current?.last_active_at ?? favorite.updated_at ?? favorite.created_at,
      })
    })

    return Array.from(items.values()).sort(compareNodeListItems)
  }, [favoriteNodes, nodes])
  const transferSelectableNodes = useMemo(
    () =>
      [...nodes].sort((left, right) => {
        if (left.favorite !== right.favorite) {
          return left.favorite ? -1 : 1
        }
        return left.alias.localeCompare(right.alias, 'zh-CN')
      }),
    [nodes],
  )
  const filteredTransferNodes = useMemo(() => {
    const keyword = transferNodeSearch.trim().toLowerCase()
    return transferSelectableNodes.filter((node) => {
      if (!keyword) {
        return true
      }

      return [node.alias, node.fingerprint, node.ip, node.device_model ?? '']
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [transferNodeSearch, transferSelectableNodes])
  const selectedTransferNodes = useMemo(
    () =>
      transferSelectableNodes.filter((node) => selectedTransferNodeIds.includes(node.id)),
    [selectedTransferNodeIds, transferSelectableNodes],
  )
  const onlineNodeCount = useMemo(
    () => nodeListItems.filter((item) => item.is_online).length,
    [nodeListItems],
  )
  const favoriteNodeCount = useMemo(
    () => nodeListItems.filter((item) => item.is_favorite).length,
    [nodeListItems],
  )
  const nodeTabs = useMemo(
    () => [
      { id: 'all' as NodeFilter, label: '所有节点', count: nodeListItems.length },
      { id: 'online' as NodeFilter, label: '在线节点', count: onlineNodeCount },
      { id: 'favorite' as NodeFilter, label: '收藏节点', count: favoriteNodeCount },
      { id: 'recent' as NodeFilter, label: '最近连接', count: null },
    ],
    [favoriteNodeCount, nodeListItems.length, onlineNodeCount],
  )
  const filteredNodeItems = useMemo(() => {
    const keyword = nodeSearch.trim().toLowerCase()
    const sourceItems =
      nodeFilter === 'recent'
        ? [...nodeListItems].sort(compareRecentNodeListItems)
        : nodeListItems

    return sourceItems.filter((item) => {
      const matchesFilter =
        nodeFilter === 'all'
          ? true
          : nodeFilter === 'online'
            ? item.is_online
            : nodeFilter === 'favorite'
              ? item.is_favorite
              : true

      if (!matchesFilter) {
        return false
      }

      if (!keyword) {
        return true
      }

      return [item.alias, item.record_id, item.fingerprint, item.ip ?? ''].some((value) =>
        value.toLowerCase().includes(keyword),
      )
    })
  }, [nodeFilter, nodeListItems, nodeSearch])
  const totalNodePages = Math.max(1, Math.ceil(filteredNodeItems.length / NODE_PAGE_SIZE))
  const safeNodePage = Math.min(nodePage, totalNodePages)
  const visibleNodeItems = useMemo(() => {
    const startIndex = (safeNodePage - 1) * NODE_PAGE_SIZE
    return filteredNodeItems.slice(startIndex, startIndex + NODE_PAGE_SIZE)
  }, [filteredNodeItems, safeNodePage])
  const nodePageStart =
    filteredNodeItems.length === 0 ? 0 : (safeNodePage - 1) * NODE_PAGE_SIZE + 1
  const nodePageEnd = Math.min(safeNodePage * NODE_PAGE_SIZE, filteredNodeItems.length)
  const nodePageNumbers = useMemo(
    () => buildPageNumbers(totalNodePages, safeNodePage),
    [safeNodePage, totalNodePages],
  )
  const isHistorySection = activeSection === 'history'
  const isNodesSection = activeSection === 'nodes'
  const isTransferSection = activeSection === 'transfer'
  const totalTransferBytes = useMemo(
    () => sortedTasks.reduce((total, task) => total + task.total_bytes, 0),
    [sortedTasks],
  )
  const successfulTaskCount = useMemo(
    () => sortedTasks.filter((task) => task.status === 'completed').length,
    [sortedTasks],
  )
  const failedTaskCount = useMemo(
    () =>
      sortedTasks.filter(
        (task) => task.status === 'failed' || task.status === 'canceled',
      ).length,
    [sortedTasks],
  )
  const averageTransferSpeed = useMemo(() => {
    let totalBytes = 0
    let totalSeconds = 0

    sortedTasks.forEach((task) => {
      if (task.status !== 'completed') {
        return
      }

      const startedAt = new Date(task.started_at).getTime()
      const completedAt = new Date(task.completed_at ?? task.updated_at).getTime()
      if (Number.isNaN(startedAt) || Number.isNaN(completedAt) || completedAt <= startedAt) {
        return
      }

      totalBytes += task.total_bytes
      totalSeconds += (completedAt - startedAt) / 1000
    })

    if (totalBytes <= 0 || totalSeconds <= 0) {
      return 0
    }

    return totalBytes / totalSeconds
  }, [sortedTasks])
  const historyTabs = useMemo(
    () => [
      { id: 'all' as HistoryFilter, label: '全部记录', count: sortedTasks.length },
      {
        id: 'sent' as HistoryFilter,
        label: '已发送',
        count: sortedTasks.filter((task) => task.direction !== 'incoming').length,
      },
      {
        id: 'received' as HistoryFilter,
        label: '已接收',
        count: sortedTasks.filter((task) => task.direction === 'incoming').length,
      },
      {
        id: 'failed' as HistoryFilter,
        label: '已失败',
        count: failedTaskCount,
      },
    ],
    [failedTaskCount, sortedTasks],
  )
  const filteredHistoryTasks = useMemo(() => {
    const keyword = historySearch.trim().toLowerCase()

    return sortedTasks.filter((task) => {
      const matchesFilter =
        historyFilter === 'all'
          ? true
          : historyFilter === 'sent'
            ? task.direction !== 'incoming'
            : historyFilter === 'received'
              ? task.direction === 'incoming'
              : task.status === 'failed' || task.status === 'canceled'

      if (!matchesFilter) {
        return false
      }

      if (!keyword) {
        return true
      }

      return formatTaskPrimaryName(task).toLowerCase().includes(keyword)
    })
  }, [historyFilter, historySearch, sortedTasks])
  const totalHistoryPages = Math.max(
    1,
    Math.ceil(filteredHistoryTasks.length / HISTORY_PAGE_SIZE),
  )
  const safeHistoryPage = Math.min(historyPage, totalHistoryPages)
  const visibleHistoryTasks = useMemo(() => {
    const startIndex = (safeHistoryPage - 1) * HISTORY_PAGE_SIZE
    return filteredHistoryTasks.slice(startIndex, startIndex + HISTORY_PAGE_SIZE)
  }, [filteredHistoryTasks, safeHistoryPage])
  const historyPageStart =
    filteredHistoryTasks.length === 0 ? 0 : (safeHistoryPage - 1) * HISTORY_PAGE_SIZE + 1
  const historyPageEnd = Math.min(
    safeHistoryPage * HISTORY_PAGE_SIZE,
    filteredHistoryTasks.length,
  )
  const historyPageNumbers = useMemo(
    () => buildPageNumbers(totalHistoryPages, safeHistoryPage),
    [safeHistoryPage, totalHistoryPages],
  )

  useEffect(() => {
    setNodePage(1)
  }, [nodeFilter, nodeSearch])

  useEffect(() => {
    setNodePage((previous) => Math.min(previous, totalNodePages))
  }, [totalNodePages])

  useEffect(() => {
    setHistoryPage(1)
  }, [historyFilter, historySearch])

  useEffect(() => {
    setHistoryPage((previous) => Math.min(previous, totalHistoryPages))
  }, [totalHistoryPages])

  function applySnapshot(nextSnapshot: DataTransferSnapshot) {
    setSnapshot(nextSnapshot)
    setSelectedTransferNodeIds((previous) =>
      previous.filter((nodeId) => nextSnapshot.nodes.some((node) => node.id === nodeId)),
    )
  }

  function pushNotice(message: string, tone: NoticeTone) {
    setNotice({ message, tone })
  }

  function withBusy(message: string) {
    setBusyMessage(message)
  }

  function clearBusy() {
    setBusyMessage('')
  }

  async function refreshSnapshot() {
    try {
      const nextSnapshot = await getDataTransferSnapshot()
      applySnapshot(nextSnapshot)
    } catch {
      // 手动刷新失败时由触发方决定是否提示。
    }
  }

  async function handleToggleRegistration() {
    if (!snapshot) {
      return
    }

    withBusy(snapshot.local_node.registration_enabled ? '正在关闭网络注册…' : '正在开启网络注册…')
    try {
      const nextSnapshot = await setDataTransferRegistrationEnabled(
        !snapshot.local_node.registration_enabled,
      )
      applySnapshot(nextSnapshot)
      pushNotice(
        nextSnapshot.local_node.registration_enabled
          ? '已恢复本机节点广播与注册'
          : '已关闭本机节点广播与注册',
        'success',
      )
    } catch (error) {
      pushNotice(toErrorText(error, '切换节点注册状态失败'), 'error')
    } finally {
      clearBusy()
    }
  }

  async function handleRefreshDiscovery() {
    withBusy('正在刷新局域网节点…')
    try {
      const nextSnapshot = await refreshDataTransferDiscovery()
      applySnapshot(nextSnapshot)
      pushNotice('局域网节点已刷新', 'success')
    } catch (error) {
      pushNotice(toErrorText(error, '刷新节点失败'), 'error')
    } finally {
      clearBusy()
    }
  }

  async function handleToggleFavoriteEntry(entry: NodeListItem) {
    withBusy(entry.is_favorite ? `正在取消收藏 ${entry.alias}…` : `正在收藏 ${entry.alias}…`)
    try {
      const nextSnapshot = await updateDataTransferFavorite({
        fingerprint: entry.fingerprint,
        alias: entry.alias,
        device_model: entry.device_model,
        device_type: entry.device_type,
        last_known_ip: entry.ip,
        last_known_port: entry.port,
        favorite: !entry.is_favorite,
      })
      applySnapshot(nextSnapshot)
      pushNotice(
        !entry.is_favorite ? `已收藏节点 ${entry.alias}` : `已取消收藏节点 ${entry.alias}`,
        'success',
      )
    } catch (error) {
      pushNotice(toErrorText(error, '更新收藏节点失败'), 'error')
    } finally {
      clearBusy()
    }
  }

  async function handleRemovePublishedShare(shareId: string) {
    withBusy('正在移除共享文件…')
    try {
      const nextSnapshot = await removeDataTransferPublishedShare(shareId)
      applySnapshot(nextSnapshot)
      pushNotice('共享文件已移除', 'success')
    } catch (error) {
      pushNotice(toErrorText(error, '移除共享文件失败'), 'error')
    } finally {
      clearBusy()
    }
  }

  async function appendTransferFiles(filePaths: string[]) {
    const nextPaths = Array.from(new Set(filePaths.filter(Boolean)))
    if (nextPaths.length === 0) {
      return
    }

    try {
      const files = await resolveDataTransferSelectedFiles({ file_paths: nextPaths })
      setSelectedTransferFiles((previous) => mergeSelectedTransferFiles(previous, files))
    } catch (error) {
      pushNotice(toErrorText(error, '读取文件信息失败'), 'error')
    }
  }

  async function handleChooseTransferFiles() {
    try {
      const result = await chooseDataTransferFiles()
      if (!result.canceled) {
        await appendTransferFiles(result.file_paths)
      }
    } catch (error) {
      pushNotice(toErrorText(error, '选择待发送文件失败'), 'error')
    }
  }

  async function handleToolbarSend() {
    setActiveSection('transfer')
    await handleChooseTransferFiles()
  }

  async function handleStartDirectSend() {
    if (selectedTransferNodeIds.length === 0) {
      pushNotice('请至少勾选一个目标节点', 'error')
      return
    }
    if (selectedTransferFiles.length === 0) {
      pushNotice('请先选择需要发送的文件', 'error')
      return
    }

    const targetNodes = selectedTransferNodes.filter((node) =>
      selectedTransferNodeIds.includes(node.id),
    )
    if (targetNodes.length === 0) {
      pushNotice('当前选中的节点不可用，请重新选择', 'error')
      return
    }

    withBusy(
      targetNodes.length === 1
        ? `正在发起直传到 ${targetNodes[0].alias}…`
        : `正在向 ${targetNodes.length} 个节点发起传输…`,
    )
    try {
      const filePaths = selectedTransferFiles.map((file) => file.file_path)
      const taskIds: string[] = []

      for (const node of targetNodes) {
        const result = await startDataTransferDirectSend({
          node_id: node.id,
          file_paths: filePaths,
        })
        taskIds.push(result.task_id)
      }

      setSelectedTransferFiles([])
      pushNotice(
        taskIds.length === 1 ? `已创建传输任务 ${taskIds[0]}` : `已创建 ${taskIds.length} 个传输任务`,
        'success',
      )
      await refreshSnapshot()
    } catch (error) {
      pushNotice(toErrorText(error, '发起直传失败'), 'error')
    } finally {
      clearBusy()
    }
  }

  async function handleCancelTask(taskId: string) {
    withBusy(`正在取消任务 ${taskId}…`)
    try {
      const result = await cancelDataTransferTask(taskId)
      pushNotice(
        result.accepted ? `任务 ${taskId} 已取消` : `任务 ${taskId} 当前不可取消`,
        'info',
      )
      await refreshSnapshot()
    } catch (error) {
      pushNotice(toErrorText(error, '取消任务失败'), 'error')
    } finally {
      clearBusy()
    }
  }

  function toggleTransferNode(nodeId: string) {
    setSelectedTransferNodeIds((previous) =>
      previous.includes(nodeId)
        ? previous.filter((item) => item !== nodeId)
        : [...previous, nodeId],
    )
  }

  function removeTransferSelectedNode(nodeId: string) {
    setSelectedTransferNodeIds((previous) => previous.filter((item) => item !== nodeId))
  }

  function removeSelectedTransferFile(filePath: string) {
    setSelectedTransferFiles((previous) => previous.filter((item) => item.file_path !== filePath))
  }

  function focusNodeTransfer(nodeId: string) {
    setSelectedTransferNodeIds((previous) =>
      previous.includes(nodeId) ? previous : [...previous, nodeId],
    )
    setActiveSection('transfer')
  }

  function renderDashboard() {
    return (
      <>
        <section className="data-transfer-proto-layout">
          <div className="data-transfer-proto-main">
            <article className="data-transfer-panel">
              <div className="data-transfer-panel-head">
                <div>
                  <div className="data-transfer-panel-kicker">Current Tasks</div>
                  <strong>当前传输任务</strong>
                </div>
                <button
                  className="data-transfer-secondary compact"
                  type="button"
                  onClick={() => setActiveSection('history')}
                >
                  查看全部
                </button>
              </div>
              <div className="data-transfer-task-list">
                {dashboardTasks.length === 0 ? (
                  <div className="data-transfer-empty-block">
                    <strong>当前没有运行中的任务</strong>
                    <p>选择节点后发送文件，或者上传共享文件到网络。</p>
                  </div>
                ) : (
                  dashboardTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onCancel={() => void handleCancelTask(task.id)}
                    />
                  ))
                )}
              </div>
            </article>

            <article className="data-transfer-panel">
              <div className="data-transfer-panel-head">
                <div>
                  <div className="data-transfer-panel-kicker">Recent Shares</div>
                  <strong>最近共享文件</strong>
                </div>
                <span className="data-transfer-inline-meta">
                  共 {snapshot?.published_shares.length ?? 0} 组
                </span>
              </div>
              <div className="data-transfer-share-list">
                {recentPublishedShares.length === 0 ? (
                  <div className="data-transfer-empty-block">
                    <strong>当前还没有共享文件</strong>
                    <p>上传文件后即可按全部节点、收藏节点或指定节点开放访问。</p>
                  </div>
                ) : (
                  recentPublishedShares.map((share) => (
                    <article key={share.id} className="data-transfer-share-row">
                      <div className="data-transfer-share-icon">
                        {share.files[0]?.file_name.slice(0, 1).toUpperCase() ?? 'F'}
                      </div>
                      <div className="data-transfer-share-copy">
                        <strong>{share.title}</strong>
                        <small>
                          {formatDateTime(share.updated_at)} · {formatBytes(share.total_bytes)} ·{' '}
                          {formatScopeLabel(share.scope)}
                        </small>
                      </div>
                      <div className="data-transfer-share-row-actions">
                        <button
                          className="data-transfer-subtle-icon-button"
                          type="button"
                          title="移除共享"
                          onClick={() => void handleRemovePublishedShare(share.id)}
                        >
                          ×
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </article>
          </div>

          <div className="data-transfer-proto-side">
            {renderFavoritesCard('节点列表')}

            <article className="data-transfer-panel">
              <div className="data-transfer-panel-head">
                <div>
                  <div className="data-transfer-panel-kicker">Quick Actions</div>
                  <strong>快速操作</strong>
                </div>
              </div>
              <div className="data-transfer-action-grid">
                <button
                  className="data-transfer-action-card accent-indigo"
                  type="button"
                  onClick={() => void handleToolbarSend()}
                >
                  <span className="data-transfer-action-icon">↗</span>
                  <strong>发送文件</strong>
                  <small>选择节点传输文件</small>
                </button>
                <button
                  className="data-transfer-action-card accent-cyan"
                  type="button"
                  onClick={() => setActiveSection('transfer')}
                >
                  <span className="data-transfer-action-icon">⇪</span>
                  <strong>文件传输</strong>
                  <small>打开文件传输工作区</small>
                </button>
                <button
                  className="data-transfer-action-card accent-green"
                  type="button"
                  onClick={() => setActiveSection('nodes')}
                >
                  <span className="data-transfer-action-icon">◎</span>
                  <strong>节点列表</strong>
                  <small>查看所有在线节点</small>
                </button>
                <button
                  className="data-transfer-action-card accent-purple"
                  type="button"
                  onClick={() => setActiveSection('transfer')}
                >
                  <span className="data-transfer-action-icon">⚙</span>
                  <strong>传输设置</strong>
                  <small>配置下载目录与续传策略</small>
                </button>
              </div>
            </article>

            {renderNetworkDetailsCard()}
          </div>
        </section>

        <section className="data-transfer-history-section">
          {renderHistoryCard()}
        </section>
      </>
    )
  }

  function renderNodes() {
    return (
      <section className="data-transfer-nodes-page">
        {notice ? (
          <section className={`data-transfer-notice ${notice.tone}`}>{notice.message}</section>
        ) : null}

        <article className="data-transfer-panel data-transfer-nodes-hero">
          <div className="data-transfer-nodes-hero-copy">
            <h2>节点列表</h2>
            <p>管理网络中的所有节点，查看状态并进行操作</p>
          </div>
          <label className="data-transfer-nodes-search">
            <span className="data-transfer-nodes-search-icon">⌕</span>
            <input
              value={nodeSearch}
              type="text"
              placeholder="搜索节点名称或ID..."
              onChange={(event) => setNodeSearch(event.target.value)}
            />
          </label>
        </article>

        <section className="data-transfer-nodes-tabs">
          {nodeTabs.map((tab) => (
            <button
              key={tab.id}
              className={`data-transfer-nodes-tab ${nodeFilter === tab.id ? 'active' : ''}`}
              type="button"
              onClick={() => setNodeFilter(tab.id)}
            >
              {tab.count == null ? tab.label : `${tab.label} (${tab.count})`}
            </button>
          ))}
        </section>

        <article className="data-transfer-panel data-transfer-nodes-records">
          <div className="data-transfer-nodes-grid-head">
            <span>节点信息</span>
            <span>节点ID</span>
            <span>IP地址</span>
            <span>状态</span>
            <span>操作</span>
          </div>

          <div
            className={`data-transfer-nodes-grid-body ${
              filteredNodeItems.length === 0 ? 'data-transfer-nodes-grid-body-empty' : ''
            }`}
          >
            {visibleNodeItems.length === 0 ? null : (
              visibleNodeItems.map((item) => (
                <article key={item.key} className="data-transfer-nodes-row">
                  <div className="data-transfer-nodes-cell data-transfer-nodes-info-cell">
                    <div
                      className={`data-transfer-nodes-avatar ${getNodeAccentClass(
                        item.fingerprint,
                      )}`}
                    >
                      {getNodeBadge(item.alias)}
                    </div>
                    <div className="data-transfer-nodes-copy">
                      <div className="data-transfer-nodes-title-line">
                        <strong>{item.alias}</strong>
                        {item.is_favorite ? (
                          <span className="data-transfer-nodes-favorite-mark">★</span>
                        ) : null}
                      </div>
                      <span>{formatNodeRecordMeta(item)}</span>
                    </div>
                  </div>

                  <div className="data-transfer-nodes-cell">
                    <strong className="data-transfer-nodes-strong">{item.record_id}</strong>
                  </div>

                  <div className="data-transfer-nodes-cell">
                    <strong className="data-transfer-nodes-strong">{item.ip ?? '-'}</strong>
                  </div>

                  <div className="data-transfer-nodes-cell">
                    <div
                      className={`data-transfer-nodes-status ${
                        item.is_online ? 'online' : 'offline'
                      }`}
                    >
                      <span className="data-transfer-nodes-status-dot" />
                      <strong>{item.is_online ? '在线' : '离线'}</strong>
                    </div>
                  </div>

                  <div className="data-transfer-nodes-cell data-transfer-nodes-actions">
                    <button
                      className="data-transfer-node-send-button"
                      disabled={!item.is_online || !item.online_node_id}
                      type="button"
                      onClick={() => {
                        if (item.online_node_id) {
                          focusNodeTransfer(item.online_node_id)
                        }
                      }}
                    >
                      <span>↗</span>
                      <strong>发送文件</strong>
                    </button>
                    <button
                      className="data-transfer-subtle-icon-button"
                      type="button"
                      title={item.is_favorite ? '取消收藏' : '加入收藏'}
                      onClick={() => void handleToggleFavoriteEntry(item)}
                    >
                      ⋯
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="data-transfer-nodes-footer">
            <span className="data-transfer-inline-meta">
              显示 {nodePageStart}-{nodePageEnd} 条，共 {filteredNodeItems.length} 条节点
            </span>
            {totalNodePages > 1 ? (
              <div className="data-transfer-history-pagination">
                <button
                  className="data-transfer-history-page-button"
                  disabled={safeNodePage === 1}
                  type="button"
                  onClick={() => setNodePage((previous) => Math.max(1, previous - 1))}
                >
                  ‹
                </button>
                {nodePageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    className={`data-transfer-history-page-button ${
                      safeNodePage === pageNumber ? 'active' : ''
                    }`}
                    type="button"
                    onClick={() => setNodePage(pageNumber)}
                  >
                    {pageNumber}
                  </button>
                ))}
                <button
                  className="data-transfer-history-page-button"
                  disabled={safeNodePage === totalNodePages}
                  type="button"
                  onClick={() =>
                    setNodePage((previous) => Math.min(totalNodePages, previous + 1))
                  }
                >
                  ›
                </button>
              </div>
            ) : null}
          </div>
        </article>
      </section>
    )
  }

  function renderTransfer() {
    return (
      <section className="data-transfer-current-page">
        <section className="data-transfer-transfer-card data-transfer-send-builder">
          <div className="data-transfer-transfer-card-head">
            <div>
              <strong>待发送文件</strong>
              <span>点击右侧按钮选择文件，已选文件会保留名称、路径和大小信息</span>
            </div>
            <button
              className="data-transfer-primary compact"
              type="button"
              onClick={() => void handleChooseTransferFiles()}
            >
              选择文件
            </button>
          </div>

          <div className="data-transfer-transfer-card-scroller data-transfer-selected-file-list">
            {selectedTransferFiles.length === 0 ? (
              <div className="data-transfer-empty-block">
                <strong>尚未选择待发送文件</strong>
                <p>点击“选择文件”后加入待发送列表。</p>
              </div>
            ) : (
              selectedTransferFiles.map((file) => (
                <article key={file.file_path} className="data-transfer-selected-file-card">
                  <div className="data-transfer-selected-file-copy">
                    <strong>{file.file_name}</strong>
                    <span>{file.file_path}</span>
                  </div>
                  <div className="data-transfer-selected-file-meta">
                    <em>{formatBytes(file.size)}</em>
                    <button
                      className="data-transfer-path-remove"
                      type="button"
                      onClick={() => removeSelectedTransferFile(file.file_path)}
                    >
                      ×
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="data-transfer-transfer-card data-transfer-node-picker">
          <div className="data-transfer-transfer-card-head">
            <div>
              <strong>目标节点</strong>
              <span>已选择 {selectedTransferNodeIds.length} 个节点，可勾选一个或多个目标</span>
            </div>
            <button
              className="data-transfer-primary compact"
              disabled={selectedTransferFiles.length === 0 || selectedTransferNodeIds.length === 0}
              type="button"
              onClick={() => void handleStartDirectSend()}
            >
              发送到已选节点
            </button>
          </div>

          <div className="data-transfer-node-picker-head">
            <strong>节点列表</strong>
            <div className="data-transfer-node-picker-tools">
              <label className="data-transfer-node-picker-search">
                <input
                  value={transferNodeSearch}
                  type="text"
                  placeholder="搜索节点名称 / 指纹 / IP"
                  onChange={(event) => setTransferNodeSearch(event.target.value)}
                />
              </label>
              <button
                className="data-transfer-secondary compact"
                type="button"
                onClick={() => setTransferNodeSearch('')}
              >
                清空筛选
              </button>
            </div>
          </div>

          <div className="data-transfer-transfer-card-scroller">
            {selectedTransferNodes.length > 0 ? (
              <div className="data-transfer-node-selected-list">
                {selectedTransferNodes.map((node) => (
                  <article key={node.id} className="data-transfer-node-selected-card">
                    <div
                      className={`data-transfer-node-selected-avatar ${getNodeAccentClass(
                        node.alias,
                      )}`}
                    >
                      {getNodeBadge(node.alias)}
                    </div>
                    <strong>{node.alias}</strong>
                    <button
                      className="data-transfer-subtle-icon-button"
                      type="button"
                      onClick={() => removeTransferSelectedNode(node.id)}
                    >
                      ×
                    </button>
                  </article>
                ))}
              </div>
            ) : null}

            <div className="data-transfer-node-picker-list">
              {filteredTransferNodes.length === 0 ? (
                <div className="data-transfer-empty-block">
                  <strong>当前没有可选节点</strong>
                  <p>请检查网络注册状态，或刷新节点后重试。</p>
                </div>
              ) : (
                filteredTransferNodes.map((node) => {
                  const checked = selectedTransferNodeIds.includes(node.id)
                  return (
                    <article
                      key={node.id}
                      className={`data-transfer-node-picker-card ${checked ? 'selected' : ''}`}
                      onClick={() => toggleTransferNode(node.id)}
                    >
                      <div
                        className={`data-transfer-node-picker-avatar ${getNodeAccentClass(
                          node.alias,
                        )}`}
                      >
                        {getNodeBadge(node.alias)}
                      </div>
                      <div className="data-transfer-node-picker-copy">
                        <strong>
                          {node.alias}
                          {node.favorite ? <span className="data-transfer-node-picker-star">★</span> : null}
                          <span className="data-transfer-node-picker-status">●</span>
                        </strong>
                        <span>
                          {shortFingerprint(node.fingerprint)} · {node.ip}:{node.port}
                        </span>
                      </div>
                      <button
                        className={`data-transfer-node-picker-check ${checked ? 'checked' : ''}`}
                        type="button"
                        aria-label={checked ? '取消勾选节点' : '勾选节点'}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleTransferNode(node.id)
                        }}
                      />
                    </article>
                  )
                })
              )}
            </div>
          </div>

          <div className="data-transfer-node-picker-foot">
            <span className="data-transfer-inline-note">
              已选择 {selectedTransferFiles.length} 个文件，准备发送到 {selectedTransferNodeIds.length} 个节点
            </span>
          </div>
        </section>

        <section className="data-transfer-transfer-card data-transfer-current-task-card">
          <div className="data-transfer-transfer-card-head data-transfer-current-section-head">
            <div>
              <strong>当前传输任务</strong>
              <span>统一展示正在发送中的任务和续传进度</span>
            </div>
          </div>

          <div className="data-transfer-transfer-card-scroller data-transfer-current-list">
            {transferQueueTasks.length > 0
              ? transferQueueTasks.map((task) => (
                  <TransferQueueCard
                    key={task.id}
                    task={task}
                    onCancel={() => void handleCancelTask(task.id)}
                  />
                ))
              : null}
          </div>
        </section>
      </section>
    )
  }

  function renderHistory() {
    return (
      <section className="data-transfer-history-page">
        {notice ? (
          <section className={`data-transfer-notice ${notice.tone}`}>{notice.message}</section>
        ) : null}

        <article className="data-transfer-panel data-transfer-history-hero">
          <div className="data-transfer-history-hero-copy">
            <h2>传输历史</h2>
            <p>查看所有文件传输记录，管理历史任务</p>
          </div>
          <label className="data-transfer-history-search">
            <span className="data-transfer-history-search-icon">⌕</span>
            <input
              value={historySearch}
              type="text"
              placeholder="搜索文件名称..."
              onChange={(event) => setHistorySearch(event.target.value)}
            />
          </label>
        </article>

        <section className="data-transfer-history-stats">
          <HistoryStatCard
            accent="cyan"
            icon="◎"
            title="总传输量"
            value={formatBytes(totalTransferBytes)}
          />
          <HistoryStatCard
            accent="green"
            icon="✓"
            title="传输成功"
            value={String(successfulTaskCount)}
          />
          <HistoryStatCard
            accent="pink"
            icon="×"
            title="传输失败"
            value={String(failedTaskCount)}
          />
          <HistoryStatCard
            accent="purple"
            icon="⇄"
            title="平均传输速度"
            value={formatSpeed(averageTransferSpeed)}
          />
        </section>

        <section className="data-transfer-history-tabs">
          {historyTabs.map((tab) => (
            <button
              key={tab.id}
              className={`data-transfer-history-tab ${
                historyFilter === tab.id ? 'active' : ''
              }`}
              type="button"
              onClick={() => setHistoryFilter(tab.id)}
            >
              {tab.id === 'all' ? tab.label : `${tab.label} (${tab.count})`}
            </button>
          ))}
        </section>

        <article className="data-transfer-panel data-transfer-history-records">
          <div className="data-transfer-history-grid-head">
            <span>文件信息</span>
            <span>方向</span>
            <span>对方节点</span>
            <span>大小</span>
            <span>状态</span>
            <span>传输时间</span>
          </div>

          <div
            className={`data-transfer-history-grid-body ${
              filteredHistoryTasks.length === 0 ? 'data-transfer-history-grid-body-empty' : ''
            }`}
          >
            {visibleHistoryTasks.map((task) => (
              <article key={task.id} className="data-transfer-history-row">
                <div className="data-transfer-history-cell data-transfer-history-file-cell">
                  <div
                    className={`data-transfer-history-file-icon ${getHistoryAccentClass(task)}`}
                  >
                    {getHistoryFileBadge(task)}
                  </div>
                  <div className="data-transfer-history-file-copy">
                    <strong>{formatTaskPrimaryName(task)}</strong>
                    <span>{formatHistoryFileMeta(task)}</span>
                  </div>
                </div>

                <div className="data-transfer-history-cell">
                  <span className={`data-transfer-history-direction ${getHistoryAccentClass(task)}`}>
                    {formatDirectionLabel(task.direction)}
                  </span>
                </div>

                <div className="data-transfer-history-cell data-transfer-history-peer-cell">
                  <div
                    className={`data-transfer-history-peer-avatar ${getHistoryAccentClass(task)}`}
                  >
                    {getHistoryPeerBadge(task.peer_alias)}
                  </div>
                  <div className="data-transfer-history-peer-copy">
                    <strong>{task.peer_alias}</strong>
                    <span>{shortFingerprint(task.peer_fingerprint)}</span>
                  </div>
                </div>

                <div className="data-transfer-history-cell">
                  <strong className="data-transfer-history-strong">
                    {formatBytes(task.total_bytes)}
                  </strong>
                </div>

                <div className="data-transfer-history-cell">
                  <div
                    className={`data-transfer-history-status ${getHistoryStatusClass(
                      task.status,
                    )}`}
                  >
                    <span className="data-transfer-history-status-dot" />
                    <strong>{formatHistoryStatusLabel(task.status)}</strong>
                  </div>
                  <span className="data-transfer-history-status-note">
                    {formatHistoryStatusNote(task)}
                  </span>
                </div>

                <div className="data-transfer-history-cell data-transfer-history-time-cell">
                  <strong>{formatHistoryDateTime(task.completed_at ?? task.updated_at)}</strong>
                  <span>{formatHistoryDuration(task)}</span>
                </div>
              </article>
            ))}
          </div>

          <div className="data-transfer-history-footer">
            <span className="data-transfer-inline-meta">
              显示 {historyPageStart}-{historyPageEnd} 条，共 {filteredHistoryTasks.length} 条记录
            </span>
            {totalHistoryPages > 1 ? (
              <div className="data-transfer-history-pagination">
                <button
                  className="data-transfer-history-page-button"
                  disabled={safeHistoryPage === 1}
                  type="button"
                  onClick={() => setHistoryPage((previous) => Math.max(1, previous - 1))}
                >
                  ‹
                </button>
                {historyPageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    className={`data-transfer-history-page-button ${
                      safeHistoryPage === pageNumber ? 'active' : ''
                    }`}
                    type="button"
                    onClick={() => setHistoryPage(pageNumber)}
                  >
                    {pageNumber}
                  </button>
                ))}
                <button
                  className="data-transfer-history-page-button"
                  disabled={safeHistoryPage === totalHistoryPages}
                  type="button"
                  onClick={() =>
                    setHistoryPage((previous) => Math.min(totalHistoryPages, previous + 1))
                  }
                >
                  ›
                </button>
              </div>
            ) : null}
          </div>
        </article>
      </section>
    )
  }

  function renderNetworkDetailsCard() {
    return (
      <article className="data-transfer-panel">
        <div className="data-transfer-panel-head">
          <div>
            <div className="data-transfer-panel-kicker">Network</div>
            <strong>网络状态</strong>
          </div>
          <span
            className={`data-transfer-chip ${
              snapshot?.local_node.registration_enabled ? 'online' : 'offline'
            }`}
          >
            {snapshot?.local_node.registration_enabled ? '已连接' : '未连接'}
          </span>
        </div>

        <div className="data-transfer-network-list">
          <div className="data-transfer-network-row">
            <span>节点 ID</span>
            <strong>{shortFingerprint(snapshot?.local_node.fingerprint ?? '-')}</strong>
          </div>
          <div className="data-transfer-network-row">
            <span>网络端口</span>
            <strong>{snapshot?.local_node.port ?? '-'}</strong>
          </div>
          <div className="data-transfer-network-row">
            <span>在线节点</span>
            <strong>{nodes.length}</strong>
          </div>
          <div className="data-transfer-network-row">
            <span>收藏节点</span>
            <strong>{favoriteNodes.length}</strong>
          </div>
          <div className="data-transfer-network-row">
            <span>运行中任务</span>
            <strong>{runningTasks.length}</strong>
          </div>
          <div className="data-transfer-network-row">
            <span>下载目录</span>
            <strong>{shortPath(snapshot?.default_download_dir ?? '-')}</strong>
          </div>
        </div>

        <div className="data-transfer-panel-footer">
          <span className="data-transfer-inline-note">
            节点发现、直传、共享下载都会在当前网络注册开启时自动工作。
          </span>
          <button
            className="data-transfer-secondary compact danger"
            type="button"
            onClick={() => void handleToggleRegistration()}
          >
            {snapshot?.local_node.registration_enabled ? '关闭网络注册' : '开启网络注册'}
          </button>
        </div>
      </article>
    )
  }

  function renderFavoritesCard(actionLabel?: string) {
    return (
      <article className="data-transfer-panel">
        <div className="data-transfer-panel-head">
          <div>
            <div className="data-transfer-panel-kicker">Favorites</div>
            <strong>收藏节点</strong>
          </div>
          {actionLabel ? (
            <button
              className="data-transfer-secondary compact"
              type="button"
              onClick={() => setActiveSection('nodes')}
            >
              {actionLabel}
            </button>
          ) : null}
        </div>
        <div className="data-transfer-favorite-list">
          {favoriteNodes.length === 0 ? (
            <div className="data-transfer-empty-block">
              <strong>还没有收藏节点</strong>
              <p>将常用节点加入收藏后，这里会提供快速发送入口。</p>
            </div>
          ) : (
            favoriteNodes.slice(0, 5).map((entry) => (
              <article
                key={entry.favorite.fingerprint}
                className="data-transfer-favorite-preview-row"
              >
                <div
                  className={`data-transfer-favorite-avatar ${
                    entry.online_node ? 'online' : 'offline'
                  }`}
                >
                  {entry.favorite.alias.slice(0, 2).toUpperCase()}
                </div>
                <div className="data-transfer-favorite-preview-copy">
                  <strong>{entry.favorite.alias}</strong>
                  <span>
                    {shortFingerprint(entry.favorite.fingerprint)} · 上次在线：
                    {entry.online_node
                      ? '刚刚'
                      : formatRelativeTime(entry.favorite.updated_at).replace('前', '前')}
                  </span>
                </div>
                <div className="data-transfer-favorite-preview-actions">
                  <span
                    className={`data-transfer-status-dot ${
                      entry.online_node ? 'online' : 'offline'
                    }`}
                  />
                  <button
                    className="data-transfer-subtle-icon-button"
                    disabled={!entry.online_node}
                    type="button"
                    onClick={() => {
                      if (entry.online_node) {
                        focusNodeTransfer(entry.online_node.id)
                      }
                    }}
                  >
                    ↗
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
        {actionLabel && favoriteNodes.length > 0 ? (
          <button
            className="data-transfer-favorite-footer"
            type="button"
            onClick={() => setActiveSection('nodes')}
          >
            前往节点列表 ({favoriteNodes.length})
          </button>
        ) : null}
      </article>
    )
  }

  function renderHistoryCard() {
    return (
      <article className="data-transfer-panel">
        <div className="data-transfer-panel-head">
          <div>
            <div className="data-transfer-panel-kicker">History</div>
            <strong>传输历史</strong>
          </div>
          <span className="data-transfer-inline-meta">
            最近 {sortedTasks.length} 条任务记录
          </span>
        </div>

        {sortedTasks.length === 0 ? (
          <div className="data-transfer-empty-block">
            <strong>暂无历史记录</strong>
            <p>发起直传、共享上传或共享下载后，这里会生成任务列表。</p>
          </div>
        ) : (
          <div className="data-transfer-history-table-wrap">
            <table className="data-transfer-history-table">
              <thead>
                <tr>
                  <th>文件</th>
                  <th>方向</th>
                  <th>对方节点</th>
                  <th>大小</th>
                  <th>状态</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {sortedTasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <div className="data-transfer-history-file">
                        <strong>{formatTaskPrimaryName(task)}</strong>
                        <small>{summarizeTaskFiles(task)}</small>
                      </div>
                    </td>
                    <td>{formatDirectionLabel(task.direction)}</td>
                    <td>{task.peer_alias}</td>
                    <td>{formatBytes(task.total_bytes)}</td>
                    <td>
                      <span className={`data-transfer-status-badge ${task.status}`}>
                        {formatTaskStatusLabel(task.status)}
                      </span>
                    </td>
                    <td>{formatDateTime(task.completed_at ?? task.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    )
  }

  function renderSectionContent() {
    switch (activeSection) {
      case 'nodes':
        return renderNodes()
      case 'transfer':
        return renderTransfer()
      case 'history':
        return renderHistory()
      case 'dashboard':
      default:
        return renderDashboard()
    }
  }

  if (loading && !snapshot) {
    return (
      <div className="data-transfer-workspace">
        <section className="data-transfer-empty">
          <div className="data-transfer-empty-block">
            <strong>数据传输工作区加载中</strong>
            <p>正在初始化局域网发现、共享索引与传输任务状态。</p>
          </div>
        </section>
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="data-transfer-workspace">
        <section className="data-transfer-empty">
          <div className="data-transfer-empty-block">
            <strong>工作区加载失败</strong>
            <p>当前未能读取数据传输快照，请稍后重试。</p>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="data-transfer-workspace data-transfer-prototype">
      <div className="data-transfer-shell">
        <aside className="data-transfer-sidebar">
          <section className="data-transfer-sidebar-panel data-transfer-sidebar-registration-panel">
            <div className="data-transfer-sidebar-card-head">
              <strong>注册到网络</strong>
              <button
                className={`data-transfer-sidebar-switch ${
                  snapshot.local_node.registration_enabled ? 'active' : ''
                }`}
                type="button"
                onClick={() => void handleToggleRegistration()}
              >
                <span />
              </button>
            </div>
            <div className="data-transfer-sidebar-status">
              <span
                className={`data-transfer-status-dot ${
                  snapshot.local_node.registration_enabled ? 'online' : 'offline'
                }`}
              />
              <strong>
                {snapshot.local_node.registration_enabled ? '已注册到网络' : '当前未注册到网络'}
              </strong>
            </div>
            <div className="data-transfer-sidebar-meta">
              <span>当前节点ID: {shortFingerprint(snapshot.local_node.fingerprint)}</span>
              <span>在线节点: {nodes.length} 个</span>
            </div>
          </section>

          <section className="data-transfer-sidebar-panel data-transfer-sidebar-menu-panel">
            <nav className="data-transfer-sidebar-nav">
              {WORKSPACE_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  className={`data-transfer-nav-item ${
                    activeSection === section.id ? 'active' : ''
                  }`}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                >
                  <span className="data-transfer-nav-icon">{section.icon}</span>
                  <span>{section.label}</span>
                </button>
              ))}
            </nav>

            <div className="data-transfer-sidebar-divider" />

            <section className="data-transfer-sidebar-foot">
              <button
                className="data-transfer-nav-item"
                type="button"
                onClick={() => pushNotice('传输设置已整合到“文件传输”视图右侧卡片中', 'info')}
              >
                <span className="data-transfer-nav-icon">⚙</span>
                <span>设置</span>
              </button>
            </section>
          </section>
        </aside>

        <section
          className={`data-transfer-main ${
            isHistorySection || isNodesSection || isTransferSection ? 'detail-mode' : ''
          }`}
        >
          {isHistorySection ? (
            renderHistory()
          ) : isNodesSection ? (
            renderNodes()
          ) : isTransferSection ? (
            <>
              {notice ? (
                <section className={`data-transfer-notice ${notice.tone}`}>{notice.message}</section>
              ) : null}

              {renderTransfer()}
            </>
          ) : (
            <>
              <section className="data-transfer-panel data-transfer-toolbar-card">
                <div className="data-transfer-toolbar-copy">
                  <h1>{sectionMeta.title}</h1>
                  <p>{sectionMeta.description}</p>
                </div>
                <div className="data-transfer-toolbar-actions">
                  <button
                    className="data-transfer-primary"
                    type="button"
                    onClick={() => void handleToolbarSend()}
                  >
                    选择文件
                  </button>
                  <button
                    className="data-transfer-secondary"
                    type="button"
                    onClick={() => void handleToolbarSend()}
                  >
                    发送文件
                  </button>
                  <button
                    className="data-transfer-secondary compact subtle"
                    type="button"
                    onClick={() => void handleRefreshDiscovery()}
                  >
                    刷新节点
                  </button>
                </div>
              </section>

              {notice ? (
                <section className={`data-transfer-notice ${notice.tone}`}>{notice.message}</section>
              ) : null}

              <section className="data-transfer-metrics">
                <MetricCard
                  accent="cyan"
                  badge="12%"
                  title="在线节点"
                  value={String(nodes.length)}
                  note="当前已完成注册并可互传的局域网节点数"
                  icon="◎"
                />
                <MetricCard
                  accent="gold"
                  badge={favoriteNodes.length > 0 ? `↑ ${favoriteNodes.length}` : '0'}
                  title="收藏节点"
                  value={String(favoriteNodes.length)}
                  note="会在共享白名单和快速发送中直接复用"
                  icon="★"
                />
                <MetricCard
                  accent="indigo"
                  badge={runningTasks.length > 0 ? '进行中' : '空闲'}
                  title="传输中任务"
                  value={String(runningTasks.length)}
                  note="直传、共享下载和上传共享都会统一进入任务流"
                  icon="⇄"
                />
                <MetricCard
                  accent="green"
                  badge={completedTransferBytes > 0 ? '累计' : '0'}
                  title="本月已传输"
                  value={formatBytes(completedTransferBytes)}
                  note="按当前可见任务统计的已完成传输数据量"
                  icon="✓"
                />
              </section>

              {renderSectionContent()}
            </>
          )}
        </section>
      </div>

      {busyMessage ? <section className="data-transfer-busy-bar">{busyMessage}</section> : null}
    </div>
  )
}

function MetricCard({
  accent,
  badge,
  title,
  value,
  note,
  icon,
}: {
  accent: 'cyan' | 'gold' | 'indigo' | 'green'
  badge: string
  title: string
  value: string
  note: string
  icon: string
}) {
  return (
    <article className={`data-transfer-metric-card data-transfer-metric-card-${accent}`}>
      <div className="data-transfer-metric-head">
        <span className={`data-transfer-metric-icon accent-${accent}`}>{icon}</span>
        <em className={`data-transfer-metric-badge accent-${accent}`}>{badge}</em>
      </div>
      <span className="data-transfer-metric-title">{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}

function HistoryStatCard({
  accent,
  icon,
  title,
  value,
}: {
  accent: 'cyan' | 'green' | 'pink' | 'purple'
  icon: string
  title: string
  value: string
}) {
  return (
    <article className={`data-transfer-history-stat accent-${accent}`}>
      <div className={`data-transfer-history-stat-icon accent-${accent}`}>{icon}</div>
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  )
}

function TransferQueueCard({
  task,
  onCancel,
}: {
  task: DataTransferTask
  onCancel: () => void
}) {
  const progressWidth = Math.max(
    task.status === 'pending' ? 1.2 : 0,
    Math.min(100, task.progress_percent),
  )
  const tone = getTransferQueueTone(task)

  return (
    <article className={`data-transfer-queue-card tone-${tone} status-${task.status}`}>
      <div className="data-transfer-queue-card-head">
        <div className={`data-transfer-queue-card-icon tone-${tone}`}>{getTransferQueueFileBadge(task)}</div>
        <div className="data-transfer-queue-card-copy">
          <strong>{formatTaskPrimaryName(task)}</strong>
          <span>{formatTransferQueueContext(task)}</span>
        </div>
        <span className={`data-transfer-queue-card-badge tone-${tone} status-${task.status}`}>
          {formatTransferQueueStatusLabel(task)}
        </span>
      </div>

      <div className="data-transfer-queue-card-progress">
        <div
          className="data-transfer-queue-card-progress-fill"
          style={{ width: `${progressWidth}%` }}
        />
      </div>

      <div className="data-transfer-queue-card-meta">
        <span>
          {Math.round(task.progress_percent)}% 完成 · {formatBytes(task.transferred_bytes)} /{' '}
          {formatBytes(task.total_bytes)}
        </span>
        <span>{formatTransferQueueRuntime(task)}</span>
      </div>

      <div className="data-transfer-queue-card-foot">
        {task.status === 'running' && task.transferred_bytes > 0 ? (
          <span className="data-transfer-queue-card-note accent-success">
            支持断点续传 · 已自动保存进度
          </span>
        ) : task.status === 'pending' ? (
          <span className="data-transfer-queue-card-note">等待节点握手后自动开始</span>
        ) : task.error_message ? (
          <span className="data-transfer-queue-card-note accent-error">{task.error_message}</span>
        ) : (
          <span className="data-transfer-queue-card-note">
            最近更新于 {formatDateTime(task.updated_at)}
          </span>
        )}

        {(task.status === 'running' || task.status === 'pending') && (
          <button className="data-transfer-secondary compact" type="button" onClick={onCancel}>
            取消任务
          </button>
        )}
      </div>
    </article>
  )
}

function TaskCard({
  task,
  onCancel,
}: {
  task: DataTransferTask
  onCancel: () => void
}) {
  return (
    <article className={`data-transfer-task-card ${task.status}`}>
      <div className="data-transfer-task-hero">
        <div className={`data-transfer-task-icon ${task.status}`}>
          {task.kind === 'shared_download' ? '⇩' : task.direction === 'incoming' ? '⇧' : '⇄'}
        </div>
        <div className="data-transfer-task-copy">
          <strong>{formatTaskPrimaryName(task)}</strong>
          <span>{summarizeTaskContext(task)}</span>
        </div>
        <span className={`data-transfer-status-badge ${task.status}`}>
          {formatTaskStatusLabel(task.status)}
        </span>
      </div>

      <div className="data-transfer-progress-track">
        <div
          className="data-transfer-progress-fill"
          style={{ width: `${Math.max(0, Math.min(100, task.progress_percent))}%` }}
        />
      </div>

      <div className="data-transfer-task-meta">
        <span>
          {Math.round(task.progress_percent)}% 完成 · {formatBytes(task.transferred_bytes)} /{' '}
          {formatBytes(task.total_bytes)}
        </span>
        <span>{task.current_file_name ?? '等待下一文件'}</span>
      </div>

      <div className="data-transfer-task-summary">
        <span>{task.files.length > 1 ? `共 ${task.files.length} 个文件` : '单文件任务'}</span>
        <span>{formatDateTime(task.updated_at)}</span>
      </div>

      {(task.status === 'running' || task.status === 'pending') && (
        <div className="data-transfer-action-row inline">
          <button className="data-transfer-secondary compact" type="button" onClick={onCancel}>
            取消任务
          </button>
        </div>
      )}

      {task.error_message ? (
        <div className="data-transfer-task-error">{task.error_message}</div>
      ) : (
        <div className="data-transfer-inline-note accent-success">
          支持断点续传 · 已自动保存传输进度
        </div>
      )}
    </article>
  )
}

function compareTransferQueueTasks(left: DataTransferTask, right: DataTransferTask) {
  const weight = (task: DataTransferTask) => {
    if (task.status === 'running') {
      return 0
    }
    if (task.status === 'pending') {
      return 1
    }
    return 2
  }

  const weightDelta = weight(left) - weight(right)
  if (weightDelta !== 0) {
    return weightDelta
  }

  return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
}

function mergeSelectedTransferFiles(
  previous: DataTransferSelectedFile[],
  next: DataTransferSelectedFile[],
) {
  const fileMap = new Map(previous.map((file) => [file.file_path, file]))
  next.forEach((file) => {
    fileMap.set(file.file_path, file)
  })
  return Array.from(fileMap.values())
}

function formatScopeLabel(scope: string) {
  switch (scope) {
    case 'all':
      return '全部节点可见'
    case 'favorite_only':
      return '仅收藏节点'
    case 'selected_nodes':
      return '仅指定节点'
    default:
      return scope
  }
}

function formatDirectionLabel(direction: string) {
  return direction === 'incoming' ? '接收' : '发送'
}

function formatTaskStatusLabel(status: string) {
  switch (status) {
    case 'pending':
      return '等待中'
    case 'running':
      return '传输中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'canceled':
      return '已取消'
    default:
      return status
  }
}

function formatTaskPrimaryName(task: DataTransferTask) {
  return task.files[0]?.file_name ?? task.current_file_name ?? task.id
}

function summarizeTaskFiles(task: DataTransferTask) {
  if (task.files.length <= 1) {
    return `${formatDirectionLabel(task.direction)} · ${task.kind === 'shared_download' ? '共享下载' : '直连发送'}`
  }
  return `${task.files.length} 个文件 · ${task.kind === 'shared_download' ? '共享下载' : '直连发送'}`
}

function summarizeTaskContext(task: DataTransferTask) {
  return `${formatDirectionLabel(task.direction)}到 ${task.peer_alias} · ${formatBytes(task.total_bytes)}`
}

function formatTransferQueueStatusLabel(task: DataTransferTask) {
  switch (task.status) {
    case 'pending':
      return '等待中'
    case 'running':
      if (task.kind === 'publish_upload') {
        return '上传中'
      }
      if (task.kind === 'shared_download') {
        return '下载中'
      }
      return '传输中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'canceled':
      return '已取消'
    default:
      return task.status
  }
}

function formatTransferQueueContext(task: DataTransferTask) {
  if (task.kind === 'publish_upload') {
    return `${task.peer_alias} · 所有节点可访问`
  }
  if (task.kind === 'shared_download') {
    return `接收自: ${task.peer_alias}`
  }
  return `发送到: ${task.peer_alias}`
}

function getTransferQueueTone(task: DataTransferTask) {
  if (task.status === 'pending') {
    return 'waiting'
  }
  if (task.kind === 'publish_upload') {
    return 'upload'
  }
  if (task.kind === 'shared_download') {
    return 'download'
  }
  return 'transfer'
}

function getTransferQueueFileBadge(task: DataTransferTask) {
  const fileName = formatTaskPrimaryName(task)
  const extension = fileName.includes('.') ? fileName.split('.').pop() ?? '' : ''
  const badge = extension.trim().slice(0, 3).toUpperCase()
  return badge || 'FILE'
}

function formatTransferQueueRuntime(task: DataTransferTask) {
  if (task.status === 'pending') {
    return '等待节点响应 · 预计10秒后开始'
  }

  if (task.status === 'running') {
    const speed = estimateTaskSpeed(task)
    const remainingSeconds = estimateTaskRemainingSeconds(task, speed)

    if (speed > 0 && remainingSeconds != null) {
      return `速度: ${formatSpeed(speed)} · 剩余 ${formatDurationText(remainingSeconds)}`
    }

    return '正在建立传输通道'
  }

  if (task.status === 'completed') {
    return formatHistoryDuration(task)
  }

  if (task.status === 'failed' || task.status === 'canceled') {
    return task.error_message ? '任务已中断' : '传输未完成'
  }

  return formatDateTime(task.updated_at)
}

function formatHistoryStatusLabel(status: string) {
  switch (status) {
    case 'completed':
      return '成功'
    case 'running':
      return '传输中'
    case 'pending':
      return '等待中'
    case 'failed':
      return '失败'
    case 'canceled':
      return '已取消'
    default:
      return formatTaskStatusLabel(status)
  }
}

function formatHistoryStatusNote(task: DataTransferTask) {
  if (task.status === 'running' || task.status === 'pending') {
    return `进度 ${Math.round(task.progress_percent)}%`
  }
  if (task.status === 'failed' || task.status === 'canceled') {
    return task.error_message ? '任务已中断' : '传输未完成'
  }
  return formatHistoryDuration(task)
}

function formatHistoryFileMeta(task: DataTransferTask) {
  if (task.files.length > 1) {
    return `${task.files.length} 个文件 · ${task.kind === 'shared_download' ? '共享下载' : '批量传输'}`
  }

  if (task.kind === 'shared_download') {
    return '共享下载'
  }

  return `${formatDirectionLabel(task.direction)}任务`
}

function formatHistoryDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = today - 24 * 60 * 60 * 1000
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const timeText = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

  if (targetDay === today) {
    return `今天 ${timeText}`
  }
  if (targetDay === yesterday) {
    return `昨天 ${timeText}`
  }

  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(
    2,
    '0',
  )} ${timeText}`
}

function formatHistoryDuration(task: DataTransferTask) {
  const startedAt = new Date(task.started_at).getTime()
  const endedAt = new Date(task.completed_at ?? task.updated_at).getTime()
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt <= startedAt) {
    return '耗时未记录'
  }

  return `耗时 ${formatDurationText(Math.round((endedAt - startedAt) / 1000))}`
}

function formatDurationText(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '0秒'
  }

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}小时${minutes}分${seconds}秒`
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`
  }
  return `${seconds}秒`
}

function formatSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '0 B/s'
  }
  return `${formatBytes(bytesPerSecond)}/s`
}

function estimateTaskSpeed(task: DataTransferTask) {
  const startedAt = new Date(task.started_at).getTime()
  const referenceAt =
    task.status === 'completed'
      ? new Date(task.completed_at ?? task.updated_at).getTime()
      : Math.max(Date.now(), new Date(task.updated_at).getTime())

  if (Number.isNaN(startedAt) || Number.isNaN(referenceAt) || referenceAt <= startedAt) {
    return 0
  }

  const elapsedSeconds = (referenceAt - startedAt) / 1000
  if (elapsedSeconds <= 0 || task.transferred_bytes <= 0) {
    return 0
  }

  return task.transferred_bytes / elapsedSeconds
}

function estimateTaskRemainingSeconds(task: DataTransferTask, speed = estimateTaskSpeed(task)) {
  if (task.status !== 'running' || speed <= 0) {
    return null
  }

  const remainingBytes = Math.max(0, task.total_bytes - task.transferred_bytes)
  if (remainingBytes <= 0) {
    return 0
  }

  return Math.max(0, Math.round(remainingBytes / speed))
}

function getHistoryStatusClass(status: string) {
  switch (status) {
    case 'completed':
      return 'success'
    case 'running':
    case 'pending':
      return 'running'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'warning'
    default:
      return 'default'
  }
}

function getHistoryAccentClass(task: DataTransferTask) {
  if (task.status === 'failed' || task.status === 'canceled') {
    return 'accent-pink'
  }
  if (task.direction === 'incoming') {
    return 'accent-green'
  }
  if (task.kind === 'shared_download') {
    return 'accent-purple'
  }
  return 'accent-cyan'
}

function getHistoryFileBadge(task: DataTransferTask) {
  const fileName = formatTaskPrimaryName(task)
  const extension = fileName.includes('.') ? fileName.split('.').pop() ?? '' : ''
  const badge = extension.trim().slice(0, 3).toUpperCase()
  return badge || 'FILE'
}

function getHistoryPeerBadge(alias: string) {
  return alias.trim().slice(0, 2).toUpperCase() || 'NA'
}

function buildPageNumbers(totalPages: number, currentPage: number) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const startPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4))
  return Array.from({ length: 5 }, (_, index) => startPage + index)
}

function formatSourceLabel(source: string) {
  switch (source) {
    case 'multicast':
      return '多播发现'
    case 'favorite_scan':
      return '收藏回扫'
    case 'subnet_scan':
      return '子网扫描'
    default:
      return source
  }
}

function compareNodeListItems(left: NodeListItem, right: NodeListItem) {
  if (left.is_favorite !== right.is_favorite) {
    return left.is_favorite ? -1 : 1
  }
  if (left.is_online !== right.is_online) {
    return left.is_online ? -1 : 1
  }

  const recentDelta = compareRecentNodeListItems(left, right)
  if (recentDelta !== 0) {
    return recentDelta
  }

  return left.alias.localeCompare(right.alias, 'zh-CN')
}

function compareRecentNodeListItems(left: NodeListItem, right: NodeListItem) {
  const leftTime = new Date(left.last_active_at).getTime()
  const rightTime = new Date(right.last_active_at).getTime()

  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) {
    return 0
  }
  if (Number.isNaN(leftTime)) {
    return 1
  }
  if (Number.isNaN(rightTime)) {
    return -1
  }
  return rightTime - leftTime
}

function getNodeAccentClass(seed: string) {
  const accents = ['accent-cyan', 'accent-purple', 'accent-green', 'accent-orange']
  const total = seed.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0)
  return accents[total % accents.length]
}

function getNodeBadge(alias: string) {
  const latin = alias.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase()
  if (latin) {
    return latin
  }
  return alias.trim().slice(0, 2).toUpperCase() || 'ND'
}

function formatNodeRecordMeta(item: NodeListItem) {
  const sourceLabel = item.is_online ? formatSourceLabel(item.source) : '收藏节点'
  return `${item.device_model ?? normalizeDeviceType(item.device_type)} · ${sourceLabel}`
}

function normalizeDeviceType(deviceType: string) {
  switch (deviceType) {
    case 'desktop':
      return '桌面设备'
    case 'server':
      return '服务器'
    case 'mobile':
      return '移动设备'
    default:
      return deviceType
  }
}

function shortFingerprint(value: string) {
  if (value.length <= 18) {
    return value
  }
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

function shortPath(value: string) {
  if (value.length <= 28) {
    return value
  }
  return `${value.slice(0, 14)}…${value.slice(-10)}`
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) {
    return value
  }

  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (deltaSeconds < 5) {
    return '刚刚更新'
  }
  if (deltaSeconds < 60) {
    return `${deltaSeconds} 秒前`
  }
  const deltaMinutes = Math.round(deltaSeconds / 60)
  if (deltaMinutes < 60) {
    return `${deltaMinutes} 分钟前`
  }
  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 24) {
    return `${deltaHours} 小时前`
  }
  return `${Math.round(deltaHours / 24)} 天前`
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

function toErrorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

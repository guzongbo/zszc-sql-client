import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  acceptDataTransferIncomingTask,
  cancelDataTransferTask,
  chooseDataTransferFolder,
  chooseDataTransferFiles,
  getDataTransferSnapshot,
  publishDataTransferFiles,
  refreshDataTransferDiscovery,
  rejectDataTransferIncomingTask,
  resolveDataTransferSelectedFiles,
  removeDataTransferPublishedShare,
  setDataTransferRegistrationEnabled,
  startDataTransferDirectSend,
  updateDataTransferFavorite,
} from '../../api'
import { Modal } from '../../shared/components/AppChrome'
import type {
  DataTransferFavoriteNode,
  DataTransferNode,
  DataTransferPublishedShare,
  DataTransferSelectedFile,
  DataTransferShareScope,
  DataTransferSnapshot,
  DataTransferTask,
} from '../../types'
import './dataTransfer.css'

type NoticeTone = 'success' | 'error' | 'info'
type HistoryFilter = 'all' | 'sent' | 'received' | 'failed'
type NodeFilter = 'all' | 'online' | 'favorite' | 'recent'
type ShareFilter = 'all' | 'active' | 'expired'
type ShareValidityMode = 'custom' | 'permanent'
type WorkspaceSection = 'dashboard' | 'nodes' | 'transfer' | 'history'
type ShareWizardStep = 1 | 2
type TransferWizardStep = 1 | 2 | 3

type NoticeState = {
  tone: NoticeTone
  message: string
}

type ActivityLogTone = 'progress' | 'success' | 'error' | 'info'

type ActivityLogEntry = {
  id: number
  tone: ActivityLogTone
  message: string
  detail: string
}

type SharePresentationMeta = {
  download_count: number
  today_download_count: number
  validity_label: string
  status: 'active' | 'expired'
  is_expired: boolean
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

type TransferSessionNode = {
  node_id: string
  alias: string
  fingerprint: string
  device_model: string | null
  device_type: string
  ip: string | null
  port: number | null
  favorite: boolean
}

const SNAPSHOT_POLL_INTERVAL_MS = 1500
const NOTICE_HIDE_DELAY_MS = 3200
const HISTORY_PAGE_SIZE = 5
const NODE_PAGE_SIZE = 5
const SHARE_VALIDITY_PRESETS = [
  { label: '1天', days: 1 },
  { label: '7天', days: 7 },
  { label: '30天', days: 30 },
  { label: '90天', days: 90 },
  { label: '180天', days: 180 },
  { label: '1年', days: 365 },
] as const
const SHARE_SCOPE_OPTIONS: Array<{
  scope: DataTransferShareScope
  label: string
  description: string
  icon: 'globe' | 'lock' | 'users'
}> = [
  {
    scope: 'all',
    label: '公开访问',
    description: '当前网络中所有在线节点都可以查看和下载',
    icon: 'globe',
  },
  {
    scope: 'password_protected',
    label: '密码保护',
    description: '需要输入访问密码才可以查看和下载',
    icon: 'lock',
  },
  {
    scope: 'selected_nodes',
    label: '指定节点',
    description: '只有你选中的节点可以查看和下载',
    icon: 'users',
  },
]

const WORKSPACE_SECTIONS: Array<{
  id: WorkspaceSection
  icon: string
  label: string
  title: string
  description: string
}> = [
  {
    id: 'transfer',
    icon: '⇪',
    label: '文件传输',
    title: '文件传输',
    description: '选择文件、勾选节点并批量发起传输，底部持续查看当前任务进度',
  },
  {
    id: 'dashboard',
    icon: '◫',
    label: '文件共享',
    title: '文件共享',
    description: '选择单个或多个文件开启共享，统一对当前网络中的节点开放浏览与下载',
  },
  {
    id: 'nodes',
    icon: '◌',
    label: '节点列表',
    title: '节点列表',
    description: '管理网络中的所有节点，查看状态并快速发起文件传输',
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
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([])
  const [selectedTransferFiles, setSelectedTransferFiles] = useState<DataTransferSelectedFile[]>(
    [],
  )
  const [selectedShareFiles, setSelectedShareFiles] = useState<DataTransferSelectedFile[]>([])
  const [shareWizardStep, setShareWizardStep] = useState<ShareWizardStep>(1)
  const [shareScope, setShareScope] = useState<DataTransferShareScope>('all')
  const [sharePassword, setSharePassword] = useState('')
  const [shareValidityMode, setShareValidityMode] = useState<ShareValidityMode>('custom')
  const [shareValidityDate, setShareValidityDate] = useState(() => getFutureDateValue(30))
  const [shareValidityTime, setShareValidityTime] = useState('23:59:59')
  const [shareTargetSearch, setShareTargetSearch] = useState('')
  const [shareTargetFavoriteOnly, setShareTargetFavoriteOnly] = useState(false)
  const [selectedShareTargetFingerprints, setSelectedShareTargetFingerprints] = useState<
    string[]
  >([])
  const [selectedTransferNodeIds, setSelectedTransferNodeIds] = useState<string[]>([])
  const [transferWizardStep, setTransferWizardStep] = useState<TransferWizardStep>(1)
  const [transferSessionTaskIds, setTransferSessionTaskIds] = useState<Record<string, string>>({})
  const [transferSessionNodes, setTransferSessionNodes] = useState<
    Record<string, TransferSessionNode>
  >({})
  const [transferNodeDraftSearch, setTransferNodeDraftSearch] = useState('')
  const [transferNodeSearch, setTransferNodeSearch] = useState('')
  const [nodeSearch, setNodeSearch] = useState('')
  const [nodeFilter, setNodeFilter] = useState<NodeFilter>('all')
  const [shareSearch, setShareSearch] = useState('')
  const [shareFilter, setShareFilter] = useState<ShareFilter>('all')
  const [previewShareId, setPreviewShareId] = useState<string | null>(null)
  const [nodePage, setNodePage] = useState(1)
  const [historySearch, setHistorySearch] = useState('')
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')
  const [historyPage, setHistoryPage] = useState(1)
  const [incomingModalTaskId, setIncomingModalTaskId] = useState<string | null>(null)
  const [incomingDestinationDir, setIncomingDestinationDir] = useState('')
  const [dismissedIncomingTaskIds, setDismissedIncomingTaskIds] = useState<string[]>([])
  const noticeTimerRef = useRef<number | null>(null)
  const activityLogListRef = useRef<HTMLDivElement | null>(null)
  const activityLogIdRef = useRef(0)
  const previousIncomingTaskIdRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadInitialSnapshot() {
      try {
        const nextSnapshot = await getDataTransferSnapshot()
        if (cancelled) {
          return
        }
        applySnapshot(nextSnapshot)
        pushActivity(
          '数据传输工作区已就绪',
          'success',
          `本机节点 ${shortFingerprint(nextSnapshot.local_node.fingerprint)} 已载入`,
        )
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

  useEffect(() => {
    const container = activityLogListRef.current
    if (!container) {
      return
    }
    container.scrollTop = container.scrollHeight
  }, [activityLogs.length])

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
  const transferStatusNodes = useMemo<TransferSessionNode[]>(
    () =>
      selectedTransferNodeIds
        .map((nodeId) => {
          const onlineNode =
            selectedTransferNodes.find((node) => node.id === nodeId) ??
            transferSelectableNodes.find((node) => node.id === nodeId)
          if (onlineNode) {
            return {
              node_id: onlineNode.id,
              alias: onlineNode.alias,
              fingerprint: onlineNode.fingerprint,
              device_model: onlineNode.device_model,
              device_type: onlineNode.device_type,
              ip: onlineNode.ip,
              port: onlineNode.port,
              favorite: onlineNode.favorite,
            }
          }
          return transferSessionNodes[nodeId] ?? null
        })
        .filter((node): node is TransferSessionNode => node != null),
    [selectedTransferNodeIds, selectedTransferNodes, transferSelectableNodes, transferSessionNodes],
  )
  const selectedShareBytes = useMemo(
    () => selectedShareFiles.reduce((total, file) => total + file.size, 0),
    [selectedShareFiles],
  )
  const filteredShareTargetNodes = useMemo(() => {
    const keyword = shareTargetSearch.trim().toLowerCase()
    return nodeListItems.filter((item) => {
      if (shareTargetFavoriteOnly && !item.is_favorite) {
        return false
      }
      if (!keyword) {
        return true
      }

      return [item.alias, item.fingerprint, item.device_model ?? '', item.ip ?? '']
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [nodeListItems, shareTargetFavoriteOnly, shareTargetSearch])
  const selectedShareTargetNodes = useMemo(
    () =>
      nodeListItems.filter((item) => selectedShareTargetFingerprints.includes(item.fingerprint)),
    [nodeListItems, selectedShareTargetFingerprints],
  )
  const publishedShares = useMemo(() => snapshot?.published_shares ?? [], [snapshot?.published_shares])
  const selectedTransferBytes = useMemo(
    () => selectedTransferFiles.reduce((total, file) => total + file.size, 0),
    [selectedTransferFiles],
  )
  const onlineNodeCount = useMemo(
    () => nodeListItems.filter((item) => item.is_online).length,
    [nodeListItems],
  )
  const favoriteNodeCount = useMemo(
    () => nodeListItems.filter((item) => item.is_favorite).length,
    [nodeListItems],
  )
  const publishedShareCount = publishedShares.length
  const sharePresentationRecords = useMemo(
    () =>
      publishedShares.map((share, index) => ({
        share,
        ...getSharePresentationMeta(share, index),
      })),
    [publishedShares],
  )
  const filteredPublishedShares = useMemo(() => {
    const keyword = shareSearch.trim().toLowerCase()

    return sharePresentationRecords.filter((record) => {
      const { share } = record
      const matchesFilter =
        shareFilter === 'all'
          ? true
          : shareFilter === 'active'
            ? !record.is_expired
            : record.is_expired

      if (!matchesFilter) {
        return false
      }

      if (!keyword) {
        return true
      }

      return [share.title, ...share.files.map((file) => file.file_name)]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [sharePresentationRecords, shareFilter, shareSearch])
  const totalPublishedFileCount = useMemo(
    () => publishedShares.reduce((total, share) => total + share.file_count, 0),
    [publishedShares],
  )
  const totalPublishedBytes = useMemo(
    () => publishedShares.reduce((total, share) => total + share.total_bytes, 0),
    [publishedShares],
  )
  const activePublishedShareCount = useMemo(
    () => sharePresentationRecords.filter((record) => !record.is_expired).length,
    [sharePresentationRecords],
  )
  const expiredPublishedShareCount = useMemo(
    () => sharePresentationRecords.filter((record) => record.is_expired).length,
    [sharePresentationRecords],
  )
  const totalShareDownloads = useMemo(
    () =>
      sharePresentationRecords.reduce((total, record) => total + record.download_count, 0),
    [sharePresentationRecords],
  )
  const todayShareDownloads = useMemo(
    () =>
      sharePresentationRecords.reduce(
        (total, record) => total + record.today_download_count,
        0,
      ),
    [sharePresentationRecords],
  )
  const shareTabs = useMemo(
    () => [
      { id: 'all' as ShareFilter, label: '全部', count: publishedShares.length },
      {
        id: 'active' as ShareFilter,
        label: '有效期内',
        count: activePublishedShareCount,
      },
      {
        id: 'expired' as ShareFilter,
        label: '已过期',
        count: expiredPublishedShareCount,
      },
    ],
    [activePublishedShareCount, expiredPublishedShareCount, publishedShares.length],
  )
  const isShareBusy = useMemo(
    () => busyMessage.includes('共享') || busyMessage.includes('移除共享'),
    [busyMessage],
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
  const activeIncomingTransferTask = useMemo(() => {
    if (!incomingModalTaskId) {
      return null
    }

    return sortedTasks.find((task) => task.id === incomingModalTaskId) ?? null
  }, [incomingModalTaskId, sortedTasks])
  const isIncomingDialogBusy = Boolean(busyMessage) && activeIncomingTransferTask != null

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

  useEffect(() => {
    if (selectedTransferFiles.length === 0 && transferWizardStep !== 1) {
      setTransferWizardStep(1)
    }
  }, [selectedTransferFiles.length, transferWizardStep])

  useEffect(() => {
    if (selectedShareFiles.length === 0) {
      setShareWizardStep(1)
      setShareScope('all')
      setSharePassword('')
      setShareValidityMode('custom')
      setShareValidityDate(getFutureDateValue(30))
      setShareValidityTime('23:59:59')
      setShareTargetSearch('')
      setShareTargetFavoriteOnly(false)
      setSelectedShareTargetFingerprints([])
    }
  }, [selectedShareFiles.length])

  useEffect(() => {
    setDismissedIncomingTaskIds((previous) =>
      previous.filter((taskId) => sortedTasks.some((task) => task.id === taskId)),
    )
  }, [sortedTasks])

  useEffect(() => {
    const currentTask =
      incomingModalTaskId != null
        ? sortedTasks.find((task) => task.id === incomingModalTaskId) ?? null
        : null
    const currentVisible =
      currentTask != null &&
      (isIncomingApprovalTask(currentTask) || isIncomingTransferProgressTask(currentTask))

    if (currentVisible) {
      return
    }

    const nextTask =
      sortedTasks.find(
        (task) =>
          !dismissedIncomingTaskIds.includes(task.id) &&
          (isIncomingApprovalTask(task) || isIncomingTransferProgressTask(task)),
      ) ?? null

    if (nextTask?.id !== incomingModalTaskId) {
      setIncomingModalTaskId(nextTask?.id ?? null)
    }
  }, [dismissedIncomingTaskIds, incomingModalTaskId, sortedTasks])

  useEffect(() => {
    const task =
      incomingModalTaskId != null
        ? sortedTasks.find((item) => item.id === incomingModalTaskId) ?? null
        : null

    if (!task) {
      previousIncomingTaskIdRef.current = null
      return
    }

    if (previousIncomingTaskIdRef.current === task.id) {
      return
    }

    previousIncomingTaskIdRef.current = task.id
    if (isIncomingApprovalTask(task)) {
      setIncomingDestinationDir(snapshot?.default_download_dir ?? '')
    }
  }, [incomingModalTaskId, snapshot?.default_download_dir, sortedTasks])

  function applySnapshot(nextSnapshot: DataTransferSnapshot) {
    setSnapshot(nextSnapshot)
    setSelectedTransferNodeIds((previous) =>
      previous.filter((nodeId) => nextSnapshot.nodes.some((node) => node.id === nodeId)),
    )
  }

  function pushActivity(message: string, tone: ActivityLogTone, detail?: string) {
    const nextEntry: ActivityLogEntry = {
      id: activityLogIdRef.current++,
      tone,
      message,
      detail: detail ?? `${formatActivityToneLabel(tone)} · ${formatFullDateTime(new Date().toISOString())}`,
    }

    setActivityLogs((previous) => [...previous.slice(-39), nextEntry])
  }

  function clearActivityLogs() {
    setActivityLogs([])
  }

  function pushNotice(message: string, tone: NoticeTone) {
    setNotice({ message, tone })
    pushActivity(message, tone)
  }

  function withBusy(message: string) {
    setBusyMessage(message)
    pushActivity(message, 'progress')
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

  function handleApplyTransferNodeSearch() {
    setTransferNodeSearch(transferNodeDraftSearch)
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
      setSelectedTransferFiles((previous) => mergeSelectedFiles(previous, files))
    } catch (error) {
      pushNotice(toErrorText(error, '读取文件信息失败'), 'error')
    }
  }

  async function appendShareFiles(filePaths: string[]) {
    const nextPaths = Array.from(new Set(filePaths.filter(Boolean)))
    if (nextPaths.length === 0) {
      return
    }

    try {
      const files = await resolveDataTransferSelectedFiles({ file_paths: nextPaths })
      setSelectedShareFiles((previous) => mergeSelectedFiles(previous, files))
    } catch (error) {
      pushNotice(toErrorText(error, '读取共享文件信息失败'), 'error')
    }
  }

  async function handleChooseShareFiles() {
    try {
      const result = await chooseDataTransferFiles()
      if (!result.canceled) {
        await appendShareFiles(result.file_paths)
      }
    } catch (error) {
      pushNotice(toErrorText(error, '选择共享文件失败'), 'error')
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
    setTransferWizardStep(1)
    await handleChooseTransferFiles()
  }

  function removeSelectedShareFile(filePath: string) {
    setSelectedShareFiles((previous) => previous.filter((item) => item.file_path !== filePath))
  }

  function clearShareDraft() {
    setSelectedShareFiles([])
    setShareWizardStep(1)
    setShareScope('all')
    setSharePassword('')
    setShareValidityMode('custom')
    setShareValidityDate(getFutureDateValue(30))
    setShareValidityTime('23:59:59')
    setShareTargetSearch('')
    setShareTargetFavoriteOnly(false)
    setSelectedShareTargetFingerprints([])
  }

  function goToSharePermissionStep() {
    if (selectedShareFiles.length === 0) {
      pushNotice('请先选择至少一个共享文件', 'error')
      return
    }
    setShareWizardStep(2)
  }

  function toggleShareTargetFingerprint(fingerprint: string) {
    setSelectedShareTargetFingerprints((previous) =>
      previous.includes(fingerprint)
        ? previous.filter((item) => item !== fingerprint)
        : [...previous, fingerprint],
    )
  }

  function applyShareValidityPreset(days: number) {
    setShareValidityMode('custom')
    setShareValidityDate(getFutureDateValue(days))
  }

  function toggleSharePreview(shareId: string) {
    setPreviewShareId((previous) => (previous === shareId ? null : shareId))
  }

  async function handlePublishShare() {
    if (selectedShareFiles.length === 0) {
      pushNotice('请先选择至少一个共享文件', 'error')
      return
    }

    if (shareScope === 'selected_nodes' && selectedShareTargetFingerprints.length === 0) {
      pushNotice('请至少选择一个可访问的指定节点', 'error')
      return
    }
    if (shareScope === 'password_protected' && !sharePassword.trim()) {
      pushNotice('请先设置共享访问密码', 'error')
      return
    }

    withBusy(
      selectedShareFiles.length === 1
        ? `正在开启共享：${selectedShareFiles[0].file_name}…`
        : `正在开启 ${selectedShareFiles.length} 个文件的共享…`,
    )
    try {
      const nextSnapshot = await publishDataTransferFiles({
        file_paths: selectedShareFiles.map((file) => file.file_path),
        scope: shareScope,
        allowed_fingerprints:
          shareScope === 'selected_nodes' ? selectedShareTargetFingerprints : [],
        password: shareScope === 'password_protected' ? sharePassword.trim() : '',
      })
      applySnapshot(nextSnapshot)
      clearShareDraft()
      pushNotice(`文件共享已开启，访问范围为${formatShareScopeLabel(shareScope)}`, 'success')
    } catch (error) {
      pushNotice(toErrorText(error, '开启文件共享失败'), 'error')
    } finally {
      clearBusy()
    }
  }

  async function handleStartDirectSend() {
    if (selectedTransferNodeIds.length === 0) {
      pushNotice('请至少勾选一个目标节点', 'error')
      return false
    }
    if (selectedTransferFiles.length === 0) {
      pushNotice('请先选择需要发送的文件', 'error')
      return false
    }

    const targetNodes = selectedTransferNodes.filter((node) =>
      selectedTransferNodeIds.includes(node.id),
    )
    if (targetNodes.length === 0) {
      pushNotice('当前选中的节点不可用，请重新选择', 'error')
      return false
    }

    withBusy(
      targetNodes.length === 1
        ? `正在发起直传到 ${targetNodes[0].alias}…`
        : `正在向 ${targetNodes.length} 个节点发起传输…`,
    )
    try {
      const filePaths = selectedTransferFiles.map((file) => file.file_path)
      const taskIds: string[] = []
      const nextTaskIds: Record<string, string> = {}

      for (const node of targetNodes) {
        const result = await startDataTransferDirectSend({
          node_id: node.id,
          file_paths: filePaths,
        })
        taskIds.push(result.task_id)
        nextTaskIds[node.id] = result.task_id
      }

      setTransferSessionTaskIds((previous) => ({ ...previous, ...nextTaskIds }))
      setTransferSessionNodes((previous) => ({
        ...previous,
        ...Object.fromEntries(
          targetNodes.map((node) => [
            node.id,
            {
              node_id: node.id,
              alias: node.alias,
              fingerprint: node.fingerprint,
              device_model: node.device_model,
              device_type: node.device_type,
              ip: node.ip,
              port: node.port,
              favorite: node.favorite,
            },
          ]),
        ),
      }))
      setTransferWizardStep(3)
      pushNotice(
        taskIds.length === 1 ? `已创建传输任务 ${taskIds[0]}` : `已创建 ${taskIds.length} 个传输任务`,
        'success',
      )
      await refreshSnapshot()
      return true
    } catch (error) {
      pushNotice(toErrorText(error, '发起直传失败'), 'error')
      return false
    } finally {
      clearBusy()
    }
  }

  async function handleRetryTransferNode(nodeId: string, actionLabel: string) {
    if (selectedTransferFiles.length === 0) {
      pushNotice('当前没有可重试的文件，请先重新选择文件', 'error')
      return
    }

    const node =
      transferSelectableNodes.find((item) => item.id === nodeId) ?? transferSessionNodes[nodeId]
    if (!node) {
      pushNotice('目标节点不可用，请重新选择接收节点', 'error')
      return
    }

    withBusy(`正在向 ${node.alias}${actionLabel}…`)
    try {
      const result = await startDataTransferDirectSend({
        node_id: nodeId,
        file_paths: selectedTransferFiles.map((file) => file.file_path),
      })
      setTransferSessionTaskIds((previous) => ({ ...previous, [nodeId]: result.task_id }))
      setTransferSessionNodes((previous) => ({
        ...previous,
        [nodeId]: {
          node_id: nodeId,
          alias: node.alias,
          fingerprint: node.fingerprint,
          device_model: node.device_model,
          device_type: node.device_type,
          ip: node.ip,
          port: node.port,
          favorite: node.favorite,
        },
      }))
      setTransferWizardStep(3)
      pushNotice(`${node.alias}${actionLabel}已提交`, 'success')
      await refreshSnapshot()
    } catch (error) {
      pushNotice(toErrorText(error, `${actionLabel}失败`), 'error')
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

  function handleOpenIncomingTask(task: DataTransferTask) {
    setIncomingModalTaskId(task.id)
    setDismissedIncomingTaskIds((previous) => previous.filter((item) => item !== task.id))
    if (isIncomingApprovalTask(task)) {
      setIncomingDestinationDir(snapshot?.default_download_dir ?? '')
    }
  }

  function handleDismissIncomingTask(taskId: string) {
    setIncomingModalTaskId((previous) => (previous === taskId ? null : previous))
    setDismissedIncomingTaskIds((previous) =>
      previous.includes(taskId) ? previous : [...previous, taskId],
    )
  }

  async function handleChooseIncomingDestination() {
    try {
      const folder = await chooseDataTransferFolder()
      if (folder.canceled) {
        pushNotice('已取消选择接收目录', 'info')
        return
      }

      setIncomingDestinationDir(folder.directory_path ?? snapshot?.default_download_dir ?? '')
    } catch (error) {
      pushNotice(toErrorText(error, '选择接收目录失败'), 'error')
    }
  }

  async function handleAcceptIncomingTask(task: DataTransferTask) {
    const destinationDir = incomingDestinationDir.trim() || snapshot?.default_download_dir || ''
    if (!destinationDir) {
      pushNotice('请先设置接收目录', 'error')
      return
    }

    withBusy(`正在确认接收 ${formatTaskPrimaryName(task)}…`)
    try {
      const nextSnapshot = await acceptDataTransferIncomingTask({
        task_id: task.id,
        destination_dir: destinationDir,
      })
      applySnapshot(nextSnapshot)
      setIncomingModalTaskId(task.id)
      setDismissedIncomingTaskIds((previous) => previous.filter((item) => item !== task.id))
      pushNotice('已确认接收，等待发送方开始传输', 'success')
    } catch (error) {
      pushNotice(toErrorText(error, '确认接收失败'), 'error')
    } finally {
      clearBusy()
    }
  }

  async function handleRejectIncomingTask(taskId: string) {
    withBusy(`正在拒绝接收任务 ${taskId}…`)
    try {
      const nextSnapshot = await rejectDataTransferIncomingTask({ task_id: taskId })
      applySnapshot(nextSnapshot)
      setIncomingModalTaskId((previous) => (previous === taskId ? null : previous))
      setDismissedIncomingTaskIds((previous) =>
        previous.includes(taskId) ? previous : [...previous, taskId],
      )
      pushNotice('已拒绝本次文件接收', 'info')
    } catch (error) {
      pushNotice(toErrorText(error, '拒绝接收失败'), 'error')
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

  function removeSelectedTransferFile(filePath: string) {
    setSelectedTransferFiles((previous) => previous.filter((item) => item.file_path !== filePath))
  }

  function focusNodeTransfer(nodeId: string) {
    setSelectedTransferNodeIds((previous) =>
      previous.includes(nodeId) ? previous : [...previous, nodeId],
    )
    setActiveSection('transfer')
    setTransferWizardStep(selectedTransferFiles.length > 0 ? 2 : 1)
  }

  function handleGoToTransferStep(step: TransferWizardStep) {
    if (step === 2 && selectedTransferFiles.length === 0) {
      pushNotice('请先选择至少一个待发送文件', 'error')
      return
    }
    if (step === 3 && selectedTransferNodeIds.length === 0) {
      pushNotice('请先选择至少一个接收节点', 'error')
      return
    }
    setTransferWizardStep(step)
  }

  function renderDashboard() {
    if (!snapshot) {
      return null
    }

    return (
      <section className="data-transfer-share-page">
        <header className="data-transfer-share-header">
          <div className="data-transfer-share-header-copy">
            <h2>文件共享管理</h2>
            <p>管理你共享给其他节点的文件，设置访问权限并查看共享状态和文件明细。</p>
          </div>
          <button
            className="data-transfer-primary data-transfer-share-create-button"
            disabled={isShareBusy}
            type="button"
            onClick={() => void handleChooseShareFiles()}
          >
            <ShareGlyphIcon kind="plus" />
            <strong>创建共享</strong>
          </button>
        </header>

        <article className="data-transfer-panel data-transfer-share-metrics-panel">
          <ShareStripMetric
            accent="ice"
            icon={<ShareGlyphIcon kind="files" />}
            title="共享文件总数"
            value={`${totalPublishedFileCount}`}
          />
          <ShareStripMetric
            accent="mint"
            icon={<ShareGlyphIcon kind="download" />}
            title="累计被下载"
            value={`${totalShareDownloads} 次`}
          />
          <ShareStripMetric
            accent="violet"
            icon={<ShareGlyphIcon kind="storage" />}
            title="共享总大小"
            value={formatBytes(totalPublishedBytes)}
          />
          <ShareStripMetric
            accent="amber"
            icon={<ShareGlyphIcon kind="calendar" />}
            title="今日下载次数"
            value={`${todayShareDownloads} 次`}
          />
        </article>

        <article className="data-transfer-panel data-transfer-share-table-panel">
          <div className="data-transfer-share-table-toolbar">
            <div className="data-transfer-share-table-toolbar-copy">
              <div className="data-transfer-share-table-title-row">
                <strong>我的共享文件</strong>
              </div>
              <div className="data-transfer-share-filter-tabs">
                {shareTabs.map((tab) => (
                  <button
                    key={tab.id}
                    className={`data-transfer-share-filter-tab ${
                      shareFilter === tab.id ? 'active' : ''
                    }`}
                    aria-pressed={shareFilter === tab.id}
                    type="button"
                    onClick={() => setShareFilter(tab.id)}
                  >
                    {tab.label}
                    <span>{tab.count}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="data-transfer-share-search">
              <ShareGlyphIcon kind="search" />
              <input
                aria-label="搜索共享文件名称"
                value={shareSearch}
                type="text"
                placeholder="搜索共享文件名称"
                onChange={(event) => setShareSearch(event.target.value)}
              />
            </label>
          </div>

          {publishedShareCount === 0 ? (
            <div className="data-transfer-empty-block data-transfer-share-empty-block">
              <strong>还没有正在共享的文件</strong>
              <p>选择文件并开启共享后，这里会展示所有共享记录，并支持查看明细和关闭共享。</p>
            </div>
          ) : filteredPublishedShares.length === 0 ? (
            <div className="data-transfer-empty-block data-transfer-share-empty-block">
              <strong>没有符合条件的共享文件</strong>
              <p>可以切换筛选条件，或调整搜索关键词后再试。</p>
            </div>
          ) : (
            <div className="data-transfer-share-table-shell">
              <div className="data-transfer-share-table-head">
                <span>共享名称</span>
                <span>大小</span>
                <span>下载次数</span>
                <span>访问权限</span>
                <span>有效期</span>
                <span>状态</span>
                <span>操作</span>
              </div>

              <div className="data-transfer-share-table-body">
                {filteredPublishedShares.map((record) => {
                  const { share } = record
                  const expanded = previewShareId === share.id

                  return (
                    <article
                      key={share.id}
                      className={`data-transfer-share-table-row ${expanded ? 'expanded' : ''}`}
                    >
                      <div
                        className="data-transfer-share-table-cell data-transfer-share-file-cell"
                        data-label="共享名称"
                      >
                        <div
                          className={`data-transfer-share-file-badge ${getShareScopeClass(
                            share.scope,
                          )}`}
                        >
                          {getShareBadgeLabel(share)}
                        </div>
                        <div className="data-transfer-share-file-copy">
                          <strong>{share.title}</strong>
                          <span>
                            共享于 {formatFullDateTime(share.created_at)} · {share.file_count} 个文件
                          </span>
                        </div>
                      </div>

                      <div className="data-transfer-share-table-cell" data-label="大小">
                        <strong className="data-transfer-share-table-value">
                          {formatBytes(share.total_bytes)}
                        </strong>
                      </div>

                      <div className="data-transfer-share-table-cell" data-label="下载次数">
                        <span className="data-transfer-share-download-metric">
                          <ShareGlyphIcon kind="download" />
                          <strong className="data-transfer-share-table-value">
                            {record.download_count}
                          </strong>
                        </span>
                      </div>

                      <div className="data-transfer-share-table-cell" data-label="访问权限">
                        <span
                          className={`data-transfer-share-scope-pill ${getShareScopeClass(
                            share.scope,
                          )}`}
                        >
                          {formatShareScopeLabel(share.scope)}
                        </span>
                      </div>

                      <div className="data-transfer-share-table-cell" data-label="有效期">
                        <span
                          className={`data-transfer-share-validity ${
                            record.is_expired ? 'expired' : ''
                          }`}
                        >
                          {record.validity_label}
                        </span>
                      </div>

                      <div className="data-transfer-share-table-cell" data-label="状态">
                        <span
                          className={`data-transfer-share-status-pill ${
                            record.status === 'expired' ? 'expired' : 'active'
                          }`}
                        >
                          {record.status === 'expired' ? '已过期' : '生效中'}
                        </span>
                      </div>

                      <div
                        className="data-transfer-share-table-cell data-transfer-share-actions-cell"
                        data-label="操作"
                      >
                        <button
                          className="data-transfer-share-icon-button"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? '收起' : '展开'}共享 ${share.title} 的文件名明细`}
                          type="button"
                          title={expanded ? '收起文件名明细' : '查看文件名明细'}
                          onClick={() => toggleSharePreview(share.id)}
                        >
                          <ShareGlyphIcon kind={expanded ? 'chevron-up' : 'eye'} />
                        </button>
                        <button
                          className="data-transfer-share-icon-button danger"
                          aria-label={`关闭共享 ${share.title}`}
                          disabled={isShareBusy}
                          type="button"
                          title="关闭共享"
                          onClick={() => void handleRemovePublishedShare(share.id)}
                        >
                          <ShareGlyphIcon kind="trash" />
                        </button>
                      </div>

                      {expanded ? (
                        <div className="data-transfer-share-preview">
                          <div className="data-transfer-share-preview-meta">
                            <span className="data-transfer-share-preview-title">文件名明细</span>
                            <span>{share.file_count} 个文件</span>
                          </div>
                          {share.files.map((file) => (
                            <div key={file.id} className="data-transfer-share-preview-file">
                              <div className="data-transfer-share-preview-copy">
                                <strong>{file.file_name}</strong>
                                <span>路径：{formatShareRelativePath(file.relative_path)}</span>
                                <span>类型：{file.mime_type}</span>
                              </div>
                              <em>{formatBytes(file.size)}</em>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </div>
          )}
        </article>

        {selectedShareFiles.length > 0 ? (
          <Modal
            title="创建共享"
            cardClassName="data-transfer-share-modal-card"
            bodyClassName="data-transfer-share-modal-body"
            actions={
              shareWizardStep === 1 ? (
                <>
                  <button
                    className="data-transfer-secondary"
                    disabled={isShareBusy}
                    type="button"
                    onClick={() => clearShareDraft()}
                  >
                    取消
                  </button>
                  <button
                    className="data-transfer-secondary"
                    disabled={isShareBusy}
                    type="button"
                    onClick={() => void handleChooseShareFiles()}
                  >
                    继续添加
                  </button>
                  <button
                    className="data-transfer-primary"
                    disabled={selectedShareFiles.length === 0 || isShareBusy}
                    type="button"
                    onClick={() => goToSharePermissionStep()}
                  >
                    下一步
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="data-transfer-secondary"
                    disabled={isShareBusy}
                    type="button"
                    onClick={() => setShareWizardStep(1)}
                  >
                    返回上一步
                  </button>
                  <button
                    className="data-transfer-secondary"
                    disabled={isShareBusy}
                    type="button"
                    onClick={() => clearShareDraft()}
                  >
                    取消
                  </button>
                  <button
                      className="data-transfer-primary"
                      disabled={
                        selectedShareFiles.length === 0 ||
                        isShareBusy ||
                        (shareScope === 'selected_nodes' &&
                          selectedShareTargetFingerprints.length === 0) ||
                        (shareScope === 'password_protected' && !sharePassword.trim())
                      }
                    type="button"
                    onClick={() => void handlePublishShare()}
                  >
                    创建共享
                  </button>
                </>
              )
            }
            onClose={() => clearShareDraft()}
          >
            <div className="data-transfer-share-dialog">
              <div className="data-transfer-share-dialog-head">
                <div className="data-transfer-share-dialog-topline">
                  <span className="data-transfer-share-composer-meta">
                    <ShareGlyphIcon kind="spark" />
                    已选 {selectedShareFiles.length} 个文件 · {formatBytes(selectedShareBytes)}
                  </span>
                </div>
              </div>

              {shareWizardStep === 1 ? (
                <div className="data-transfer-share-selected-grid">
                  {selectedShareFiles.map((file) => (
                    <article key={file.file_path} className="data-transfer-share-selected-card">
                      <div className="data-transfer-share-selected-badge">
                        {getFileBadge(file.file_name)}
                      </div>
                      <div className="data-transfer-share-selected-copy">
                        <strong>{file.file_name}</strong>
                        <span title={file.file_path}>{file.file_path}</span>
                      </div>
                      <div className="data-transfer-share-selected-meta">
                        <em>{formatBytes(file.size)}</em>
                        <button
                          className="data-transfer-share-remove-file"
                          aria-label={`移除待共享文件 ${file.file_name}`}
                          type="button"
                          title="移除文件"
                          onClick={() => removeSelectedShareFile(file.file_path)}
                        >
                          <ShareGlyphIcon kind="close" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}

              {shareWizardStep === 2 ? (
                <div className="data-transfer-share-permission-panel">
                  <div className="data-transfer-share-permission-head">
                    <strong>访问权限设置</strong>
                  </div>

                  <div className="data-transfer-share-scope-grid">
                    {SHARE_SCOPE_OPTIONS.map((option) => {
                      const selected = shareScope === option.scope

                      return (
                        <button
                          key={option.scope}
                          className={`data-transfer-share-scope-card ${
                            selected ? 'selected' : ''
                          }`}
                          type="button"
                          onClick={() => setShareScope(option.scope)}
                        >
                          <div className="data-transfer-share-scope-card-head">
                            <div className="data-transfer-share-scope-card-main">
                              <div className={`data-transfer-share-scope-icon ${option.scope}`}>
                                <ShareGlyphIcon kind={option.icon} />
                              </div>
                              <div className="data-transfer-share-scope-card-copy">
                                <strong>{option.label}</strong>
                              </div>
                            </div>
                            <span
                              className={`data-transfer-share-scope-check ${
                                selected ? 'selected' : ''
                              }`}
                            />
                          </div>
                          <p>{option.description}</p>
                        </button>
                      )
                    })}
                  </div>

                  {shareScope === 'all' ? (
                    <div className="data-transfer-share-validity-panel">
                      <div className="data-transfer-share-validity-head">
                        <strong>有效期设置</strong>
                      </div>

                      <div className="data-transfer-share-validity-mode-row">
                        <button
                          className={`data-transfer-share-validity-mode ${
                            shareValidityMode === 'custom' ? 'selected' : ''
                          }`}
                          type="button"
                          onClick={() => setShareValidityMode('custom')}
                        >
                          <span className="data-transfer-share-validity-check" />
                          <strong>自定义有效期</strong>
                        </button>
                        <button
                          className={`data-transfer-share-validity-mode ${
                            shareValidityMode === 'permanent' ? 'selected' : ''
                          }`}
                          type="button"
                          onClick={() => setShareValidityMode('permanent')}
                        >
                          <span className="data-transfer-share-validity-check" />
                          <strong>永久有效</strong>
                        </button>
                      </div>

                      {shareValidityMode === 'custom' ? (
                        <>
                          <div className="data-transfer-share-validity-input-row">
                            <label className="data-transfer-share-validity-input date">
                              <span className="data-transfer-share-validity-preview">
                                {formatShareValidityPreview(shareValidityDate)}
                              </span>
                              <input
                                aria-label="选择有效期日期"
                                value={shareValidityDate}
                                type="date"
                                onChange={(event) => setShareValidityDate(event.target.value)}
                              />
                              <ShareGlyphIcon kind="calendar" />
                            </label>
                            <label className="data-transfer-share-validity-input time">
                              <input
                                aria-label="选择有效期时间"
                                value={shareValidityTime}
                                step={1}
                                type="time"
                                onChange={(event) => setShareValidityTime(event.target.value)}
                              />
                              <ShareGlyphIcon kind="clock" />
                            </label>
                          </div>

                          <div className="data-transfer-share-validity-presets">
                            {SHARE_VALIDITY_PRESETS.map((preset) => {
                              const selected = shareValidityDate === getFutureDateValue(preset.days)

                              return (
                                <button
                                  key={preset.label}
                                  className={`data-transfer-share-validity-preset ${
                                    selected ? 'selected' : ''
                                  }`}
                                  type="button"
                                  onClick={() => applyShareValidityPreset(preset.days)}
                                >
                                  {preset.label}
                                </button>
                              )
                            })}
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  {shareScope === 'password_protected' ? (
                    <div className="data-transfer-share-password-panel">
                      <div className="data-transfer-share-password-head">
                        <strong>访问密码</strong>
                        <span>设置后，其他节点需要输入密码才可以访问共享文件</span>
                      </div>
                      <label className="data-transfer-share-password-input">
                        <ShareGlyphIcon kind="lock" />
                        <input
                          aria-label="设置共享访问密码"
                          value={sharePassword}
                          type="password"
                          placeholder="请输入共享访问密码"
                          onChange={(event) => setSharePassword(event.target.value)}
                        />
                      </label>
                    </div>
                  ) : null}

                  {shareScope === 'selected_nodes' ? (
                    <div className="data-transfer-share-target-panel">
                      <div className="data-transfer-share-target-head">
                        <strong>指定节点</strong>
                        <div className="data-transfer-share-target-head-actions">
                          <span>已选择 {selectedShareTargetNodes.length} 个节点</span>
                          <button
                            className={`data-transfer-share-target-filter ${
                              shareTargetFavoriteOnly ? 'active' : ''
                            }`}
                            type="button"
                            onClick={() =>
                              setShareTargetFavoriteOnly((previous) => !previous)
                            }
                          >
                            仅看收藏节点
                          </button>
                        </div>
                      </div>

                      <label className="data-transfer-share-target-search">
                        <ShareGlyphIcon kind="search" />
                        <input
                          aria-label="搜索指定节点"
                          value={shareTargetSearch}
                          type="text"
                          placeholder="搜索节点名称、指纹或地址"
                          onChange={(event) => setShareTargetSearch(event.target.value)}
                        />
                      </label>

                      <div className="data-transfer-share-target-list">
                        {filteredShareTargetNodes.length === 0 ? (
                          <div className="data-transfer-empty-block data-transfer-share-target-empty">
                            <strong>没有可选节点</strong>
                            <p>可以先去节点列表中发现或收藏节点，再回来设置指定节点共享。</p>
                          </div>
                        ) : (
                          filteredShareTargetNodes.map((item) => {
                            const checked = selectedShareTargetFingerprints.includes(
                              item.fingerprint,
                            )

                            return (
                              <button
                                key={item.fingerprint}
                                className={`data-transfer-share-target-card ${
                                  checked ? 'selected' : ''
                                }`}
                                type="button"
                                onClick={() => toggleShareTargetFingerprint(item.fingerprint)}
                              >
                                <div
                                  className={`data-transfer-share-target-avatar ${getNodeAccentClass(
                                    item.fingerprint,
                                  )}`}
                                >
                                  {getNodeBadge(item.alias)}
                                </div>
                                <div className="data-transfer-share-target-copy">
                                  <strong>
                                    {item.alias}
                                    {item.is_favorite ? (
                                      <span className="data-transfer-share-target-favorite">
                                        已收藏
                                      </span>
                                    ) : null}
                                  </strong>
                                  <span>{formatNodeRecordMeta(item)}</span>
                                  <span>{shortFingerprint(item.fingerprint)}</span>
                                </div>
                                <span
                                  className={`data-transfer-share-target-status ${
                                    item.is_online ? 'online' : 'offline'
                                  }`}
                                >
                                  {item.is_online ? '在线' : '离线'}
                                </span>
                                <span
                                  className={`data-transfer-share-target-check ${
                                    checked ? 'selected' : ''
                                  }`}
                                />
                              </button>
                            )
                          })
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Modal>
        ) : null}
      </section>
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
          <div className="data-transfer-records-scroll">
            <div className="data-transfer-nodes-grid-shell">
              <div className="data-transfer-nodes-grid-head">
                <span>节点信息</span>
                <span>节点ID</span>
                <span>IP地址</span>
                <span>状态</span>
                <span>发送</span>
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
                            <button
                              aria-pressed={item.is_favorite}
                              className={`data-transfer-node-favorite-pill ${
                                item.is_favorite ? 'active' : ''
                              }`}
                              type="button"
                              title={item.is_favorite ? '取消收藏' : '加入收藏'}
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleToggleFavoriteEntry(item)
                              }}
                            >
                              <span>{item.is_favorite ? '★' : '☆'}</span>
                              <small>{item.is_favorite ? '已收藏' : '收藏'}</small>
                            </button>
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
                          onClick={(event) => {
                            event.stopPropagation()
                            if (item.online_node_id) {
                              focusNodeTransfer(item.online_node_id)
                            }
                          }}
                        >
                          <span>↗</span>
                          <strong>发送文件</strong>
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
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
    const taskMap = new Map(sortedTasks.map((task) => [task.id, task]))
    const transferStatusItems = transferStatusNodes.map((node) => {
      const currentTask =
        (transferSessionTaskIds[node.node_id]
          ? taskMap.get(transferSessionTaskIds[node.node_id])
          : undefined) ?? findLatestDirectSendTask(sortedTasks, node.fingerprint)

      return {
        node,
        task: currentTask ?? null,
      }
    })

    return (
      <section className="data-transfer-step-flow">
        <section className="data-transfer-stepper">
          {[
            {
              step: 1 as TransferWizardStep,
              title: '选择文件',
              summary: `${selectedTransferFiles.length} 个文件 · ${formatBytes(selectedTransferBytes)}`,
            },
            {
              step: 2 as TransferWizardStep,
              title: '选择节点',
              summary: `已选 ${selectedTransferNodeIds.length} 个节点`,
            },
            {
              step: 3 as TransferWizardStep,
              title: '发送状态',
              summary: `${transferStatusItems.length} 个节点状态`,
            },
          ].map((item) => {
            const status =
              transferWizardStep === item.step
                ? 'active'
                : transferWizardStep > item.step
                  ? 'completed'
                  : 'pending'

            return (
              <button
                key={item.step}
                className={`data-transfer-stepper-item ${status}`}
                type="button"
                onClick={() => handleGoToTransferStep(item.step)}
              >
                <span className="data-transfer-stepper-index">{item.step}</span>
                <span className="data-transfer-stepper-copy">
                  <strong>{item.title}</strong>
                  <span>{item.summary}</span>
                </span>
              </button>
            )
          })}
        </section>

        {transferWizardStep === 1 ? (
          <article className="data-transfer-transfer-card data-transfer-step-card">
            <div className="data-transfer-transfer-card-head">
              <div>
                <strong>选择文件</strong>
              </div>
              <div className="data-transfer-action-row data-transfer-file-actions">
                <button
                  className="data-transfer-secondary compact"
                  type="button"
                  onClick={() => void handleChooseTransferFiles()}
                >
                  添加文件
                </button>
                <button
                  className="data-transfer-secondary compact"
                  disabled={selectedTransferFiles.length === 0}
                  type="button"
                  onClick={() => setSelectedTransferFiles([])}
                >
                  清空文件
                </button>
              </div>
            </div>

            <div className="data-transfer-step-card-body data-transfer-selected-file-list">
              {selectedTransferFiles.length === 0 ? (
                <div className="data-transfer-empty-block">
                  <strong>暂未添加文件</strong>
                </div>
              ) : (
                selectedTransferFiles.map((file) => (
                  <article key={file.file_path} className="data-transfer-selected-file-card">
                    <div className="data-transfer-transfer-file-icon">
                      {getFileBadge(file.file_name)}
                    </div>
                    <div className="data-transfer-selected-file-copy">
                      <strong>{file.file_name}</strong>
                      <span title={file.file_path}>{file.file_path}</span>
                    </div>
                    <div className="data-transfer-selected-file-meta">
                      <em>{formatBytes(file.size)}</em>
                      <button
                        className="data-transfer-path-remove"
                        aria-label={`移除文件 ${file.file_name}`}
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

            <div className="data-transfer-step-card-foot">
              <button
                className="data-transfer-primary"
                disabled={selectedTransferFiles.length === 0}
                type="button"
                onClick={() => handleGoToTransferStep(2)}
              >
                下一步，选择接收节点
              </button>
            </div>
          </article>
        ) : null}

        {transferWizardStep === 2 ? (
          <article className="data-transfer-transfer-card data-transfer-step-card">
            <div className="data-transfer-transfer-card-head">
              <div>
                <strong>选择节点</strong>
                <span>已选择 {selectedTransferNodeIds.length} 个节点</span>
              </div>
              <div className="data-transfer-node-picker-tools">
                <button
                  className="data-transfer-subtle-icon-button data-transfer-node-picker-refresh"
                  aria-label="刷新节点列表"
                  title="刷新节点列表"
                  type="button"
                  onClick={() => void handleRefreshDiscovery()}
                >
                  ↻
                </button>
                <label className="data-transfer-node-picker-search">
                  <input
                    value={transferNodeDraftSearch}
                    type="text"
                    placeholder="搜索节点名称 / IP"
                    onChange={(event) => setTransferNodeDraftSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        handleApplyTransferNodeSearch()
                      }
                    }}
                  />
                </label>
                <button
                  className="data-transfer-secondary compact"
                  type="button"
                  onClick={handleApplyTransferNodeSearch}
                >
                  查询
                </button>
              </div>
            </div>

            <div className="data-transfer-step-card-body data-transfer-node-picker-list">
              {filteredTransferNodes.length === 0 ? (
                <div className="data-transfer-empty-block">
                  <strong>暂无节点数据</strong>
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
                      <button
                        className={`data-transfer-node-picker-check ${checked ? 'checked' : ''}`}
                        type="button"
                        aria-label={checked ? '取消勾选节点' : '勾选节点'}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleTransferNode(node.id)
                        }}
                      />
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
                          {node.favorite ? (
                            <span className="data-transfer-node-picker-star">★</span>
                          ) : null}
                        </strong>
                        <span title={`${node.ip}:${node.port} · ${node.device_model ?? normalizeDeviceType(node.device_type)}`}>
                          {node.ip}:{node.port} ·{' '}
                          {node.device_model ?? normalizeDeviceType(node.device_type)}
                        </span>
                      </div>
                      <span className="data-transfer-node-picker-status online">在线</span>
                    </article>
                  )
                })
              )}
            </div>

            <div className="data-transfer-step-card-foot">
              <button
                className="data-transfer-secondary"
                type="button"
                onClick={() => handleGoToTransferStep(1)}
              >
                上一步
              </button>
              <button
                className="data-transfer-primary"
                disabled={selectedTransferFiles.length === 0 || selectedTransferNodeIds.length === 0}
                type="button"
                onClick={() => void handleStartDirectSend()}
              >
                下一步，确认发送
              </button>
            </div>
          </article>
        ) : null}

        {transferWizardStep === 3 ? (
          <section className="data-transfer-step3-layout">
            <article className="data-transfer-transfer-card data-transfer-step-card data-transfer-step3-status-card">
              <div className="data-transfer-transfer-card-head">
                <div>
                  <strong>各节点传输状态</strong>
                  <span>{transferStatusItems.length} 个节点</span>
                </div>
              </div>

              <div className="data-transfer-step-card-body data-transfer-node-status-list">
                {transferStatusItems.length === 0 ? (
                  <div className="data-transfer-empty-block">
                    <strong>还没有接收节点</strong>
                    <p>请先返回上一步勾选接收节点，再发起发送任务。</p>
                  </div>
                ) : (
                  transferStatusItems.map(({ node, task }) => {
                    const statusMeta = getTransferNodeStatusMeta(task)
                    const retryLabel = isRejectedTransferTask(task)
                      ? '重新发送申请'
                      : '重试传输'

                    return (
                      <article
                        key={node.node_id}
                        className={`data-transfer-node-status-card tone-${statusMeta.tone}`}
                      >
                        <div className="data-transfer-node-status-main">
                          <div
                            className={`data-transfer-node-status-avatar ${getNodeAccentClass(
                              node.alias,
                            )}`}
                          >
                            {getNodeBadge(node.alias)}
                          </div>
                          <div className="data-transfer-node-status-copy">
                            <strong>{node.alias}</strong>
                            <span
                              title={`${node.ip ?? '--'}:${node.port ?? '--'} · ${
                                node.device_model ?? normalizeDeviceType(node.device_type)
                              }`}
                            >
                              {node.ip ?? '--'}:{node.port ?? '--'} ·{' '}
                              {node.device_model ?? normalizeDeviceType(node.device_type)}
                            </span>
                          </div>
                        </div>

                        <div className="data-transfer-node-status-rail">
                          <div className="data-transfer-node-status-side">
                            <span className={`data-transfer-node-status-badge tone-${statusMeta.tone}`}>
                              {statusMeta.label}
                            </span>
                            {task ? (
                              <small>
                                {Math.round(task.progress_percent)}% · {formatBytes(task.total_bytes)}
                              </small>
                            ) : (
                              <small>尚未发起发送</small>
                            )}
                          </div>

                          <div className="data-transfer-node-status-actions">
                            {task && (task.status === 'running' || task.status === 'pending') ? (
                              <button
                                className="data-transfer-secondary compact"
                                type="button"
                                onClick={() => void handleCancelTask(task.id)}
                              >
                                取消任务
                              </button>
                            ) : null}

                            {(!task || task.status === 'failed' || task.status === 'canceled') ? (
                              <button
                                className="data-transfer-primary compact"
                                type="button"
                                onClick={() => void handleRetryTransferNode(node.node_id, retryLabel)}
                              >
                                {task ? retryLabel : '发送申请'}
                              </button>
                            ) : null}
                          </div>
                        </div>

                        <div className="data-transfer-node-status-message">{statusMeta.message}</div>

                        {shouldShowTransferProgress(task) ? (
                          <div className="data-transfer-node-status-progress-block">
                            <div className="data-transfer-node-status-progress">
                              <div
                                className="data-transfer-node-status-progress-fill"
                                style={{ width: `${Math.max(2, Math.min(100, task?.progress_percent ?? 0))}%` }}
                              />
                            </div>
                            <div className="data-transfer-node-status-meta">
                              <span>
                                {formatBytes(task?.transferred_bytes ?? 0)} /{' '}
                                {formatBytes(task?.total_bytes ?? 0)}
                              </span>
                              <span>{task ? formatTransferQueueRuntime(task) : '等待开始'}</span>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    )
                  })
                )}
              </div>

            </article>

            <article className="data-transfer-transfer-card data-transfer-step-card data-transfer-step-files-card data-transfer-step3-files-card">
              <div className="data-transfer-transfer-card-head">
                <div>
                  <strong>本次发送文件</strong>
                  <span>{selectedTransferFiles.length} 个文件 · {formatBytes(selectedTransferBytes)}</span>
                </div>
              </div>

              <div className="data-transfer-step-card-body data-transfer-selected-file-list">
                {selectedTransferFiles.length === 0 ? (
                  <div className="data-transfer-empty-block">
                    <strong>没有可发送文件</strong>
                    <p>返回节点一选择文件后，步骤三会继续复用新的文件列表。</p>
                  </div>
                ) : (
                  selectedTransferFiles.map((file) => (
                    <article key={file.file_path} className="data-transfer-selected-file-card readonly">
                      <div className="data-transfer-transfer-file-icon">
                        {getFileBadge(file.file_name)}
                      </div>
                      <div className="data-transfer-selected-file-copy">
                        <strong>{file.file_name}</strong>
                        <span title={file.file_path}>{file.file_path}</span>
                      </div>
                      <div className="data-transfer-selected-file-meta">
                        <em>{formatBytes(file.size)}</em>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </article>
          </section>
        ) : null}
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
          <div className="data-transfer-records-scroll">
            <div className="data-transfer-history-grid-shell">
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
                      <span
                        className={`data-transfer-history-direction ${getHistoryAccentClass(task)}`}
                      >
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
                      {isIncomingApprovalTask(task) ? (
                        <div className="data-transfer-history-actions">
                          <button
                            className="data-transfer-secondary compact"
                            type="button"
                            onClick={() => handleOpenIncomingTask(task)}
                          >
                            接收文件
                          </button>
                          <button
                            className="data-transfer-secondary compact danger"
                            type="button"
                            onClick={() => void handleRejectIncomingTask(task.id)}
                          >
                            拒绝
                          </button>
                        </div>
                      ) : shouldRenderHistoryInlineNote(task) ? (
                        <span className="data-transfer-history-status-note">
                          {formatHistoryStatusNote(task)}
                        </span>
                      ) : null}
                    </div>

                    <div className="data-transfer-history-cell data-transfer-history-time-cell">
                      <strong>{formatHistoryDateTime(task.completed_at ?? task.updated_at)}</strong>
                      <span>{formatHistoryDuration(task)}</span>
                    </div>

                    {shouldRenderHistoryBottomNote(task) ? (
                      <div className="data-transfer-history-bottom-note">
                        {formatHistoryStatusNote(task)}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
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

  function renderIncomingTransferDialog() {
    if (!activeIncomingTransferTask) {
      return null
    }

    const task = activeIncomingTransferTask
    const isApproval = isIncomingApprovalTask(task)
    const isProgress = isIncomingTransferProgressTask(task)

    if (!isApproval && !isProgress) {
      return null
    }

    const totalSize = formatBytes(task.total_bytes)
    const progressPercent = Math.round(task.progress_percent)
    const speed = estimateTaskSpeed(task)
    const remainingSeconds = estimateTaskRemainingSeconds(task, speed)
    const destinationDir = incomingDestinationDir.trim() || snapshot?.default_download_dir || ''
    const overallRuntimeText =
      speed > 0 && remainingSeconds != null
        ? `${formatSpeed(speed)} · 剩余 ${formatDurationText(remainingSeconds)}`
        : task.status_message ?? '等待发送方开始传输'

    return (
      <div className="data-transfer-incoming-modal-backdrop" role="presentation">
        <section className="data-transfer-incoming-modal" role="dialog" aria-modal="true">
          <header className="data-transfer-incoming-modal-header">
            <div className="data-transfer-incoming-modal-title-group">
              <div
                className={`data-transfer-incoming-modal-icon ${isApproval ? 'request' : 'receiving'}`}
              >
                <ShareGlyphIcon kind={isApproval ? 'info' : 'download'} />
              </div>
              <div className="data-transfer-incoming-modal-copy">
                <strong>{isApproval ? '文件传输请求' : '正在接收文件'}</strong>
                <span>
                  {isApproval
                    ? `来自 ${task.peer_alias} 的文件传输请求`
                    : `来自 ${task.peer_alias}`}
                </span>
              </div>
            </div>

            <button
              className="data-transfer-incoming-modal-close"
              disabled={isIncomingDialogBusy}
              type="button"
              aria-label="关闭弹框"
              onClick={() => handleDismissIncomingTask(task.id)}
            >
              <ShareGlyphIcon kind="close" />
            </button>
          </header>

          {isApproval ? (
            <>
              <section className="data-transfer-incoming-summary">
                <strong>
                  包含以下 {task.files.length} 个文件，总计 {totalSize}
                </strong>
              </section>

              <section className="data-transfer-incoming-file-list">
                {task.files.map((file) => (
                  <article key={file.id} className="data-transfer-incoming-file-card request">
                    <div className="data-transfer-incoming-file-badge">{getFileBadge(file.file_name)}</div>
                    <div className="data-transfer-incoming-file-copy">
                      <strong>{file.file_name}</strong>
                      <span>{formatBytes(file.size)}</span>
                    </div>
                  </article>
                ))}
              </section>

              <section className="data-transfer-incoming-path-section">
                <strong>保存位置</strong>
                <div className="data-transfer-incoming-path-card">
                  <div className="data-transfer-incoming-path-copy">
                    <span className="data-transfer-incoming-path-icon">
                      <ShareGlyphIcon kind="folder" />
                    </span>
                    <span title={destinationDir}>{destinationDir}</span>
                  </div>
                  <button
                    className="data-transfer-secondary compact"
                    disabled={isIncomingDialogBusy}
                    type="button"
                    onClick={() => void handleChooseIncomingDestination()}
                  >
                    更改
                  </button>
                </div>
              </section>

              <footer className="data-transfer-incoming-actions">
                <button
                  className="data-transfer-secondary data-transfer-incoming-action-button"
                  disabled={isIncomingDialogBusy}
                  type="button"
                  onClick={() => void handleRejectIncomingTask(task.id)}
                >
                  拒绝
                </button>
                <button
                  className="data-transfer-primary data-transfer-incoming-action-button"
                  disabled={isIncomingDialogBusy}
                  type="button"
                  onClick={() => void handleAcceptIncomingTask(task)}
                >
                  接收文件
                </button>
              </footer>
            </>
          ) : (
            <>
              <section className="data-transfer-incoming-progress-overview">
                <div className="data-transfer-incoming-progress-head">
                  <strong>总体进度</strong>
                  <span>{progressPercent}%</span>
                </div>
                <div className="data-transfer-incoming-progress-rail">
                  <div
                    className="data-transfer-incoming-progress-fill"
                    style={{ width: `${Math.max(4, Math.min(100, task.progress_percent || 0))}%` }}
                  />
                </div>
                <div className="data-transfer-incoming-progress-meta">
                  <span>
                    {formatBytes(task.transferred_bytes)} / {totalSize}
                  </span>
                  <span>{overallRuntimeText}</span>
                </div>
              </section>

              <section className="data-transfer-incoming-detail-section">
                <strong>文件传输详情</strong>
                <div className="data-transfer-incoming-file-list">
                  {task.files.map((file) => {
                    const filePercent =
                      file.size > 0 ? Math.round((file.transferred_bytes / file.size) * 100) : 0

                    return (
                      <article key={file.id} className="data-transfer-incoming-file-card progress">
                        <div className="data-transfer-incoming-file-row">
                          <div className="data-transfer-incoming-file-main">
                            <div
                              className={`data-transfer-incoming-file-badge ${
                                file.status === 'completed' ? 'completed' : ''
                              }`}
                            >
                              <ShareGlyphIcon
                                kind={file.status === 'completed' ? 'check' : 'files'}
                              />
                            </div>
                            <div className="data-transfer-incoming-file-copy">
                              <strong>{file.file_name}</strong>
                              <span>{formatBytes(file.size)}</span>
                            </div>
                          </div>
                          <span
                            className={`data-transfer-incoming-file-status ${
                              file.status === 'completed' ? 'completed' : ''
                            }`}
                          >
                            {file.status === 'completed'
                              ? '已完成'
                              : file.status === 'running'
                                ? `${filePercent}%`
                                : task.status === 'pending'
                                  ? '等待中'
                                  : `${filePercent}%`}
                          </span>
                        </div>
                        <div className="data-transfer-incoming-file-progress">
                          <div
                            className={`data-transfer-incoming-file-progress-fill ${
                              file.status === 'completed' ? 'completed' : ''
                            }`}
                            style={{
                              width: `${Math.max(
                                file.transferred_bytes > 0 ? 4 : 0,
                                Math.min(100, filePercent),
                              )}%`,
                            }}
                          />
                        </div>
                        <div className="data-transfer-incoming-file-meta">
                          <span>
                            {formatBytes(file.transferred_bytes)} / {formatBytes(file.size)}
                          </span>
                          <span>
                            {file.status === 'completed'
                              ? '已完成'
                              : file.status === 'running'
                                ? formatSpeed(speed)
                                : task.status_message ?? '等待发送方开始传输'}
                          </span>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>

              <section className="data-transfer-incoming-path-card compact">
                <div className="data-transfer-incoming-path-copy">
                  <span className="data-transfer-incoming-path-icon">
                    <ShareGlyphIcon kind="folder" />
                  </span>
                  <span title={destinationDir}>保存到：{destinationDir}</span>
                </div>
                <button
                  className="data-transfer-secondary compact"
                  type="button"
                  onClick={() => pushNotice(`当前保存位置：${destinationDir}`, 'info')}
                >
                  打开文件夹
                </button>
              </section>

              <footer className="data-transfer-incoming-actions">
                <button
                  className="data-transfer-secondary data-transfer-incoming-action-button"
                  disabled={isIncomingDialogBusy}
                  type="button"
                  onClick={() => handleDismissIncomingTask(task.id)}
                >
                  后台运行
                </button>
                <button
                  className="data-transfer-secondary danger data-transfer-incoming-action-button"
                  disabled={isIncomingDialogBusy}
                  type="button"
                  onClick={async () => {
                    await handleCancelTask(task.id)
                    handleDismissIncomingTask(task.id)
                  }}
                >
                  取消接收
                </button>
              </footer>
            </>
          )}
        </section>
      </div>
    )
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
          <section className="data-transfer-sidebar-panel data-transfer-sidebar-notify-panel">
            <div className="data-transfer-sidebar-notify-head">
              <strong>运行通知</strong>
              <div className="data-transfer-sidebar-notify-actions">
                <span>{activityLogs.length} 条</span>
                <button
                  className="data-transfer-sidebar-clear-button"
                  disabled={activityLogs.length === 0}
                  type="button"
                  onClick={clearActivityLogs}
                >
                  清空
                </button>
              </div>
            </div>
            <div
              ref={activityLogListRef}
              className="data-transfer-sidebar-notify-list"
            >
              {activityLogs.length === 0 ? (
                <div className="data-transfer-sidebar-notify-empty">
                  <strong>等待新的运行通知</strong>
                  <span>刷新节点、注册切换和传输动作会记录在这里。</span>
                </div>
              ) : (
                activityLogs.map((entry) => (
                  <article
                    key={entry.id}
                    className={`data-transfer-sidebar-notify-item tone-${entry.tone}`}
                  >
                    <span className={`data-transfer-sidebar-notify-dot tone-${entry.tone}`} />
                    <div className="data-transfer-sidebar-notify-copy">
                      <strong>{entry.message}</strong>
                      <span>{entry.detail}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

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
          ) : activeSection === 'dashboard' ? (
            <>
              {notice ? (
                <section className={`data-transfer-notice ${notice.tone}`}>{notice.message}</section>
              ) : null}

              {renderDashboard()}
            </>
          ) : (
            <>
              <section className="data-transfer-panel data-transfer-toolbar-card">
                <div className="data-transfer-toolbar-copy">
                  <h1>{sectionMeta.title}</h1>
                  <p>{sectionMeta.description}</p>
                </div>
                <div className="data-transfer-toolbar-actions">
                  <>
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
                  </>
                </div>
              </section>

              {notice ? (
                <section className={`data-transfer-notice ${notice.tone}`}>{notice.message}</section>
              ) : null}

              <section className="data-transfer-metrics">
                <>
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
                </>
              </section>

              {renderSectionContent()}
            </>
          )}
        </section>
      </div>
      {renderIncomingTransferDialog()}
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

function ShareStripMetric({
  accent,
  icon,
  title,
  value,
}: {
  accent: 'ice' | 'mint' | 'violet' | 'amber'
  icon: ReactNode
  title: string
  value: string
}) {
  return (
    <article className="data-transfer-share-metric">
      <div className={`data-transfer-share-summary-icon accent-${accent}`}>{icon}</div>
      <div className="data-transfer-share-metric-copy">
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
    </article>
  )
}

function ShareGlyphIcon({
  kind,
}: {
  kind:
    | 'plus'
    | 'files'
    | 'download'
    | 'storage'
    | 'calendar'
    | 'search'
    | 'eye'
    | 'copy'
    | 'trash'
    | 'close'
    | 'globe'
    | 'lock'
    | 'users'
    | 'clock'
    | 'pulse'
    | 'spark'
    | 'chevron-up'
    | 'info'
    | 'folder'
    | 'check'
}) {
  return (
    <svg
      aria-hidden="true"
      className={`data-transfer-share-svg-icon kind-${kind}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {kind === 'plus' ? <path d="M12 5v14M5 12h14" /> : null}
      {kind === 'files' ? (
        <>
          <path d="M8 7.5V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1.5" />
          <path d="M7 9h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
        </>
      ) : null}
      {kind === 'download' ? (
        <>
          <path d="M12 4v10" />
          <path d="m8 10 4 4 4-4" />
          <path d="M5 19h14" />
        </>
      ) : null}
      {kind === 'storage' ? (
        <>
          <path d="M4 7.5C4 6.1 7.6 5 12 5s8 1.1 8 2.5S16.4 10 12 10 4 8.9 4 7.5Z" />
          <path d="M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5" />
          <path d="M4 16.5C4 17.9 7.6 19 12 19s8-1.1 8-2.5" />
          <path d="M4 7.5v9M20 7.5v9" />
        </>
      ) : null}
      {kind === 'calendar' ? (
        <>
          <path d="M7 4v3M17 4v3M5 9h14" />
          <rect x="4" y="6" width="16" height="14" rx="3" />
        </>
      ) : null}
      {kind === 'search' ? (
        <>
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-4.2-4.2" />
        </>
      ) : null}
      {kind === 'eye' ? (
        <>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.6" />
        </>
      ) : null}
      {kind === 'copy' ? (
        <>
          <rect x="9" y="9" width="10" height="10" rx="2" />
          <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
        </>
      ) : null}
      {kind === 'trash' ? (
        <>
          <path d="M4 7h16" />
          <path d="M9 4h6" />
          <path d="M7 7l1 12h8l1-12" />
          <path d="M10 11v5M14 11v5" />
        </>
      ) : null}
      {kind === 'close' ? <path d="m7 7 10 10M17 7 7 17" /> : null}
      {kind === 'globe' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3.5 12h17" />
          <path d="M12 3c2.8 3 4.2 6 4.2 9s-1.4 6-4.2 9c-2.8-3-4.2-6-4.2-9S9.2 6 12 3Z" />
        </>
      ) : null}
      {kind === 'lock' ? (
        <>
          <rect x="6" y="11" width="12" height="9" rx="2" />
          <path d="M9 11V8.5A3.5 3.5 0 0 1 12.5 5 3.5 3.5 0 0 1 16 8.5V11" />
        </>
      ) : null}
      {kind === 'users' ? (
        <>
          <circle cx="9" cy="9" r="3" />
          <path d="M4.5 18a4.5 4.5 0 0 1 9 0" />
          <circle cx="17" cy="10" r="2.5" />
          <path d="M14.8 18a3.8 3.8 0 0 1 4.7-3.6" />
        </>
      ) : null}
      {kind === 'clock' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      ) : null}
      {kind === 'pulse' ? <path d="M3 12h4l2-4 4 8 2-4h6" /> : null}
      {kind === 'spark' ? (
        <>
          <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
          <path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />
        </>
      ) : null}
      {kind === 'chevron-up' ? <path d="m6 14 6-6 6 6" /> : null}
      {kind === 'info' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v6" />
          <circle cx="12" cy="7.3" r="0.8" fill="currentColor" stroke="none" />
        </>
      ) : null}
      {kind === 'folder' ? (
        <>
          <path d="M3.5 8.5A2.5 2.5 0 0 1 6 6h4l1.8 2H18a2.5 2.5 0 0 1 2.5 2.5V17A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17Z" />
        </>
      ) : null}
      {kind === 'check' ? <path d="m5 12 4 4 10-10" /> : null}
    </svg>
  )
}

function mergeSelectedFiles(
  previous: DataTransferSelectedFile[],
  next: DataTransferSelectedFile[],
) {
  const fileMap = new Map(previous.map((file) => [file.file_path, file]))
  next.forEach((file) => {
    fileMap.set(file.file_path, file)
  })
  return Array.from(fileMap.values())
}

function getSharePresentationMeta(
  share: DataTransferPublishedShare,
  index: number,
): SharePresentationMeta {
  const mockPresets: SharePresentationMeta[] = [
    {
      download_count: 12,
      today_download_count: 3,
      validity_label: '2026-05-15 到期',
      status: 'active',
      is_expired: false,
    },
    {
      download_count: 8,
      today_download_count: 2,
      validity_label: '2026-04-30 到期',
      status: 'active',
      is_expired: false,
    },
    {
      download_count: 15,
      today_download_count: 3,
      validity_label: '永久有效',
      status: 'active',
      is_expired: false,
    },
    {
      download_count: 7,
      today_download_count: 0,
      validity_label: '2026-04-10 已过期',
      status: 'expired',
      is_expired: true,
    },
  ]

  if (share.id.startsWith('mock-share-local-')) {
    return mockPresets[index % mockPresets.length]
  }

  const seed = Array.from(share.id).reduce((total, char) => total + char.charCodeAt(0), 0)
  const downloadCount = Math.max(share.file_count, (seed % 14) + 3)
  const recentlyUpdated = isSameDay(share.updated_at)

  return {
    download_count: downloadCount,
    today_download_count: recentlyUpdated ? Math.min(4, downloadCount) : 0,
    validity_label: share.scope === 'selected_nodes' ? '待配置有效期' : '永久有效',
    status: 'active',
    is_expired: false,
  }
}

function findLatestDirectSendTask(tasks: DataTransferTask[], peerFingerprint: string) {
  return tasks.find(
    (task) =>
      task.kind === 'direct_send' &&
      task.direction === 'outgoing' &&
      task.peer_fingerprint === peerFingerprint,
  )
}

function isRejectedTransferTask(task: DataTransferTask | null) {
  if (!task) {
    return false
  }

  const text = `${task.status_message ?? ''} ${task.error_message ?? ''}`
  return text.includes('拒绝')
}

function shouldShowTransferProgress(task: DataTransferTask | null) {
  if (!task) {
    return false
  }

  return (
    task.status === 'running' ||
    task.status === 'completed' ||
    task.transferred_bytes > 0
  )
}

function getTransferNodeStatusMeta(task: DataTransferTask | null) {
  if (!task) {
    return {
      label: '待发送',
      tone: 'idle',
      message: '当前节点尚未发起发送任务',
    }
  }

  if (isRejectedTransferTask(task)) {
    return {
      label: '已拒绝',
      tone: 'rejected',
      message: task.error_message ?? task.status_message ?? '对方已拒绝本次接收',
    }
  }

  switch (task.status) {
    case 'pending':
      return {
        label: '待确认接收',
        tone: 'waiting',
        message: task.status_message ?? '已发起发送申请，等待对方确认接收',
      }
    case 'running':
      return {
        label: '已接收',
        tone: 'running',
        message: task.status_message ?? '对方已确认接收，正在传输文件',
      }
    case 'completed':
      return {
        label: '已完成',
        tone: 'success',
        message: '文件已成功发送到当前节点',
      }
    case 'failed':
      return {
        label: '传输失败',
        tone: 'failed',
        message: task.error_message ?? task.status_message ?? '传输过程中发生异常',
      }
    case 'canceled':
      return {
        label: '已取消',
        tone: 'failed',
        message: task.error_message ?? task.status_message ?? '当前传输任务已取消',
      }
    default:
      return {
        label: formatTaskStatusLabel(task.status),
        tone: 'idle',
        message: task.status_message ?? '状态已更新',
      }
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

function isIncomingApprovalTask(task: DataTransferTask) {
  return (
    task.kind === 'direct_receive' &&
    task.direction === 'incoming' &&
    task.status === 'pending' &&
    !isAcceptedIncomingPendingTask(task)
  )
}

function isAcceptedIncomingPendingTask(task: DataTransferTask) {
  return (
    task.kind === 'direct_receive' &&
    task.direction === 'incoming' &&
    task.status === 'pending' &&
    (task.status_message ?? '').includes('已确认接收')
  )
}

function isIncomingTransferProgressTask(task: DataTransferTask) {
  return (
    task.kind === 'direct_receive' &&
    task.direction === 'incoming' &&
    (isAcceptedIncomingPendingTask(task) || task.status === 'running')
  )
}

function formatTransferQueueRuntime(task: DataTransferTask) {
  if (task.status === 'pending') {
    return task.status_message ?? '等待节点响应'
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
    return task.status_message ?? `进度 ${Math.round(task.progress_percent)}%`
  }
  if (task.status === 'failed' || task.status === 'canceled') {
    return task.error_message ?? task.status_message ?? '任务已中断'
  }
  return task.status_message ?? '传输完成'
}

function shouldRenderHistoryBottomNote(task: DataTransferTask) {
  return task.status === 'failed' || task.status === 'canceled'
}

function shouldRenderHistoryInlineNote(task: DataTransferTask) {
  return !shouldRenderHistoryBottomNote(task)
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

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

function formatHistoryDuration(task: DataTransferTask) {
  const startedAt = new Date(task.started_at).getTime()
  const endedAt = new Date(task.completed_at ?? task.updated_at).getTime()
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt)) {
    return '耗时未记录'
  }
  const elapsedMs = Math.max(0, endedAt - startedAt)
  if (elapsedMs < 1000) {
    return elapsedMs > 0 ? '耗时 < 1秒' : '耗时未记录'
  }

  return `耗时 ${formatDurationText(Math.round(elapsedMs / 1000))}`
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
  return getFileBadge(formatTaskPrimaryName(task))
}

function getFileBadge(fileName: string) {
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

function getShareBadgeLabel(share: DataTransferPublishedShare) {
  if (share.file_count > 1) {
    return `${share.file_count}F`
  }

  const primaryName = share.files[0]?.file_name ?? share.title
  const extension = primaryName.includes('.') ? primaryName.split('.').pop() ?? '' : ''
  const badge = extension.trim().slice(0, 3).toUpperCase()
  return badge || 'FILE'
}

function formatShareScopeLabel(scope: DataTransferShareScope) {
  switch (scope) {
    case 'password_protected':
      return '密码保护'
    case 'favorite_only':
      return '收藏节点'
    case 'selected_nodes':
      return '指定节点'
    case 'all':
    default:
      return '公开访问'
  }
}

function getShareScopeClass(scope: DataTransferShareScope) {
  switch (scope) {
    case 'password_protected':
      return 'scope-password'
    case 'favorite_only':
      return 'scope-favorite'
    case 'selected_nodes':
      return 'scope-selected'
    case 'all':
    default:
      return 'scope-public'
  }
}

function formatShareRelativePath(relativePath: string | null) {
  const normalized = relativePath?.trim()
  return normalized ? normalized : '根目录文件'
}

function isSameDay(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return false
  }

  const now = new Date()
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

function formatFullDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatActivityToneLabel(tone: ActivityLogTone) {
  switch (tone) {
    case 'progress':
      return '进行中'
    case 'success':
      return '已完成'
    case 'error':
      return '处理失败'
    case 'info':
    default:
      return '通知'
  }
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

function getFutureDateValue(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatShareValidityPreview(dateValue: string) {
  const target = new Date(dateValue)
  if (Number.isNaN(target.getTime())) {
    return dateValue
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)

  const days = Math.max(0, Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)))
  return `${days}天后 (${dateValue})`
}

function toErrorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

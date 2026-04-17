import type {
  DataTransferChooseFilesResult,
  DataTransferChooseFolderResult,
  DataTransferDirectSendPayload,
  DataTransferDownloadSharePayload,
  DataTransferFavoriteNode,
  DataTransferFavoritePayload,
  DataTransferLoadRemoteSharesPayload,
  DataTransferPublishedFile,
  DataTransferPublishPayload,
  DataTransferResolveSelectedFilesPayload,
  DataTransferRegistrationPayload,
  DataTransferRemoteShare,
  DataTransferRemoteShareResponse,
  DataTransferRemoveSharePayload,
  DataTransferSelectedFile,
  DataTransferSnapshot,
  DataTransferTask,
  DataTransferTaskCancelResponse,
  DataTransferTaskFile,
  DataTransferTaskStartResponse,
} from '../../types'

type MockTaskRuntime = {
  duration_ms: number
  started_at_ms: number
}

const baseNow = Date.now()
let chooseFilesCursor = 0
let shareCounter = 1
let taskCounter = 2

const mockFileSelections = [
  [
    '/Users/mock/Documents/需求说明书-v3.pdf',
    '/Users/mock/Desktop/结构差异核对.xlsx',
  ],
  [
    '/Users/mock/Downloads/上线包清单.zip',
    '/Users/mock/Downloads/release-note.txt',
  ],
]

const remoteSharesByNodeId: Record<string, DataTransferRemoteShare[]> = {
  'node-design-mbp': [
    {
      id: 'remote-share-design-1',
      owner_alias: '设计部 MacBook',
      owner_fingerprint: 'node-design-mbp',
      title: '视觉稿交付包',
      file_count: 2,
      total_bytes: 27_514_880,
      created_at: iso(baseNow - 1000 * 60 * 32),
      files: [
        buildRemoteFile('视觉稿-首页.fig', 18_432_018),
        buildRemoteFile('字体与切图.zip', 9_082_862),
      ],
    },
    {
      id: 'remote-share-design-2',
      owner_alias: '设计部 MacBook',
      owner_fingerprint: 'node-design-mbp',
      title: '品牌图标素材',
      file_count: 3,
      total_bytes: 11_924_126,
      created_at: iso(baseNow - 1000 * 60 * 90),
      files: [
        buildRemoteFile('logo-light.png', 1_245_891),
        buildRemoteFile('logo-dark.png', 1_266_712),
        buildRemoteFile('icons-pack.zip', 9_411_523),
      ],
    },
  ],
  'node-qa-win': [
    {
      id: 'remote-share-qa-1',
      owner_alias: '测试机 Win11',
      owner_fingerprint: 'node-qa-win',
      title: '回归测试证据',
      file_count: 2,
      total_bytes: 642_018_223,
      created_at: iso(baseNow - 1000 * 60 * 12),
      files: [
        buildRemoteFile('test-video.mp4', 612_330_442),
        buildRemoteFile('case-report.docx', 29_687_781),
      ],
    },
  ],
  'node-nas': [
    {
      id: 'remote-share-nas-1',
      owner_alias: '资料中转站',
      owner_fingerprint: 'node-nas',
      title: '离线部署镜像',
      file_count: 1,
      total_bytes: 1_482_002_118,
      created_at: iso(baseNow - 1000 * 60 * 55),
      files: [buildRemoteFile('zszc-transfer-amd64.tar.gz', 1_482_002_118)],
    },
  ],
}

const taskRuntimes: Record<string, MockTaskRuntime> = {
  'mock-task-running': {
    duration_ms: 50_000,
    started_at_ms: baseNow - 34_000,
  },
  'mock-task-uploading': {
    duration_ms: 62_500,
    started_at_ms: baseNow - 20_000,
  },
}

const snapshotState: DataTransferSnapshot = {
  local_node: {
    alias: '本机 · ZSZC Studio',
    fingerprint: 'local-zszc-node-001',
    port: 53317,
    protocol: 'http',
    registration_enabled: true,
  },
  default_download_dir: '/Users/mock/Downloads/zszc-data-transfer',
  nodes: [
    {
      id: 'node-design-mbp',
      alias: '设计部 MacBook',
      fingerprint: 'node-design-mbp',
      device_model: 'MacBook Pro 14',
      device_type: 'desktop',
      ip: '192.168.31.18',
      port: 53317,
      protocol: 'http',
      favorite: true,
      source: 'multicast',
      last_seen_at: iso(baseNow - 1000 * 18),
    },
    {
      id: 'node-qa-win',
      alias: '测试机 Win11',
      fingerprint: 'node-qa-win',
      device_model: 'ThinkPad P16',
      device_type: 'desktop',
      ip: '192.168.31.26',
      port: 53317,
      protocol: 'http',
      favorite: false,
      source: 'subnet_scan',
      last_seen_at: iso(baseNow - 1000 * 41),
    },
    {
      id: 'node-nas',
      alias: '资料中转站',
      fingerprint: 'node-nas',
      device_model: 'Synology DS923+',
      device_type: 'server',
      ip: '192.168.31.80',
      port: 53317,
      protocol: 'http',
      favorite: false,
      source: 'favorite_scan',
      last_seen_at: iso(baseNow - 1000 * 63),
    },
  ],
  favorite_nodes: [
    {
      fingerprint: 'node-design-mbp',
      alias: '设计部 MacBook',
      device_model: 'MacBook Pro 14',
      device_type: 'desktop',
      last_known_ip: '192.168.31.18',
      last_known_port: 53317,
      created_at: iso(baseNow - 1000 * 60 * 90),
      updated_at: iso(baseNow - 1000 * 20),
    },
    {
      fingerprint: 'node-archive-air',
      alias: '产品经理 Air',
      device_model: 'MacBook Air',
      device_type: 'desktop',
      last_known_ip: '192.168.31.56',
      last_known_port: 53317,
      created_at: iso(baseNow - 1000 * 60 * 60 * 24),
      updated_at: iso(baseNow - 1000 * 60 * 12),
    },
  ],
  published_shares: [
    {
      id: 'mock-share-local-1',
      title: '数据库脚本合集',
      scope: 'favorite_only',
      file_count: 2,
      total_bytes: 4_216_341,
      created_at: iso(baseNow - 1000 * 60 * 26),
      updated_at: iso(baseNow - 1000 * 60 * 26),
      files: [
        buildPublishedFile('baseline.sql', 1_904_128),
        buildPublishedFile('patch-20260417.sql', 2_312_213),
      ],
      allowed_fingerprints: [],
    },
  ],
  tasks: [
    {
      id: 'mock-task-running',
      kind: 'direct_send',
      direction: 'outgoing',
      peer_alias: '设计部工作站 (NF-3C8D2E)',
      peer_fingerprint: 'node-design-mbp',
      status: 'running',
      total_bytes: 3_758_096_384,
      transferred_bytes: 0,
      progress_percent: 0,
      current_file_name: '项目资料.zip',
      started_at: iso(baseNow - 34_000),
      updated_at: iso(baseNow - 34_000),
      completed_at: null,
      error_message: null,
      files: [buildTaskFile('task-running-file-1', '项目资料.zip', 3_758_096_384)],
    },
    {
      id: 'mock-task-uploading',
      kind: 'publish_upload',
      direction: 'outgoing',
      peer_alias: '全局共享',
      peer_fingerprint: 'local-share-all',
      status: 'running',
      total_bytes: 2_684_354_560,
      transferred_bytes: 0,
      progress_percent: 0,
      current_file_name: '设计稿.psd',
      started_at: iso(baseNow - 20_000),
      updated_at: iso(baseNow - 20_000),
      completed_at: null,
      error_message: null,
      files: [buildTaskFile('task-uploading-file-1', '设计稿.psd', 2_684_354_560)],
    },
    {
      id: 'mock-task-pending',
      kind: 'direct_send',
      direction: 'outgoing',
      peer_alias: '产品组-测试机 (NF-9F1A7B)',
      peer_fingerprint: 'node-qa-win',
      status: 'pending',
      total_bytes: 1_932_735_283,
      transferred_bytes: 0,
      progress_percent: 0,
      current_file_name: '安装包.dmg',
      started_at: iso(baseNow - 10_000),
      updated_at: iso(baseNow - 10_000),
      completed_at: null,
      error_message: null,
      files: [buildTaskFile('task-pending-file-1', '安装包.dmg', 1_932_735_283)],
    },
    {
      id: 'mock-task-completed',
      kind: 'shared_download',
      direction: 'incoming',
      peer_alias: '设计部 MacBook',
      peer_fingerprint: 'node-design-mbp',
      status: 'completed',
      total_bytes: 11_924_126,
      transferred_bytes: 11_924_126,
      progress_percent: 100,
      current_file_name: null,
      started_at: iso(baseNow - 1000 * 60 * 4),
      updated_at: iso(baseNow - 1000 * 60 * 3),
      completed_at: iso(baseNow - 1000 * 60 * 3),
      error_message: null,
      files: [
        {
          id: 'task-completed-file-1',
          file_name: 'icons-pack.zip',
          size: 9_411_523,
          transferred_bytes: 9_411_523,
          status: 'completed',
          error_message: null,
        },
        {
          id: 'task-completed-file-2',
          file_name: 'logo-light.png',
          size: 1_245_891,
          transferred_bytes: 1_245_891,
          status: 'completed',
          error_message: null,
        },
        {
          id: 'task-completed-file-3',
          file_name: 'logo-dark.png',
          size: 1_266_712,
          transferred_bytes: 1_266_712,
          status: 'completed',
          error_message: null,
        },
      ],
    },
  ],
}

advanceMockTasks()

export const dataTransferMockApi = {
  async getSnapshot(): Promise<DataTransferSnapshot> {
    await delay()
    advanceMockTasks()
    return clone(snapshotState)
  },

  async setRegistrationEnabled(
    payload: DataTransferRegistrationPayload,
  ): Promise<DataTransferSnapshot> {
    await delay()
    snapshotState.local_node.registration_enabled = payload.enabled
    if (payload.enabled) {
      touchNodes()
    }
    return clone(snapshotState)
  },

  async refreshDiscovery(): Promise<DataTransferSnapshot> {
    await delay()
    touchNodes()
    return clone(snapshotState)
  },

  async updateFavorite(payload: DataTransferFavoritePayload): Promise<DataTransferSnapshot> {
    await delay()
    if (payload.favorite) {
      upsertFavoriteNode(payload)
    } else {
      snapshotState.favorite_nodes = snapshotState.favorite_nodes.filter(
        (item) => item.fingerprint !== payload.fingerprint,
      )
    }
    syncNodeFavorites()
    return clone(snapshotState)
  },

  async chooseFiles(): Promise<DataTransferChooseFilesResult> {
    await delay(80)
    const file_paths = mockFileSelections[chooseFilesCursor % mockFileSelections.length]
    chooseFilesCursor += 1
    return { canceled: false, file_paths: [...file_paths] }
  },

  async chooseFolder(): Promise<DataTransferChooseFolderResult> {
    await delay(80)
    return {
      canceled: false,
      directory_path: snapshotState.default_download_dir,
    }
  },

  async resolveSelectedFiles(
    payload: DataTransferResolveSelectedFilesPayload,
  ): Promise<DataTransferSelectedFile[]> {
    await delay(40)
    return payload.file_paths.map((file_path) => ({
      file_path,
      file_name: fileNameFromPath(file_path),
      size: sizeFromPath(file_path),
    }))
  },

  async startDirectSend(
    payload: DataTransferDirectSendPayload,
  ): Promise<DataTransferTaskStartResponse> {
    await delay()
    const node = snapshotState.nodes.find((item) => item.id === payload.node_id)
    if (!node) {
      throw new Error('目标节点不存在或已离线')
    }
    if (payload.file_paths.length === 0) {
      throw new Error('请选择至少一个待发送文件')
    }

    const task = buildRunningTask({
      direction: 'outgoing',
      filePaths: payload.file_paths,
      kind: 'direct_send',
      peer_alias: node.alias,
      peer_fingerprint: node.fingerprint,
    })
    snapshotState.tasks.unshift(task)
    return { task_id: task.id }
  },

  async publishFiles(payload: DataTransferPublishPayload): Promise<DataTransferSnapshot> {
    await delay()
    if (payload.file_paths.length === 0) {
      throw new Error('请选择至少一个共享文件')
    }
    const files = payload.file_paths.map((path) => buildPublishedFile(fileNameFromPath(path), sizeFromPath(path)))
    const total_bytes = files.reduce((sum, item) => sum + item.size, 0)
    const now = iso(Date.now())
    snapshotState.published_shares.unshift({
      id: `mock-share-local-${shareCounter += 1}`,
      title: files.length === 1 ? files[0].file_name : `${files.length} 个文件`,
      scope: payload.scope,
      file_count: files.length,
      total_bytes,
      created_at: now,
      updated_at: now,
      files,
      allowed_fingerprints: [...payload.allowed_fingerprints],
    })
    return clone(snapshotState)
  },

  async removePublishedShare(
    payload: DataTransferRemoveSharePayload,
  ): Promise<DataTransferSnapshot> {
    await delay()
    snapshotState.published_shares = snapshotState.published_shares.filter(
      (item) => item.id !== payload.share_id,
    )
    return clone(snapshotState)
  },

  async loadRemoteShares(
    payload: DataTransferLoadRemoteSharesPayload,
  ): Promise<DataTransferRemoteShareResponse> {
    await delay()
    return {
      node_id: payload.node_id,
      shares: clone(remoteSharesByNodeId[payload.node_id] ?? []),
    }
  },

  async downloadShare(
    payload: DataTransferDownloadSharePayload,
  ): Promise<DataTransferTaskStartResponse> {
    await delay()
    const node = snapshotState.nodes.find((item) => item.id === payload.node_id)
    if (!node) {
      throw new Error('远端共享节点不存在或已离线')
    }

    const share = (remoteSharesByNodeId[payload.node_id] ?? []).find(
      (item) => item.id === payload.share_id,
    )
    if (!share) {
      throw new Error('远端共享不存在')
    }

    const selectedFiles = share.files.filter(
      (file) => payload.file_ids.length === 0 || payload.file_ids.includes(file.id),
    )
    if (selectedFiles.length === 0) {
      throw new Error('请选择至少一个共享文件')
    }

    const task = buildRunningTask({
      direction: 'incoming',
      filePaths: selectedFiles.map((item) => item.file_name),
      files: selectedFiles.map((item) => ({
        id: item.id,
        file_name: item.file_name,
        size: item.size,
        transferred_bytes: 0,
        status: 'pending',
        error_message: null,
      })),
      kind: 'shared_download',
      peer_alias: node.alias,
      peer_fingerprint: node.fingerprint,
    })
    snapshotState.tasks.unshift(task)
    return { task_id: task.id }
  },

  async cancelTask(task_id: string): Promise<DataTransferTaskCancelResponse> {
    await delay(80)
    const task = snapshotState.tasks.find((item) => item.id === task_id)
    if (!task) {
      return { task_id, accepted: false }
    }

    task.status = 'canceled'
    task.error_message = '已在前端预览模式中取消任务'
    task.current_file_name = null
    task.completed_at = iso(Date.now())
    task.updated_at = task.completed_at
    delete taskRuntimes[task_id]
    return { task_id, accepted: true }
  },
}

function advanceMockTasks() {
  const now = Date.now()
  Object.entries(taskRuntimes).forEach(([taskId, runtime]) => {
    const task = snapshotState.tasks.find((item) => item.id === taskId)
    if (!task || task.status !== 'running') {
      delete taskRuntimes[taskId]
      return
    }

    const ratio = Math.min(1, (now - runtime.started_at_ms) / runtime.duration_ms)
    const transferredTotal =
      task.total_bytes === 0 ? 0 : Math.round(task.total_bytes * Math.max(0, ratio))
    let remaining = transferredTotal
    let currentFileName: string | null = null

    task.files.forEach((file, index) => {
      const transferred = Math.min(file.size, remaining)
      file.transferred_bytes = transferred
      remaining = Math.max(0, remaining - file.size)

      if (ratio >= 1 || transferred >= file.size) {
        file.status = 'completed'
      } else if (transferred > 0 || index === 0) {
        file.status = 'running'
        currentFileName = file.file_name
      } else {
        file.status = 'pending'
      }
    })

    task.transferred_bytes = transferredTotal
    task.progress_percent = task.total_bytes === 0 ? 100 : (transferredTotal / task.total_bytes) * 100
    task.current_file_name = ratio >= 1 ? null : currentFileName ?? task.files.at(-1)?.file_name ?? null
    task.updated_at = iso(now)

    if (ratio >= 1) {
      task.status = 'completed'
      task.progress_percent = 100
      task.completed_at = iso(now)
      task.error_message = null
      delete taskRuntimes[taskId]
    }
  })
}

function touchNodes() {
  const now = Date.now()
  snapshotState.nodes = snapshotState.nodes.map((node, index) => ({
    ...node,
    last_seen_at: iso(now - index * 1000 * 17),
  }))
}

function syncNodeFavorites() {
  const favoriteFingerprints = new Set(
    snapshotState.favorite_nodes.map((item) => item.fingerprint),
  )
  snapshotState.nodes = snapshotState.nodes.map((node) => ({
    ...node,
    favorite: favoriteFingerprints.has(node.fingerprint),
  }))
}

function upsertFavoriteNode(payload: DataTransferFavoritePayload) {
  const now = iso(Date.now())
  const nextItem: DataTransferFavoriteNode = {
    fingerprint: payload.fingerprint,
    alias: payload.alias,
    device_model: payload.device_model,
    device_type: payload.device_type,
    last_known_ip: payload.last_known_ip,
    last_known_port: payload.last_known_port,
    created_at:
      snapshotState.favorite_nodes.find((item) => item.fingerprint === payload.fingerprint)
        ?.created_at ?? now,
    updated_at: now,
  }
  const nextFavorites = snapshotState.favorite_nodes.filter(
    (item) => item.fingerprint !== payload.fingerprint,
  )
  nextFavorites.unshift(nextItem)
  snapshotState.favorite_nodes = nextFavorites
}

function buildRunningTask({
  direction,
  filePaths,
  files,
  kind,
  peer_alias,
  peer_fingerprint,
}: {
  direction: string
  filePaths: string[]
  files?: DataTransferTaskFile[]
  kind: string
  peer_alias: string
  peer_fingerprint: string
}): DataTransferTask {
  const taskFiles =
    files ??
    filePaths.map((path, index) =>
      buildTaskFile(
        `mock-task-file-${taskCounter}-${index + 1}`,
        fileNameFromPath(path),
        sizeFromPath(path),
      ),
    )
  const total_bytes = taskFiles.reduce((sum, item) => sum + item.size, 0)
  taskCounter += 1
  const taskId = `mock-task-${taskCounter}`
  const started_at_ms = Date.now()
  taskRuntimes[taskId] = {
    duration_ms: 12_000 + taskFiles.length * 3_500,
    started_at_ms,
  }

  return {
    id: taskId,
    kind,
    direction,
    peer_alias,
    peer_fingerprint,
    status: 'running',
    total_bytes,
    transferred_bytes: 0,
    progress_percent: 0,
    current_file_name: taskFiles[0]?.file_name ?? null,
    started_at: iso(started_at_ms),
    updated_at: iso(started_at_ms),
    completed_at: null,
    error_message: null,
    files: taskFiles,
  }
}

function buildTaskFile(id: string, file_name: string, size: number): DataTransferTaskFile {
  return {
    id,
    file_name,
    size,
    transferred_bytes: 0,
    status: 'pending',
    error_message: null,
  }
}

function buildPublishedFile(file_name: string, size: number): DataTransferPublishedFile {
  return {
    id: `published-file-${file_name}-${size}`,
    file_name,
    relative_path: null,
    size,
    mime_type: guessMimeType(file_name),
  }
}

function buildRemoteFile(file_name: string, size: number) {
  return {
    id: `remote-file-${file_name}-${size}`,
    file_name,
    relative_path: null,
    size,
    mime_type: guessMimeType(file_name),
  }
}

function sizeFromPath(path: string) {
  const normalized = fileNameFromPath(path).toLowerCase()
  if (normalized.endsWith('.zip') || normalized.endsWith('.tar.gz')) {
    return 438_612_224
  }
  if (normalized.endsWith('.mp4')) {
    return 612_330_442
  }
  if (normalized.endsWith('.xlsx') || normalized.endsWith('.fig')) {
    return 18_432_018
  }
  if (normalized.endsWith('.sql')) {
    return 2_108_224
  }
  if (normalized.endsWith('.pdf')) {
    return 12_206_144
  }
  if (normalized.endsWith('.docx')) {
    return 29_687_781
  }
  if (normalized.endsWith('.txt')) {
    return 92_116
  }
  return 6_128_512
}

function guessMimeType(file_name: string) {
  const normalized = file_name.toLowerCase()
  if (normalized.endsWith('.zip') || normalized.endsWith('.tar.gz')) {
    return 'application/zip'
  }
  if (normalized.endsWith('.sql') || normalized.endsWith('.txt')) {
    return 'text/plain'
  }
  if (normalized.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  if (normalized.endsWith('.pdf')) {
    return 'application/pdf'
  }
  if (normalized.endsWith('.png')) {
    return 'image/png'
  }
  if (normalized.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
  if (normalized.endsWith('.mp4')) {
    return 'video/mp4'
  }
  return 'application/octet-stream'
}

function fileNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').at(-1) || normalized
}

function clone<T>(value: T) {
  return structuredClone(value)
}

function iso(time: number) {
  return new Date(time).toISOString()
}

function delay(ms = 120) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

import type {
  CompareTaskPhase,
  CompareTaskProgressResponse,
  CompareTaskResultEnvelope,
} from '../../types'

type WaitForCompareTaskOptions<T> = {
  compareId: string
  getProgress: (compareId: string) => Promise<CompareTaskProgressResponse>
  getResult: (compareId: string) => Promise<CompareTaskResultEnvelope<T>>
  onProgress: (progress: CompareTaskProgressResponse) => void
  intervalMs?: number
}

export async function waitForCompareTask<T>({
  compareId,
  getProgress,
  getResult,
  onProgress,
  intervalMs = 240,
}: WaitForCompareTaskOptions<T>): Promise<CompareTaskResultEnvelope<T>> {
  for (;;) {
    const progress = await getProgress(compareId)
    onProgress(progress)

    if (
      progress.status === 'completed' ||
      progress.status === 'failed' ||
      progress.status === 'canceled'
    ) {
      return getResult(compareId)
    }

    await new Promise((resolve) => window.setTimeout(resolve, intervalMs))
  }
}

export function formatCompareTaskPhaseLabel(phase: CompareTaskPhase | null) {
  switch (phase) {
    case 'pending':
      return '等待执行'
    case 'discover_tables':
      return '发现表清单'
    case 'load_structure_metadata':
      return '加载结构元数据'
    case 'prepare_table':
      return '准备单表对比'
    case 'table_checksum':
      return '表级校验和预筛'
    case 'keyed_hash_scan':
      return '键控哈希扫描'
    case 'chunk_hash_scan':
      return '分块哈希扫描'
    case 'source_stage_load':
      return '写入源端缓存'
    case 'target_stage_load':
      return '写入目标端缓存'
    case 'finalize_cache':
      return '归并缓存结果'
    case 'compare_table':
      return '执行单表比较'
    case 'completed':
      return '已完成'
    default:
      return '进行中'
  }
}

import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { getCompareHistoryDetail, listCompareHistory } from '../../api'
import type { CompareHistoryItem, CompareHistorySummary, CompareHistoryType } from '../../types'
import type { RailSection, ToastTone } from './appTypes'

type UseCompareHistoryStateOptions = {
  activeSection: RailSection
  pushToast: (message: string, tone: ToastTone) => void
}

function filterActiveHistoryDetails(
  detailById: Record<number, CompareHistoryItem>,
  historyItems: CompareHistorySummary[],
) {
  const activeIds = new Set(historyItems.map((item) => item.id))
  return Object.fromEntries(
    Object.entries(detailById).filter(([historyId]) => activeIds.has(Number(historyId))),
  )
}

export function useCompareHistoryState({
  activeSection,
  pushToast,
}: UseCompareHistoryStateOptions) {
  const [compareHistoryItems, setCompareHistoryItems] = useState<CompareHistorySummary[]>([])
  const [compareHistoryDetailById, setCompareHistoryDetailById] = useState<
    Record<number, CompareHistoryItem>
  >({})
  const [historyDetailLoadingId, setHistoryDetailLoadingId] = useState<number | null>(null)
  const [compareHistoryType, setCompareHistoryType] =
    useState<CompareHistoryType>('data')
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null)
  const pushToastEvent = useEffectEvent((message: string, tone: ToastTone) => {
    pushToast(message, tone)
  })

  const visibleHistoryItems = useMemo(
    () => compareHistoryItems.filter((item) => item.history_type === compareHistoryType),
    [compareHistoryItems, compareHistoryType],
  )
  const effectiveSelectedHistoryId =
    selectedHistoryId != null &&
    visibleHistoryItems.some((item) => item.id === selectedHistoryId)
      ? selectedHistoryId
      : visibleHistoryItems[0]?.id ?? null
  const selectedHistorySummary = useMemo(
    () =>
      effectiveSelectedHistoryId == null
        ? null
        : visibleHistoryItems.find((item) => item.id === effectiveSelectedHistoryId) ?? null,
    [effectiveSelectedHistoryId, visibleHistoryItems],
  )
  const selectedHistoryItem =
    effectiveSelectedHistoryId == null
      ? null
      : compareHistoryDetailById[effectiveSelectedHistoryId] ?? null

  function replaceCompareHistoryItems(historyItems: CompareHistorySummary[]) {
    setCompareHistoryItems(historyItems)
    setCompareHistoryDetailById((previous) =>
      filterActiveHistoryDetails(previous, historyItems),
    )
  }

  async function refreshCompareHistoryState() {
    try {
      const history = await listCompareHistory(100)
      replaceCompareHistoryItems(history)
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '读取对比记录失败', 'error')
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadInitialHistory() {
      try {
        const history = await listCompareHistory(100)
        if (!cancelled) {
          replaceCompareHistoryItems(history)
        }
      } catch (error) {
        if (!cancelled) {
          pushToastEvent(error instanceof Error ? error.message : '读取对比记录失败', 'error')
        }
      }
    }

    void loadInitialHistory()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (activeSection !== 'compare_history' || effectiveSelectedHistoryId == null) {
      return
    }
    if (compareHistoryDetailById[effectiveSelectedHistoryId]) {
      return
    }

    let cancelled = false

    async function loadHistoryDetail() {
      setHistoryDetailLoadingId(effectiveSelectedHistoryId)
      const detail = await getCompareHistoryDetail(effectiveSelectedHistoryId)
        if (cancelled || !detail) {
          return
        }

        setCompareHistoryDetailById((previous) => ({
          ...previous,
          [effectiveSelectedHistoryId]: detail,
        }))
    }

    void loadHistoryDetail()
      .catch((error) => {
        if (!cancelled) {
          pushToastEvent(
            error instanceof Error ? error.message : '读取对比记录详情失败',
            'error',
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHistoryDetailLoadingId((previous) =>
            previous === effectiveSelectedHistoryId ? null : previous,
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeSection, compareHistoryDetailById, effectiveSelectedHistoryId])

  return {
    compareHistoryItems,
    compareHistoryType,
    historyDetailLoadingId,
    refreshCompareHistoryState,
    selectedHistoryId,
    selectedHistoryItem,
    selectedHistorySummary,
    setCompareHistoryType,
    setSelectedHistoryId,
    visibleHistoryItems,
  }
}

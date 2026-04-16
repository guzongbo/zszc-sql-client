import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceTab } from './appTypes'

export function useWorkspaceTabsState() {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([])
  const [activeTabId, setActiveTabId] = useState('')
  const tabsRef = useRef<WorkspaceTab[]>([])

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  function patchTab(tabId: string, updater: (tab: WorkspaceTab) => WorkspaceTab) {
    setTabs((previous) =>
      previous.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
    )
  }

  function removeTab(tabId: string) {
    const remaining = tabsRef.current.filter((tab) => tab.id !== tabId)
    setTabs(remaining)
    setActiveTabId((previous) => {
      if (previous !== tabId) {
        return previous
      }
      return remaining.at(-1)?.id ?? ''
    })
  }

  function replaceTab(tabId: string, nextTab: WorkspaceTab) {
    setTabs((previous) =>
      previous
        .filter((tab) => tab.id !== nextTab.id || tab.id === tabId)
        .map((tab) => (tab.id === tabId ? nextTab : tab)),
    )
    setActiveTabId(nextTab.id)
  }

  function upsertTab(nextTab: WorkspaceTab) {
    setTabs((previous) => {
      const exists = previous.some((tab) => tab.id === nextTab.id)
      return exists
        ? previous.map((tab) => (tab.id === nextTab.id ? nextTab : tab))
        : [...previous, nextTab]
    })
    setActiveTabId(nextTab.id)
  }

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, tabs],
  )

  return {
    activeTab,
    activeTabId,
    patchTab,
    removeTab,
    replaceTab,
    setActiveTabId,
    setTabs,
    tabs,
    upsertTab,
  }
}

import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import { listDatabaseTables, listProfileDatabases, loadSqlAutocomplete } from '../../api'
import type {
  ConnectionProfile,
  DataSourceGroup,
  DatabaseEntry,
  SqlAutocompleteSchema,
  TableEntry,
} from '../../types'
import type { SelectionState, ToastTone } from './appTypes'
import {
  buildDatabaseKey,
  buildDataSourceTreeGroups,
  buildNavigationTreeGroups,
} from './navigation'

type UseWorkspaceNavigationStateOptions = {
  dataSourceGroups: DataSourceGroup[]
  profiles: ConnectionProfile[]
  pushToast: (message: string, tone: ToastTone) => void
}

type ProfileConnectionStatus = 'idle' | 'connected' | 'error'
type SqlAutocompleteCacheEntry = {
  schema: SqlAutocompleteSchema
  loaded_at: number
}

const SQL_AUTOCOMPLETE_CACHE_TTL_MS = 5 * 60 * 1000

function isSqlAutocompleteCacheFresh(
  entry: SqlAutocompleteCacheEntry,
  now = Date.now(),
) {
  return now - entry.loaded_at <= SQL_AUTOCOMPLETE_CACHE_TTL_MS
}

export function useWorkspaceNavigationState({
  dataSourceGroups,
  profiles,
  pushToast,
}: UseWorkspaceNavigationStateOptions) {
  const [selection, setSelection] = useState<SelectionState>({ kind: 'none' })
  const [selectedGroupKey, setSelectedGroupKey] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [navigationSearchText, setNavigationSearchText] = useState('')
  const [databasesByProfile, setDatabasesByProfile] = useState<Record<string, DatabaseEntry[]>>(
    {},
  )
  const [tablesByDatabase, setTablesByDatabase] = useState<Record<string, TableEntry[]>>({})
  const [sqlAutocompleteCacheByDatabase, setSqlAutocompleteCacheByDatabase] = useState<
    Record<string, SqlAutocompleteCacheEntry>
  >({})
  const [nodeLoading, setNodeLoading] = useState<Record<string, boolean>>({})
  const [profileConnectionState, setProfileConnectionState] = useState<
    Record<string, ProfileConnectionStatus>
  >({})
  const sqlAutocompleteRequestsRef = useRef<
    Partial<Record<string, Promise<SqlAutocompleteSchema | null>>>
  >({})
  const tableLoadRequestsRef = useRef<Partial<Record<string, Promise<TableEntry[]>>>>({})
  const deferredNavigationSearchText = useDeferredValue(navigationSearchText)
  const normalizedNavigationSearchText = deferredNavigationSearchText.trim().toLowerCase()
  const sqlAutocompleteByDatabase = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(sqlAutocompleteCacheByDatabase).map(([key, entry]) => [
          key,
          entry.schema,
        ]),
      ),
    [sqlAutocompleteCacheByDatabase],
  )
  const ensureTablesLoadedEvent = useEffectEvent(
    (profileId: string, databaseName: string) =>
      ensureTablesLoaded(profileId, databaseName),
  )

  const dataSourceTreeGroups = useMemo(
    () => buildDataSourceTreeGroups(dataSourceGroups, profiles),
    [dataSourceGroups, profiles],
  )
  const connectedProfileIds = useMemo(
    () =>
      new Set(
        profiles
          .filter((profile) => profileConnectionState[profile.id] === 'connected')
          .map((profile) => profile.id),
      ),
    [profileConnectionState, profiles],
  )
  const navigationTreeGroups = useMemo(
    () =>
      buildNavigationTreeGroups(dataSourceTreeGroups, {
        search_keyword: normalizedNavigationSearchText,
        connected_profile_ids: connectedProfileIds,
        databases_by_profile: databasesByProfile,
        tables_by_database: tablesByDatabase,
      }),
    [
      connectedProfileIds,
      dataSourceTreeGroups,
      databasesByProfile,
      normalizedNavigationSearchText,
      tablesByDatabase,
    ],
  )
  const visibleExpandedKeys = useMemo(() => {
    if (!normalizedNavigationSearchText) {
      return expandedKeys
    }

    const next = new Set(expandedKeys)
    navigationTreeGroups.forEach((group) => {
      next.add(group.key)
      group.profiles.forEach((profileView) => {
        if (profileView.matched_by_name || profileView.databases.length > 0) {
          next.add(`profile:${profileView.entry.id}`)
        }

        profileView.databases.forEach((databaseView) => {
          if (databaseView.tables.length > 0) {
            next.add(
              `database:${buildDatabaseKey(profileView.entry.id, databaseView.entry.name)}`,
            )
          }
        })
      })
    })
    return next
  }, [expandedKeys, navigationTreeGroups, normalizedNavigationSearchText])
  const selectedProfileId =
    selection.kind === 'profile'
      ? selection.profile_id
      : selection.kind === 'database'
        ? selection.profile_id
      : selection.kind === 'table'
        ? selection.profile_id
        : ''
  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ?? null

  useEffect(() => {
    if (!normalizedNavigationSearchText) {
      return
    }

    const connectedProfiles = profiles.filter(
      (profile) => profileConnectionState[profile.id] === 'connected',
    )
    if (connectedProfiles.length === 0) {
      return
    }

    let cancelled = false

    async function warmConnectedDatabaseTables() {
      for (const profile of connectedProfiles) {
        const databases = databasesByProfile[profile.id] ?? []
        for (const database of databases) {
          if (cancelled) {
            return
          }

          const databaseKey = buildDatabaseKey(profile.id, database.name)
          if (tablesByDatabase[databaseKey] || tableLoadRequestsRef.current[databaseKey]) {
            continue
          }

          await ensureTablesLoadedEvent(profile.id, database.name)
        }
      }
    }

    void warmConnectedDatabaseTables()

    return () => {
      cancelled = true
    }
  }, [
    databasesByProfile,
    normalizedNavigationSearchText,
    profileConnectionState,
    profiles,
    tablesByDatabase,
  ])

  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      setSqlAutocompleteCacheByDatabase((previous) => {
        const now = Date.now()
        const next = Object.fromEntries(
          Object.entries(previous).filter(([, entry]) =>
            isSqlAutocompleteCacheFresh(entry, now),
          ),
        )

        return Object.keys(next).length === Object.keys(previous).length
          ? previous
          : next
      })
    }, SQL_AUTOCOMPLETE_CACHE_TTL_MS)

    return () => {
      globalThis.clearInterval(timer)
    }
  }, [])

  function clearExpandedKeys() {
    setExpandedKeys(new Set())
  }

  function selectGroup(groupKey: string) {
    setSelectedGroupKey(groupKey)
    setSelection({ kind: 'none' })
  }

  function selectProfile(profileId: string) {
    setSelectedGroupKey('')
    setSelection({ kind: 'profile', profile_id: profileId })
  }

  function selectDatabase(profileId: string, databaseName: string) {
    setSelectedGroupKey('')
    setSelection({
      kind: 'database',
      profile_id: profileId,
      database_name: databaseName,
    })
  }

  function selectTable(profileId: string, databaseName: string, tableName: string) {
    setSelectedGroupKey('')
    setSelection({
      kind: 'table',
      profile_id: profileId,
      database_name: databaseName,
      table_name: tableName,
    })
  }

  async function ensureDatabasesLoaded(
    profileId: string,
    options?: { silent?: boolean; force?: boolean },
  ) {
    if (!options?.force && databasesByProfile[profileId]) {
      return databasesByProfile[profileId]
    }

    setNodeLoading((previous) => ({ ...previous, [profileId]: true }))
    try {
      const databases = await listProfileDatabases(profileId)
      setDatabasesByProfile((previous) => ({ ...previous, [profileId]: databases }))
      setProfileConnectionState((previous) => ({
        ...previous,
        [profileId]: 'connected',
      }))
      return databases
    } catch (error) {
      setProfileConnectionState((previous) => ({
        ...previous,
        [profileId]: 'error',
      }))
      if (!options?.silent) {
        pushToast(error instanceof Error ? error.message : '读取数据库失败', 'error')
      }
      return []
    } finally {
      setNodeLoading((previous) => ({ ...previous, [profileId]: false }))
    }
  }

  async function ensureTablesLoaded(
    profileId: string,
    databaseName: string,
    options?: { force?: boolean },
  ) {
    const databaseKey = buildDatabaseKey(profileId, databaseName)
    if (!options?.force && tablesByDatabase[databaseKey]) {
      return tablesByDatabase[databaseKey]
    }

    if (!options?.force && tableLoadRequestsRef.current[databaseKey]) {
      return tableLoadRequestsRef.current[databaseKey]
    }

    setNodeLoading((previous) => ({ ...previous, [databaseKey]: true }))
    const request = (async () => {
      try {
        const tables = await listDatabaseTables(profileId, databaseName)
        setTablesByDatabase((previous) => ({ ...previous, [databaseKey]: tables }))
        return tables
      } catch (error) {
        pushToast(error instanceof Error ? error.message : '读取数据表失败', 'error')
        return []
      } finally {
        delete tableLoadRequestsRef.current[databaseKey]
        setNodeLoading((previous) => ({ ...previous, [databaseKey]: false }))
      }
    })()

    tableLoadRequestsRef.current[databaseKey] = request
    return request
  }

  async function ensureSqlAutocompleteLoaded(
    profileId: string,
    databaseName: string,
    options?: { force?: boolean; silent?: boolean },
  ) {
    const databaseKey = buildDatabaseKey(profileId, databaseName)
    const cachedEntry = sqlAutocompleteCacheByDatabase[databaseKey]
    if (!options?.force && cachedEntry && isSqlAutocompleteCacheFresh(cachedEntry)) {
      return cachedEntry.schema
    }

    if (!options?.force && cachedEntry) {
      if (!sqlAutocompleteRequestsRef.current[databaseKey]) {
        sqlAutocompleteRequestsRef.current[databaseKey] = (async () => {
          try {
            const schema = await loadSqlAutocomplete({
              profile_id: profileId,
              database_name: databaseName,
            })
            setSqlAutocompleteCacheByDatabase((previous) => ({
              ...previous,
              [databaseKey]: {
                schema,
                loaded_at: Date.now(),
              },
            }))
            return schema
          } catch {
            return null
          } finally {
            delete sqlAutocompleteRequestsRef.current[databaseKey]
          }
        })()
      }

      return cachedEntry.schema
    }

    if (sqlAutocompleteRequestsRef.current[databaseKey]) {
      return sqlAutocompleteRequestsRef.current[databaseKey]
    }

    const request = (async () => {
      try {
        const schema = await loadSqlAutocomplete({
          profile_id: profileId,
          database_name: databaseName,
        })
        setSqlAutocompleteCacheByDatabase((previous) => ({
          ...previous,
          [databaseKey]: {
            schema,
            loaded_at: Date.now(),
          },
        }))
        return schema
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '读取 SQL 自动补全元数据失败'
        if (!options?.silent) {
          pushToast(message, 'error')
        }
        return null
      } finally {
        delete sqlAutocompleteRequestsRef.current[databaseKey]
      }
    })()

    sqlAutocompleteRequestsRef.current[databaseKey] = request
    return request
  }

  function clearSqlAutocompleteCache(profileId: string, databaseName?: string) {
    if (databaseName) {
      const databaseKey = buildDatabaseKey(profileId, databaseName)
      setSqlAutocompleteCacheByDatabase((previous) => {
        const next = { ...previous }
        delete next[databaseKey]
        return next
      })
      delete sqlAutocompleteRequestsRef.current[databaseKey]
      return
    }

    setSqlAutocompleteCacheByDatabase((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => !key.startsWith(`${profileId}:`)),
      ),
    )
    Object.keys(sqlAutocompleteRequestsRef.current).forEach((key) => {
      if (key.startsWith(`${profileId}:`)) {
        delete sqlAutocompleteRequestsRef.current[key]
      }
    })
  }

  function clearTablesCache(profileId: string, databaseName?: string) {
    if (databaseName) {
      const databaseKey = buildDatabaseKey(profileId, databaseName)
      setTablesByDatabase((previous) => {
        const next = { ...previous }
        delete next[databaseKey]
        return next
      })
      delete tableLoadRequestsRef.current[databaseKey]
      return
    }

    setTablesByDatabase((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => !key.startsWith(`${profileId}:`)),
      ),
    )
    Object.keys(tableLoadRequestsRef.current).forEach((key) => {
      if (key.startsWith(`${profileId}:`)) {
        delete tableLoadRequestsRef.current[key]
      }
    })
  }

  function clearProfileCaches(profileId: string) {
    setDatabasesByProfile((previous) => {
      const next = { ...previous }
      delete next[profileId]
      return next
    })
    clearTablesCache(profileId)
    setProfileConnectionState((previous) => {
      const next = { ...previous }
      delete next[profileId]
      return next
    })
    clearSqlAutocompleteCache(profileId)
  }

  function setProfileConnectionStatus(
    profileId: string,
    status: ProfileConnectionStatus | null,
  ) {
    setProfileConnectionState((previous) => {
      const next = { ...previous }
      if (status) {
        next[profileId] = status
      } else {
        delete next[profileId]
      }
      return next
    })
  }

  async function toggleNodeExpansion(
    key: string,
    loader?: () => Promise<void>,
  ) {
    const next = new Set(expandedKeys)
    if (next.has(key)) {
      next.delete(key)
      setExpandedKeys(next)
      return
    }

    next.add(key)
    setExpandedKeys(next)
    if (loader) {
      await loader()
    }
  }

  return {
    clearExpandedKeys,
    clearTablesCache,
    clearProfileCaches,
    clearSqlAutocompleteCache,
    databasesByProfile,
    ensureDatabasesLoaded,
    ensureSqlAutocompleteLoaded,
    ensureTablesLoaded,
    navigationSearchText,
    navigationTreeGroups,
    nodeLoading,
    profileConnectionState,
    selectDatabase,
    selectGroup,
    selectProfile,
    selectTable,
    selectedGroupKey,
    selectedProfile,
    selection,
    setExpandedKeys,
    setNavigationSearchText,
    setProfileConnectionStatus,
    setSelectedGroupKey,
    setSelection,
    sqlAutocompleteByDatabase,
    tablesByDatabase,
    toggleNodeExpansion,
    visibleExpandedKeys,
  }
}

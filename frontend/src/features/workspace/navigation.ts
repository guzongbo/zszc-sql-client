import type {
  ConnectionProfile,
  DataSourceGroup,
  DatabaseEntry,
  SaveConnectionProfilePayload,
  TableEntry,
} from '../../types'

export type DataSourceTreeGroup = {
  key: string
  group_id: string | null
  group_name: string
  profiles: ConnectionProfile[]
}

export type NavigationTreeTable = {
  entry: TableEntry
}

export type NavigationTreeDatabase = {
  entry: DatabaseEntry
  matched_by_name: boolean
  tables: NavigationTreeTable[]
}

export type NavigationTreeProfile = {
  entry: ConnectionProfile
  matched_by_name: boolean
  databases: NavigationTreeDatabase[]
}

export type NavigationTreeGroup = {
  key: string
  group_id: string | null
  group_name: string
  profiles: NavigationTreeProfile[]
}

export const ungroupedGroupName = '未分组'

export function buildDataSourceTreeGroups(
  groups: DataSourceGroup[],
  profiles: ConnectionProfile[],
): DataSourceTreeGroup[] {
  const profilesByGroup = new Map<string, ConnectionProfile[]>()

  profiles.forEach((profile) => {
    const groupName = normalizeGroupName(profile.group_name)
    if (!profilesByGroup.has(groupName)) {
      profilesByGroup.set(groupName, [])
    }
    profilesByGroup.get(groupName)!.push(profile)
  })

  const treeGroups = sortDataSourceGroups(groups).map((group) => {
    const groupName = normalizeGroupName(group.group_name)
    const groupProfiles = profilesByGroup.get(groupName) ?? []
    profilesByGroup.delete(groupName)

    return {
      key: `group:${groupName}`,
      group_id: group.id,
      group_name: group.group_name,
      profiles: groupProfiles,
    }
  })

  const leftoverGroups = Array.from(profilesByGroup.entries())
    .sort(([left], [right]) => compareGroupName(left, right))
    .map(([groupName, groupProfiles]) => ({
      key: `group:${groupName}`,
      group_id: null,
      group_name: groupName,
      profiles: groupProfiles,
    }))

  return [...treeGroups, ...leftoverGroups]
}

export function buildNavigationTreeGroups(
  groups: DataSourceTreeGroup[],
  options: {
    search_keyword: string
    connected_profile_ids: Set<string>
    databases_by_profile: Record<string, DatabaseEntry[]>
    tables_by_database: Record<string, TableEntry[]>
  },
): NavigationTreeGroup[] {
  const {
    search_keyword: searchKeyword,
    connected_profile_ids: connectedProfileIds,
    databases_by_profile: databasesByProfile,
    tables_by_database: tablesByDatabase,
  } = options

  return groups
    .map((group) => {
      const profiles = group.profiles
        .map((profile) => {
          const matchedByName = searchKeyword
            ? matchesNavigationSearch(profile.data_source_name, searchKeyword)
            : false
          const shouldSearchDatabases = searchKeyword
            ? connectedProfileIds.has(profile.id)
            : true

          const visibleDatabases = shouldSearchDatabases
            ? (databasesByProfile[profile.id] ?? [])
                .map((database) => {
                  const matchedDatabase = searchKeyword
                    ? matchesNavigationSearch(database.name, searchKeyword)
                    : false
                  const databaseKey = buildDatabaseKey(profile.id, database.name)
                  const visibleTables = searchKeyword
                    ? (tablesByDatabase[databaseKey] ?? [])
                        .filter((table) => matchesNavigationSearch(table.name, searchKeyword))
                        .map((table) => ({ entry: table }))
                    : (tablesByDatabase[databaseKey] ?? []).map((table) => ({ entry: table }))

                  if (searchKeyword && !matchedDatabase && visibleTables.length === 0) {
                    return null
                  }

                  return {
                    entry: database,
                    matched_by_name: matchedDatabase,
                    tables: visibleTables,
                  }
                })
                .filter((database): database is NavigationTreeDatabase => database !== null)
            : []

          if (searchKeyword && !matchedByName && visibleDatabases.length === 0) {
            return null
          }

          return {
            entry: profile,
            matched_by_name: matchedByName,
            databases: visibleDatabases,
          }
        })
        .filter((profile): profile is NavigationTreeProfile => profile !== null)

      if (searchKeyword && profiles.length === 0) {
        return null
      }

      return {
        key: group.key,
        group_id: group.group_id,
        group_name: group.group_name,
        profiles,
      }
    })
    .filter((group): group is NavigationTreeGroup => group !== null)
}

export function compareGroupName(left: string, right: string) {
  if (left === ungroupedGroupName) {
    return 1
  }
  if (right === ungroupedGroupName) {
    return -1
  }
  return left.localeCompare(right, 'zh-CN')
}

export function sortProfiles(profiles: ConnectionProfile[]) {
  return [...profiles].sort((left, right) => {
    const groupCompare = compareGroupName(
      normalizeGroupName(left.group_name),
      normalizeGroupName(right.group_name),
    )
    if (groupCompare !== 0) {
      return groupCompare
    }

    return left.data_source_name.localeCompare(right.data_source_name, 'zh-CN')
  })
}

export function sortDataSourceGroups(groups: DataSourceGroup[]) {
  return [...groups].sort((left, right) =>
    left.group_name.localeCompare(right.group_name, 'zh-CN'),
  )
}

export function profileToForm(profile: ConnectionProfile): SaveConnectionProfilePayload {
  return {
    id: profile.id,
    group_name: profile.group_name,
    data_source_name: profile.data_source_name,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    password: profile.password,
  }
}

export function normalizeProfileForm(
  form: SaveConnectionProfilePayload,
): SaveConnectionProfilePayload {
  return {
    id: form.id ?? null,
    group_name: form.group_name?.trim() ? form.group_name.trim() : null,
    data_source_name: form.data_source_name.trim(),
    host: form.host.trim(),
    port: form.port,
    username: form.username.trim(),
    password: form.password,
  }
}

export function normalizeGroupName(groupName: string | null | undefined) {
  return groupName?.trim() || ungroupedGroupName
}

export function expandAncestorsForProfile(
  previous: Set<string>,
  profile: ConnectionProfile,
) {
  const next = new Set(previous)
  next.add(`group:${normalizeGroupName(profile.group_name)}`)
  return next
}

export function expandAncestorsForDatabase(
  previous: Set<string>,
  profile: ConnectionProfile,
  databaseName: string,
) {
  const next = expandAncestorsForProfile(previous, profile)
  next.add(`profile:${profile.id}`)
  next.add(`database:${buildDatabaseKey(profile.id, databaseName)}`)
  return next
}

export function expandAncestorsForProfileNode(
  previous: Set<string>,
  profile: ConnectionProfile,
) {
  const next = expandAncestorsForProfile(previous, profile)
  next.add(`profile:${profile.id}`)
  return next
}

export function expandAncestorsForTable(
  previous: Set<string>,
  profile: ConnectionProfile,
  databaseName: string,
) {
  return expandAncestorsForDatabase(previous, profile, databaseName)
}

export function matchesNavigationSearch(value: string, keyword: string) {
  if (!keyword) {
    return true
  }

  return value.toLowerCase().includes(keyword)
}

export function upsertProfile(previous: ConnectionProfile[], profile: ConnectionProfile) {
  const exists = previous.some((item) => item.id === profile.id)
  return exists
    ? previous.map((item) => (item.id === profile.id ? profile : item))
    : [...previous, profile]
}

export function buildDatabaseKey(profileId: string, databaseName: string) {
  return `${profileId}:${databaseName}`
}

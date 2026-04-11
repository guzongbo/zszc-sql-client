import { useEffect, useRef, useState } from 'react'
import Editor, { DiffEditor, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import type {
  DatabaseEntry,
  SqlAutocompleteColumn,
  SqlAutocompleteSchema,
  SqlAutocompleteTable,
  TableDataColumn,
} from './types'

type SqlEditorMode = 'console' | 'where' | 'order_by'

export type SqlEditorProps = {
  editor_id: string
  mode: SqlEditorMode
  value: string
  placeholder: string
  onChange: (value: string) => void
  onSubmit?: () => void
  database_name?: string | null
  table_name?: string | null
  table_columns?: TableDataColumn[]
  schema_tables?: SqlAutocompleteTable[]
  schema_catalog?: SqlAutocompleteSchema[]
  database_names?: DatabaseEntry['name'][]
  onResolveSchema?: (databaseName: string) => Promise<SqlAutocompleteSchema | null>
  onExecute?: () => void
}

export type SqlDiffViewerProps = {
  editor_id: string
  original_sql: string
  modified_sql: string
  original_label?: string
  modified_label?: string
}

type SqlEditorContext = {
  mode: SqlEditorMode
  database_name: string | null
  table_name: string
  table_columns: TableDataColumn[]
  schema_catalog: SqlAutocompleteSchema[]
  database_names: string[]
  onResolveSchema?: (databaseName: string) => Promise<SqlAutocompleteSchema | null>
}

type CatalogTable = {
  database_name: string
  name: string
  columns: SqlAutocompleteColumn[]
}

type CatalogSchema = {
  database_name: string
  tables: Map<string, CatalogTable>
}

type SqlCatalog = {
  schemas: Map<string, CatalogSchema>
}

type QueryRelation = {
  source_kind: 'table' | 'cte' | 'subquery'
  name: string
  database_name: string | null
  alias: string | null
  columns: SqlAutocompleteColumn[]
}

type QueryAnalysis = {
  ctes: QueryRelation[]
  relations: QueryRelation[]
  projection_columns: SqlAutocompleteColumn[]
}

type SqlToken = {
  type: 'word' | 'identifier' | 'string' | 'number' | 'punctuation' | 'operator'
  text: string
  normalized: string
}

type CompletionClauseContext =
  | { kind: 'relation' }
  | { kind: 'join_on'; expected_column_name: string | null }
  | { kind: 'column' }

type QualifiedAccess = {
  namespaces: string[]
  partial: string
}

const sqlEditorContexts = new Map<string, SqlEditorContext>()
let monacoConfigured = false
let monacoFeaturesRegistered = false

const monacoKeywordTemplates = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT JOIN',
  'INNER JOIN',
  'RIGHT JOIN',
  'ON',
  'AND',
  'OR',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'LIMIT',
  'WITH',
  'AS',
  'EXISTS',
  'IN',
  'NOT IN',
  'LIKE',
  'IS NULL',
  'IS NOT NULL',
  'COUNT(*)',
  'DISTINCT',
  'UNION ALL',
]

const joinStopKeywords = new Set([
  'where',
  'group',
  'having',
  'order',
  'limit',
  'offset',
  'fetch',
  'union',
  'intersect',
  'except',
  'returning',
])

const aliasStopKeywords = new Set([
  'where',
  'group',
  'having',
  'order',
  'limit',
  'offset',
  'fetch',
  'for',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'cross',
  'on',
  'union',
  'intersect',
  'except',
  'using',
])

configureMonacoLoader()

export function SqlEditor({
  editor_id,
  mode,
  value,
  placeholder,
  onChange,
  onSubmit,
  database_name,
  table_name,
  table_columns,
  schema_tables,
  schema_catalog,
  database_names,
  onResolveSchema,
  onExecute,
}: SqlEditorProps) {
  const [focused, setFocused] = useState(false)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const executeRef = useRef(onExecute)
  const submitRef = useRef(onSubmit)
  const modelPath = buildModelPath(editor_id, mode)
  const isConsole = mode === 'console'

  useEffect(() => {
    executeRef.current = onExecute
  }, [onExecute])

  useEffect(() => {
    submitRef.current = onSubmit
  }, [onSubmit])

  useEffect(() => {
    sqlEditorContexts.set(
      modelPath,
      buildEditorContext({
        mode,
        database_name,
        table_name,
        table_columns,
        schema_tables,
        schema_catalog,
        database_names,
        onResolveSchema,
      }),
    )

    return () => {
      sqlEditorContexts.delete(modelPath)
    }
  }, [
    modelPath,
    mode,
    database_name,
    table_name,
    table_columns,
    schema_tables,
    schema_catalog,
    database_names,
    onResolveSchema,
  ])

  return (
    <div className={`sql-editor-shell ${isConsole ? 'console' : 'inline'}`}>
      {!value && !focused ? (
        <div className={`sql-editor-placeholder ${isConsole ? 'console' : 'inline'}`}>
          {placeholder}
        </div>
      ) : null}

      <Editor
        beforeMount={ensureMonacoSqlFeatures}
        defaultLanguage="sql"
        height={isConsole ? '100%' : '36px'}
        language="sql"
        options={buildEditorOptions(mode)}
        onChange={(nextValue) => onChange(nextValue ?? '')}
        onMount={(editor, monacoApi) => {
          editorRef.current = editor
          editor.onDidFocusEditorText(() => setFocused(true))
          editor.onDidBlurEditorText(() => setFocused(false))

          if (mode === 'console') {
            editor.addAction({
              id: `run-sql:${modelPath}`,
              keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Enter],
              label: '执行 SQL',
              run: () => {
                executeRef.current?.()
                return undefined
              },
            })
          } else {
            editor.addAction({
              id: `submit-inline-sql:${modelPath}`,
              keybindings: [monacoApi.KeyCode.Enter],
              label: '提交条件',
              precondition: '!suggestWidgetVisible',
              run: () => {
                submitRef.current?.()
                return undefined
              },
            })
          }
        }}
        path={modelPath}
        theme="zszc-sql-dark"
        value={value}
      />
    </div>
  )
}

export function SqlDiffViewer({
  editor_id,
  original_sql,
  modified_sql,
  original_label = '源端 DDL',
  modified_label = '目标端 DDL',
}: SqlDiffViewerProps) {
  return (
    <div className="sql-diff-shell">
      <div className="sql-diff-labels">
        <div className="sql-diff-label">{original_label}</div>
        <div className="sql-diff-label">{modified_label}</div>
      </div>

      <DiffEditor
        beforeMount={ensureMonacoSqlFeatures}
        height="420px"
        language="sql"
        modified={modified_sql}
        modifiedModelPath={buildDiffModelPath(editor_id, 'modified')}
        options={buildDiffEditorOptions()}
        original={original_sql}
        originalModelPath={buildDiffModelPath(editor_id, 'original')}
        theme="zszc-sql-dark"
      />
    </div>
  )
}

function buildEditorContext({
  mode,
  database_name,
  table_name,
  table_columns,
  schema_tables,
  schema_catalog,
  database_names,
  onResolveSchema,
}: {
  mode: SqlEditorMode
  database_name?: string | null
  onResolveSchema?: (databaseName: string) => Promise<SqlAutocompleteSchema | null>
  table_name?: string | null
  table_columns?: TableDataColumn[]
  schema_tables?: SqlAutocompleteTable[]
  schema_catalog?: SqlAutocompleteSchema[]
  database_names?: string[]
}) {
  const nextCatalog = [...(schema_catalog ?? [])]
  if (
    database_name &&
    schema_tables &&
    schema_tables.length > 0 &&
    !nextCatalog.some((schema) => schema.database_name === database_name)
  ) {
    nextCatalog.unshift({
      profile_id: '__inline__',
      database_name,
      tables: schema_tables,
    })
  }

  return {
    mode,
    database_name: database_name ?? null,
    table_name: table_name ?? '',
    table_columns: table_columns ?? [],
    schema_catalog: dedupeSchemaCatalog(nextCatalog),
    database_names: [...(database_names ?? [])].sort((left, right) =>
      left.localeCompare(right, 'zh-CN'),
    ),
    onResolveSchema,
  }
}

function buildEditorOptions(mode: SqlEditorMode): monaco.editor.IStandaloneEditorConstructionOptions {
  const isConsole = mode === 'console'

  return {
    automaticLayout: true,
    contextmenu: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    fixedOverflowWidgets: true,
    fontFamily: '"SFMono-Regular", "JetBrains Mono", "Fira Code", monospace',
    fontLigatures: true,
    fontSize: isConsole ? 15 : 13,
    glyphMargin: false,
    lineDecorationsWidth: isConsole ? 12 : 0,
    lineHeight: isConsole ? 28 : 24,
    lineNumbers: isConsole ? 'on' : 'off',
    lineNumbersMinChars: isConsole ? 3 : 0,
    minimap: { enabled: false },
    overviewRulerBorder: false,
    padding: isConsole ? { top: 10, bottom: 12 } : { top: 6, bottom: 6 },
    quickSuggestions: {
      comments: false,
      other: true,
      strings: false,
    },
    renderFinalNewline: 'off',
    roundedSelection: true,
    scrollBeyondLastLine: false,
    scrollbar: {
      alwaysConsumeMouseWheel: false,
      horizontal: isConsole ? 'auto' : 'hidden',
      horizontalScrollbarSize: isConsole ? 10 : 0,
      useShadows: false,
      vertical: isConsole ? 'auto' : 'hidden',
      verticalScrollbarSize: isConsole ? 10 : 0,
    },
    suggest: {
      insertMode: 'replace',
      localityBonus: true,
      preview: true,
      previewMode: 'prefix',
      selectionMode: 'whenQuickSuggestion',
      showIcons: true,
    },
    tabSize: 2,
    wordWrap: isConsole ? 'off' : 'off',
  }
}

function buildDiffEditorOptions(): monaco.editor.IDiffEditorConstructionOptions {
  return {
    automaticLayout: true,
    diffCodeLens: false,
    enableSplitViewResizing: true,
    fixedOverflowWidgets: true,
    fontFamily: '"SFMono-Regular", "JetBrains Mono", "Fira Code", monospace',
    fontLigatures: true,
    fontSize: 13,
    glyphMargin: false,
    lineDecorationsWidth: 10,
    lineNumbers: 'on',
    lineNumbersMinChars: 3,
    minimap: { enabled: false },
    originalEditable: false,
    overviewRulerBorder: false,
    padding: { top: 10, bottom: 12 },
    readOnly: true,
    renderIndicators: true,
    renderMarginRevertIcon: false,
    renderOverviewRuler: true,
    renderSideBySide: true,
    scrollBeyondLastLine: false,
    scrollbar: {
      alwaysConsumeMouseWheel: false,
      horizontal: 'auto',
      horizontalScrollbarSize: 10,
      useShadows: false,
      vertical: 'auto',
      verticalScrollbarSize: 10,
    },
    splitViewDefaultRatio: 0.5,
    wordWrap: 'off',
  }
}

function configureMonacoLoader() {
  if (monacoConfigured) {
    return
  }

  const globalScope = globalThis as typeof globalThis & {
    MonacoEnvironment?: {
      getWorker: () => Worker
    }
  }

  globalScope.MonacoEnvironment = {
    getWorker: () => new editorWorker(),
  }
  loader.config({ monaco })
  monacoConfigured = true
}

function ensureMonacoSqlFeatures(monacoApi: typeof monaco) {
  if (monacoFeaturesRegistered) {
    return
  }

  defineSqlTheme(monacoApi)

  monacoApi.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' ', '*'],
    provideCompletionItems: async (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ) => {
      const editorContext = sqlEditorContexts.get(model.uri.toString())
      if (!editorContext) {
        return { suggestions: [] }
      }

      if (editorContext.mode === 'where' || editorContext.mode === 'order_by') {
        return {
          suggestions: buildInlineSuggestions(monacoApi, model, position, editorContext),
        }
      }

      const suggestions = await buildConsoleSuggestions(
        monacoApi,
        model,
        position,
        editorContext,
      )
      return { suggestions }
    },
  })

  monacoApi.languages.registerHoverProvider('sql', {
    provideHover: async (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ) => {
      const editorContext = sqlEditorContexts.get(model.uri.toString())
      if (!editorContext) {
        return null
      }

      if (editorContext.mode !== 'console') {
        return buildInlineHover(monacoApi, model, position, editorContext)
      }

      return buildConsoleHover(monacoApi, model, position, editorContext)
    },
  })

  monacoFeaturesRegistered = true
}

function defineSqlTheme(monacoApi: typeof monaco) {
  monacoApi.editor.defineTheme('zszc-sql-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword.sql', foreground: '7db7ff', fontStyle: 'bold' },
      { token: 'string.sql', foreground: '9fdc7f' },
      { token: 'number.sql', foreground: 'f5c87a' },
      { token: 'comment.sql', foreground: '6f7d90' },
      { token: 'delimiter.sql', foreground: 'dbe6f7' },
      { token: 'identifier.sql', foreground: 'e6edf8' },
    ],
    colors: {
      'editor.background': '#1d1f24',
      'editor.foreground': '#e7edf7',
      'editor.lineHighlightBackground': '#20242c',
      'editor.selectionBackground': '#21456b',
      'editor.inactiveSelectionBackground': '#1b3249',
      'editorCursor.foreground': '#98c6ff',
      'editorSuggestWidget.background': '#10161f',
      'editorSuggestWidget.border': '#2d3644',
      'editorSuggestWidget.foreground': '#e7edf7',
      'editorSuggestWidget.selectedBackground': '#21456b',
      'editorHoverWidget.background': '#10161f',
      'editorHoverWidget.border': '#2d3644',
      'editorLineNumber.foreground': '#657080',
      'editorLineNumber.activeForeground': '#8ea6c8',
      'editorWidget.background': '#10161f',
      'diffEditor.border': '#2d3644',
      'diffEditor.diagonalFill': '#121720',
      'diffEditor.insertedLineBackground': '#13261a',
      'diffEditor.insertedTextBackground': '#1e7b46a0',
      'diffEditor.removedLineBackground': '#2a171c',
      'diffEditor.removedTextBackground': '#91273ba0',
      'diffEditorOverview.insertedForeground': '#2ca75f',
      'diffEditorOverview.removedForeground': '#d45d6e',
      'diffEditorGutter.insertedLineBackground': '#1d7f4b',
      'diffEditorGutter.removedLineBackground': '#a8324a',
      'editorGutter.addedBackground': '#2ca75f',
      'editorGutter.deletedBackground': '#d45d6e',
      'editorGutter.modifiedBackground': '#5d87c6',
      'input.background': '#111824',
      'list.hoverBackground': '#1a2635',
      'list.activeSelectionBackground': '#21456b',
      'focusBorder': '#3c6fb3',
    },
  })
}

async function buildConsoleSuggestions(
  monacoApi: typeof monaco,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  editorContext: SqlEditorContext,
) {
  const fullSql = model.getValue()
  const cursorOffset = model.getOffsetAt(position)
  if (isInsideQuotedRegion(fullSql, cursorOffset)) {
    return []
  }

  const statement = extractCurrentStatement(fullSql, cursorOffset)
  await ensureReferencedSchemasLoaded(editorContext, statement.before_cursor_text)

  const catalog = buildSqlCatalog(editorContext.schema_catalog)
  const analysis = analyzeSqlStatement(statement.text, catalog, editorContext.database_name)
  const clauseContext = detectClauseContext(statement.before_cursor_text)
  const accessContext = readQualifiedAccess(statement.before_cursor_text)
  const defaultRange = buildWordRange(model, position)

  const expansionSuggestion = buildAliasStarExpansionSuggestion(
    monacoApi,
    model,
    position,
    analysis,
    catalog,
    editorContext,
  )
  if (expansionSuggestion) {
    return [expansionSuggestion]
  }

  if (clauseContext.kind === 'relation') {
    if (accessContext && accessContext.namespaces.length > 0) {
      return buildNamespaceTableSuggestions(
        monacoApi,
        accessContext,
        catalog,
        position,
      )
    }

    return buildRelationSuggestions(
      monacoApi,
      defaultRange,
      analysis,
      catalog,
      editorContext,
    )
  }

  if (accessContext && accessContext.namespaces.length > 0) {
    return buildQualifiedColumnSuggestions(
      monacoApi,
      position,
      accessContext,
      analysis,
      catalog,
      editorContext,
    )
  }

  return buildScopedColumnSuggestions(
    monacoApi,
    defaultRange,
    analysis,
    clauseContext,
  )
}

function buildInlineSuggestions(
  monacoApi: typeof monaco,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  editorContext: SqlEditorContext,
) {
  const columns = editorContext.table_columns.map((column) => toAutocompleteColumn(column))
  const defaultRange = buildWordRange(model, position)

  if (editorContext.mode === 'order_by') {
    return dedupeCompletionItems(
      columns.flatMap((column, index) => [
        createSuggestion(monacoApi, {
          detail: column.data_type,
          documentation: buildColumnMarkdown(column, editorContext.table_name),
          insert_text: column.name,
          kind: monacoApi.languages.CompletionItemKind.Field,
          label: column.name,
          range: defaultRange,
          sort_text: buildSortText(120 - index),
        }),
        createSuggestion(monacoApi, {
          detail: `${column.data_type} · 升序`,
          insert_text: `${quoteSqlIdentifier(column.name)} ASC`,
          kind: monacoApi.languages.CompletionItemKind.Field,
          label: `${column.name} ASC`,
          range: defaultRange,
          sort_text: buildSortText(80 - index),
        }),
        createSuggestion(monacoApi, {
          detail: `${column.data_type} · 降序`,
          insert_text: `${quoteSqlIdentifier(column.name)} DESC`,
          kind: monacoApi.languages.CompletionItemKind.Field,
          label: `${column.name} DESC`,
          range: defaultRange,
          sort_text: buildSortText(79 - index),
        }),
      ]),
    )
  }

  return dedupeCompletionItems([
    ...columns.map((column, index) =>
      createSuggestion(monacoApi, {
        detail: column.data_type,
        documentation: buildColumnMarkdown(column, editorContext.table_name),
        insert_text: column.name,
        kind: monacoApi.languages.CompletionItemKind.Field,
        label: column.name,
        range: defaultRange,
        sort_text: buildSortText(140 - index),
      }),
    ),
    ...['AND', 'OR', 'LIKE', 'IN ()', 'BETWEEN  AND ', 'IS NULL', 'IS NOT NULL'].map(
      (keyword, index) =>
        createSuggestion(monacoApi, {
          insert_text: keyword,
          kind: monacoApi.languages.CompletionItemKind.Keyword,
          label: keyword.replace(/\s+/g, ' ').trim(),
          range: defaultRange,
          sort_text: buildSortText(50 - index),
        }),
    ),
  ])
}

async function buildConsoleHover(
  monacoApi: typeof monaco,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  editorContext: SqlEditorContext,
) {
  const word = model.getWordAtPosition(position)
  if (!word) {
    return null
  }

  const fullSql = model.getValue()
  const cursorOffset = model.getOffsetAt(position)
  const statement = extractCurrentStatement(fullSql, cursorOffset)
  await ensureReferencedSchemasLoaded(editorContext, statement.before_cursor_text)

  const catalog = buildSqlCatalog(editorContext.schema_catalog)
  const analysis = analyzeSqlStatement(statement.text, catalog, editorContext.database_name)
  const wordText = word.word.toLowerCase()

  const tableMatch = [
    ...analysis.ctes,
    ...analysis.relations,
  ].find((relation) => relation.alias?.toLowerCase() === wordText || relation.name.toLowerCase() === wordText)

  if (tableMatch) {
    return {
      contents: [
        {
          value: `**${tableMatch.alias ?? tableMatch.name}**\n\n${buildRelationDetail(tableMatch)}`,
        },
      ],
      range: new monacoApi.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      ),
    }
  }

  const columnMatch = findHoverColumnMatch(word.word, analysis)
  if (!columnMatch) {
    return null
  }

  return {
    contents: [
      {
        value: buildColumnMarkdown(columnMatch.column, columnMatch.scope_label),
      },
    ],
    range: new monacoApi.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    ),
  }
}

function buildInlineHover(
  monacoApi: typeof monaco,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  editorContext: SqlEditorContext,
) {
  const word = model.getWordAtPosition(position)
  if (!word) {
    return null
  }

  const column = editorContext.table_columns.find((item) => item.name === word.word)
  if (!column) {
    return null
  }

  return {
    contents: [
      {
        value: buildColumnMarkdown(toAutocompleteColumn(column), editorContext.table_name),
      },
    ],
    range: new monacoApi.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    ),
  }
}

function buildRelationSuggestions(
  monacoApi: typeof monaco,
  range: monaco.IRange,
  analysis: QueryAnalysis,
  catalog: SqlCatalog,
  editorContext: SqlEditorContext,
) {
  const suggestions: monaco.languages.CompletionItem[] = []

  analysis.ctes.forEach((cte, index) => {
    suggestions.push(
      createSuggestion(monacoApi, {
        detail: `CTE · ${cte.columns.length} 列`,
        documentation: buildRelationMarkdown(cte),
        insert_text: cte.name,
        kind: monacoApi.languages.CompletionItemKind.Class,
        label: cte.name,
        range,
        sort_text: buildSortText(220 - index),
      }),
    )
  })

  if (editorContext.database_name) {
    const currentSchema = catalog.schemas.get(editorContext.database_name.toLowerCase())
    currentSchema?.tables.forEach((table, lowerName) => {
      suggestions.push(
        createSuggestion(monacoApi, {
          detail: `${table.database_name} · ${table.columns.length} 列`,
          documentation: buildTableMarkdown(table),
          insert_text: quoteSqlIdentifier(table.name),
          kind: monacoApi.languages.CompletionItemKind.Class,
          label: table.name,
          range,
          sort_text: buildSortText(180 - suggestions.length),
          filter_text: `${table.name} ${lowerName}`,
        }),
      )
    })
  }

  editorContext.database_names.forEach((databaseName, index) => {
    suggestions.push(
      createSuggestion(monacoApi, {
        detail: '数据库',
        insert_text: `${quoteSqlIdentifier(databaseName)}.`,
        kind: monacoApi.languages.CompletionItemKind.Module,
        label: `${databaseName}.`,
        range,
        sort_text: buildSortText(120 - index),
      }),
    )
  })

  return dedupeCompletionItems(suggestions)
}

function buildNamespaceTableSuggestions(
  monacoApi: typeof monaco,
  accessContext: QualifiedAccess,
  catalog: SqlCatalog,
  position: monaco.Position,
) {
  const range = buildQualifiedRange(position, accessContext.partial)
  const [head] = accessContext.namespaces
  if (!head) {
    return []
  }

  const schema = catalog.schemas.get(head.toLowerCase())
  if (!schema) {
    return []
  }

  return dedupeCompletionItems(
    Array.from(schema.tables.values()).map((table, index) =>
      createSuggestion(monacoApi, {
        detail: `${table.database_name} · ${table.columns.length} 列`,
        documentation: buildTableMarkdown(table),
        insert_text: quoteSqlIdentifier(table.name),
        kind: monacoApi.languages.CompletionItemKind.Class,
        label: table.name,
        range,
        sort_text: buildSortText(180 - index),
      }),
    ),
  )
}

function buildQualifiedColumnSuggestions(
  monacoApi: typeof monaco,
  position: monaco.Position,
  accessContext: QualifiedAccess,
  analysis: QueryAnalysis,
  catalog: SqlCatalog,
  editorContext: SqlEditorContext,
) {
  const range = buildQualifiedRange(position, accessContext.partial)
  const resolution = resolveQualifiedNamespace(
    accessContext.namespaces,
    analysis,
    catalog,
    editorContext.database_name,
  )
  if (!resolution) {
    return []
  }

  const suggestions = resolution.columns.map((column, index) =>
    createSuggestion(monacoApi, {
      detail: `${resolution.scope_label} · ${column.data_type}`,
      documentation: buildColumnMarkdown(column, resolution.scope_label),
      insert_text: quoteSqlIdentifier(column.name),
      kind: monacoApi.languages.CompletionItemKind.Field,
      label: column.name,
      range,
      sort_text: buildSortText(150 - index),
    }),
  )

  if (resolution.expansion_insert_text) {
    suggestions.unshift(
      createSuggestion(monacoApi, {
        detail: '展开全部列',
        insert_text: resolution.expansion_insert_text,
        kind: monacoApi.languages.CompletionItemKind.Snippet,
        label: '*',
        range,
        sort_text: buildSortText(240),
      }),
    )
  }

  return dedupeCompletionItems(suggestions)
}

function buildScopedColumnSuggestions(
  monacoApi: typeof monaco,
  range: monaco.IRange,
  analysis: QueryAnalysis,
  clauseContext: CompletionClauseContext,
) {
  const suggestions: monaco.languages.CompletionItem[] = []
  const scopedColumns = collectScopedColumns(analysis, clauseContext)

  scopedColumns.forEach((item, index) => {
    suggestions.push(
      createSuggestion(monacoApi, {
        detail: `${item.scope_label} · ${item.column.data_type}`,
        documentation: buildColumnMarkdown(item.column, item.scope_label),
        insert_text: quoteSqlIdentifier(item.column.name),
        kind: monacoApi.languages.CompletionItemKind.Field,
        label: item.column.name,
        range,
        sort_text: buildSortText(180 - index + item.boost),
      }),
    )

    if (item.qualified_insert_text) {
      suggestions.push(
        createSuggestion(monacoApi, {
          detail: `${item.scope_label} · ${item.column.data_type}`,
          documentation: buildColumnMarkdown(item.column, item.scope_label),
          insert_text: item.qualified_insert_text,
          kind: monacoApi.languages.CompletionItemKind.Field,
          label: item.qualified_label,
          range,
          sort_text: buildSortText(130 - index + item.boost),
        }),
      )
    }
  })

  monacoKeywordTemplates.forEach((keyword, index) => {
    suggestions.push(
      createSuggestion(monacoApi, {
        insert_text: keyword,
        kind: monacoApi.languages.CompletionItemKind.Keyword,
        label: keyword,
        range,
        sort_text: buildSortText(40 - index),
      }),
    )
  })

  return dedupeCompletionItems(suggestions)
}

function buildAliasStarExpansionSuggestion(
  monacoApi: typeof monaco,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  analysis: QueryAnalysis,
  catalog: SqlCatalog,
  editorContext: SqlEditorContext,
) {
  const linePrefix = model
    .getLineContent(position.lineNumber)
    .slice(0, position.column - 1)
  const starMatch = linePrefix.match(
    /((?:`[^`]+`|[A-Za-z_][\w$]*)(?:\.(?:`[^`]+`|[A-Za-z_][\w$]*))*)\.\*$/,
  )
  if (!starMatch?.[1]) {
    return null
  }

  const namespaces = starMatch[1]
    .split('.')
    .map((item) => unquoteSqlIdentifier(item))
    .filter(Boolean)
  const resolution = resolveQualifiedNamespace(
    namespaces,
    analysis,
    catalog,
    editorContext.database_name,
  )
  if (!resolution || !resolution.expansion_insert_text) {
    return null
  }

  return createSuggestion(monacoApi, {
    detail: `展开 ${resolution.columns.length} 列`,
    insert_text: resolution.expansion_insert_text,
    kind: monacoApi.languages.CompletionItemKind.Snippet,
    label: `${starMatch[1]}.*`,
    range: new monacoApi.Range(
      position.lineNumber,
      position.column,
      position.lineNumber,
      position.column,
    ),
    sort_text: buildSortText(260),
  })
}

function collectScopedColumns(
  analysis: QueryAnalysis,
  clauseContext: CompletionClauseContext,
) {
  const suggestions: Array<{
    boost: number
    column: SqlAutocompleteColumn
    qualified_insert_text: string | null
    qualified_label: string
    scope_label: string
  }> = []

  const relations = analysis.relations.length > 0 ? analysis.relations : analysis.ctes
  const onFocusedRelations =
    clauseContext.kind === 'join_on' ? relations.slice(-2) : relations
  const expectedColumnName =
    clauseContext.kind === 'join_on' ? clauseContext.expected_column_name : null
  const includeQualifiedSuggestions =
    relations.length > 1 || clauseContext.kind === 'join_on'
  const bareColumnCounts = new Map<string, number>()

  relations.forEach((relation) => {
    relation.columns.forEach((column) => {
      const key = column.name.toLowerCase()
      bareColumnCounts.set(key, (bareColumnCounts.get(key) ?? 0) + 1)
    })
  })

  relations.forEach((relation, relationIndex) => {
    const relationBoost = onFocusedRelations.includes(relation) ? 28 : 0

    relation.columns.forEach((column) => {
      const exactBoost =
        expectedColumnName && column.name.toLowerCase() === expectedColumnName.toLowerCase()
          ? 36
          : 0
      const bareKey = column.name.toLowerCase()
      const scopeLabel = relation.alias
        ? `${relation.alias} · ${relation.name}`
        : relation.database_name
          ? `${relation.database_name}.${relation.name}`
          : relation.name
      const qualifiedBase = relation.alias ?? relation.name
      const qualifiedLabel = `${qualifiedBase}.${column.name}`

      if ((bareColumnCounts.get(bareKey) ?? 0) === 1) {
        suggestions.push({
          boost: relationBoost + exactBoost,
          column,
          qualified_insert_text: null,
          qualified_label: qualifiedLabel,
          scope_label: scopeLabel,
        })
      }

      if (includeQualifiedSuggestions) {
        suggestions.push({
          boost: relationBoost + exactBoost - relationIndex,
          column,
          qualified_insert_text: `${quoteSqlIdentifier(qualifiedBase)}.${quoteSqlIdentifier(column.name)}`,
          qualified_label: qualifiedLabel,
          scope_label: scopeLabel,
        })
      }
    })
  })

  return suggestions.sort((left, right) => right.boost - left.boost)
}

function findHoverColumnMatch(word: string, analysis: QueryAnalysis) {
  const lowered = word.toLowerCase()
  for (const relation of [...analysis.relations, ...analysis.ctes]) {
    const column = relation.columns.find((item) => item.name.toLowerCase() === lowered)
    if (column) {
      return {
        column,
        scope_label: relation.alias
          ? `${relation.alias} · ${relation.name}`
          : relation.database_name
            ? `${relation.database_name}.${relation.name}`
            : relation.name,
      }
    }
  }

  return null
}

function buildColumnMarkdown(column: SqlAutocompleteColumn, scopeLabel: string) {
  const tags = [column.data_type]
  if (column.primary_key) {
    tags.push('主键')
  }
  if (column.auto_increment) {
    tags.push('自增')
  }
  tags.push(column.nullable ? '可空' : '非空')

  const comment = column.comment ? `\n\n${column.comment}` : ''
  return `**${scopeLabel}.${column.name}**\n\n${tags.join(' · ')}${comment}`
}

function buildRelationMarkdown(relation: QueryRelation) {
  const scope = relation.database_name ? `${relation.database_name}.${relation.name}` : relation.name
  return `**${scope}**\n\n${relation.columns.length} 列`
}

function buildTableMarkdown(table: CatalogTable) {
  return `**${table.database_name}.${table.name}**\n\n${table.columns.length} 列`
}

function buildRelationDetail(relation: QueryRelation) {
  const scope = relation.database_name ? `${relation.database_name}.${relation.name}` : relation.name
  return `${scope}\n\n${relation.columns.length} 列`
}

function createSuggestion(
  monacoApi: typeof monaco,
  input: {
    detail?: string
    documentation?: string
    filter_text?: string
    insert_text: string
    kind: monaco.languages.CompletionItemKind
    label: string
    range: monaco.IRange
    sort_text: string
  },
) {
  return {
    detail: input.detail,
    documentation: input.documentation
      ? {
          isTrusted: false,
          value: input.documentation,
        }
      : undefined,
    filterText: input.filter_text,
    insertText: input.insert_text,
    insertTextRules: monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    kind: input.kind,
    label: input.label,
    range: input.range,
    sortText: input.sort_text,
  }
}

function dedupeCompletionItems(items: monaco.languages.CompletionItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const insertText =
      typeof item.insertText === 'string' ? item.insertText : JSON.stringify(item.insertText)
    const key = `${String(item.label)}::${insertText}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function buildSortText(priority: number) {
  return String(1000 - priority).padStart(4, '0')
}

function buildWordRange(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
) {
  const word = model.getWordUntilPosition(position)
  return new monaco.Range(
    position.lineNumber,
    word.startColumn,
    position.lineNumber,
    word.endColumn,
  )
}

function buildQualifiedRange(
  position: monaco.Position,
  partial: string,
) {
  return new monaco.Range(
    position.lineNumber,
    position.column - partial.length,
    position.lineNumber,
    position.column,
  )
}

function buildModelPath(editorId: string, mode: SqlEditorMode) {
  return `inmemory://zszc-sql-editor/${mode}/${encodeURIComponent(editorId)}.sql`
}

function buildDiffModelPath(
  editorId: string,
  side: 'original' | 'modified',
) {
  return `inmemory://zszc-sql-diff/${side}/${encodeURIComponent(editorId)}.sql`
}

function dedupeSchemaCatalog(items: SqlAutocompleteSchema[]) {
  const grouped = new Map<string, SqlAutocompleteSchema>()
  items.forEach((item) => {
    grouped.set(item.database_name, item)
  })
  return Array.from(grouped.values()).sort((left, right) =>
    left.database_name.localeCompare(right.database_name, 'zh-CN'),
  )
}

async function ensureReferencedSchemasLoaded(
  editorContext: SqlEditorContext,
  sqlBeforeCursor: string,
) {
  if (!editorContext.onResolveSchema || editorContext.database_names.length === 0) {
    return
  }

  const knownSchemas = new Set(
    editorContext.schema_catalog.map((schema) => schema.database_name.toLowerCase()),
  )
  const availableDatabases = new Map(
    editorContext.database_names.map((name) => [name.toLowerCase(), name]),
  )
  const referencedSchemas = Array.from(
    new Set(
      extractReferencedDatabaseNames(sqlBeforeCursor)
        .map((name) => availableDatabases.get(name.toLowerCase()) ?? null)
        .filter((name): name is string => Boolean(name))
        .filter((name) => !knownSchemas.has(name.toLowerCase())),
    ),
  )

  if (referencedSchemas.length === 0) {
    return
  }

  const loadedSchemas = await Promise.all(
    referencedSchemas.map((databaseName) => editorContext.onResolveSchema?.(databaseName)),
  )
  loadedSchemas.forEach((schema) => {
    if (!schema) {
      return
    }
    editorContext.schema_catalog = dedupeSchemaCatalog([
      ...editorContext.schema_catalog,
      schema,
    ])
  })
}

function extractReferencedDatabaseNames(sqlText: string) {
  const names = new Set<string>()
  const matches = sqlText.matchAll(
    /(?:`([^`]+)`|([A-Za-z_][\w$]*))\s*\.\s*(?:(?:`[^`]+`|[A-Za-z_][\w$]*|\*)?)/g,
  )

  for (const match of matches) {
    const databaseName = match[1] ?? match[2]
    if (databaseName) {
      names.add(databaseName)
    }
  }

  return Array.from(names)
}

function buildSqlCatalog(schemaCatalog: SqlAutocompleteSchema[]): SqlCatalog {
  const schemas = new Map<string, CatalogSchema>()

  schemaCatalog.forEach((schema) => {
    schemas.set(schema.database_name.toLowerCase(), {
      database_name: schema.database_name,
      tables: new Map(
        schema.tables.map((table) => [
          table.name.toLowerCase(),
          {
            database_name: schema.database_name,
            name: table.name,
            columns: table.columns,
          },
        ]),
      ),
    })
  })

  return { schemas }
}

function analyzeSqlStatement(
  sqlText: string,
  catalog: SqlCatalog,
  currentDatabaseName: string | null,
  depth = 0,
): QueryAnalysis {
  return analyzeSqlTokens(tokenizeSql(sqlText), catalog, currentDatabaseName, depth)
}

function analyzeSqlTokens(
  tokens: SqlToken[],
  catalog: SqlCatalog,
  currentDatabaseName: string | null,
  depth = 0,
): QueryAnalysis {
  if (depth > 4 || tokens.length === 0) {
    return {
      ctes: [],
      relations: [],
      projection_columns: [],
    }
  }

  const { ctes, next_index } = parseCtes(tokens, catalog, currentDatabaseName, depth)
  const cteMap = new Map(ctes.map((cte) => [cte.name.toLowerCase(), cte]))
  const relations = parseRelations(tokens, next_index, catalog, currentDatabaseName, cteMap, depth)
  const projection_columns = parseProjectionColumns(
    tokens,
    next_index,
    relations,
  )

  return {
    ctes,
    relations,
    projection_columns,
  }
}

function parseCtes(
  tokens: SqlToken[],
  catalog: SqlCatalog,
  currentDatabaseName: string | null,
  depth: number,
) {
  if (tokens[0]?.normalized !== 'with') {
    return { ctes: [] as QueryRelation[], next_index: 0 }
  }

  const ctes: QueryRelation[] = []
  let index = 1
  if (tokens[index]?.normalized === 'recursive') {
    index += 1
  }

  while (index < tokens.length) {
    const nameToken = tokens[index]
    if (!isIdentifierToken(nameToken)) {
      break
    }

    const cteName = unquoteSqlIdentifier(nameToken.text)
    index += 1

    let explicitColumns: SqlAutocompleteColumn[] = []
    if (tokens[index]?.text === '(') {
      const parsedColumns = readIdentifierList(tokens, index)
      explicitColumns = parsedColumns.identifiers.map((name) =>
        createDerivedColumn(name, 'cte'),
      )
      index = parsedColumns.next_index
    }

    if (tokens[index]?.normalized !== 'as' || tokens[index + 1]?.text !== '(') {
      break
    }

    const subquery = readParenthesizedTokens(tokens, index + 1)
    const subqueryAnalysis = analyzeSqlTokens(
      subquery.inner_tokens,
      catalog,
      currentDatabaseName,
      depth + 1,
    )

    ctes.push({
      source_kind: 'cte',
      name: cteName,
      database_name: null,
      alias: null,
      columns:
        explicitColumns.length > 0
          ? explicitColumns
          : subqueryAnalysis.projection_columns,
    })

    index = subquery.next_index
    if (tokens[index]?.text === ',') {
      index += 1
      continue
    }
    break
  }

  return { ctes, next_index: index }
}

function parseRelations(
  tokens: SqlToken[],
  startIndex: number,
  catalog: SqlCatalog,
  currentDatabaseName: string | null,
  cteMap: Map<string, QueryRelation>,
  depth: number,
) {
  const relations: QueryRelation[] = []
  let index = startIndex
  let nesting = 0

  while (index < tokens.length) {
    const token = tokens[index]

    if (token.text === '(') {
      nesting += 1
      index += 1
      continue
    }
    if (token.text === ')') {
      nesting = Math.max(0, nesting - 1)
      index += 1
      continue
    }

    if (nesting === 0 && (token.normalized === 'from' || token.normalized === 'join')) {
      index += 1
      while (index < tokens.length) {
        const parsedRelation = readRelation(
          tokens,
          index,
          catalog,
          currentDatabaseName,
          cteMap,
          depth,
        )
        if (!parsedRelation) {
          break
        }

        relations.push(parsedRelation.relation)
        index = parsedRelation.next_index

        if (tokens[index]?.text === ',') {
          index += 1
          continue
        }
        break
      }
      continue
    }

    if (nesting === 0 && joinStopKeywords.has(token.normalized)) {
      break
    }

    index += 1
  }

  return relations
}

function readRelation(
  tokens: SqlToken[],
  startIndex: number,
  catalog: SqlCatalog,
  currentDatabaseName: string | null,
  cteMap: Map<string, QueryRelation>,
  depth: number,
) {
  const token = tokens[startIndex]
  if (!token) {
    return null
  }

  if (token.text === '(') {
    const subquery = readParenthesizedTokens(tokens, startIndex)
    const alias = readAliasToken(tokens, subquery.next_index)
    const subqueryAnalysis = analyzeSqlTokens(
      subquery.inner_tokens,
      catalog,
      currentDatabaseName,
      depth + 1,
    )

    return {
      relation: {
        source_kind: 'subquery' as const,
        name: alias?.name ?? 'subquery',
        database_name: null,
        alias: alias?.name ?? null,
        columns: subqueryAnalysis.projection_columns,
      },
      next_index: alias?.next_index ?? subquery.next_index,
    }
  }

  const path = readQualifiedIdentifier(tokens, startIndex)
  if (!path || path.identifiers.length === 0) {
    return null
  }

  const alias = readAliasToken(tokens, path.next_index)
  const relation = resolveRelationFromPath(
    path.identifiers,
    alias?.name ?? null,
    catalog,
    currentDatabaseName,
    cteMap,
  )
  if (!relation) {
    return null
  }

  return {
    relation,
    next_index: alias?.next_index ?? path.next_index,
  }
}

function parseProjectionColumns(
  tokens: SqlToken[],
  startIndex: number,
  relations: QueryRelation[],
) {
  let selectIndex = -1
  let nesting = 0

  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.text === '(') {
      nesting += 1
      continue
    }
    if (token.text === ')') {
      nesting = Math.max(0, nesting - 1)
      continue
    }

    if (nesting === 0 && token.normalized === 'select') {
      selectIndex = index
      break
    }
  }

  if (selectIndex < 0) {
    return []
  }

  let endIndex = tokens.length
  nesting = 0
  for (let index = selectIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.text === '(') {
      nesting += 1
      continue
    }
    if (token.text === ')') {
      nesting = Math.max(0, nesting - 1)
      continue
    }
    if (nesting === 0 && token.normalized === 'from') {
      endIndex = index
      break
    }
  }

  const relationMap = new Map<string, QueryRelation>()
  relations.forEach((relation) => {
    relationMap.set(relation.name.toLowerCase(), relation)
    if (relation.alias) {
      relationMap.set(relation.alias.toLowerCase(), relation)
    }
  })

  const columnMap = new Map<string, SqlAutocompleteColumn>()
  const selectItems = splitTopLevelTokens(tokens.slice(selectIndex + 1, endIndex), ',')

  selectItems.forEach((itemTokens) => {
    if (itemTokens.length === 0) {
      return
    }

    const explicitAlias = readProjectionAlias(itemTokens)
    const wildcard = readWildcardProjection(itemTokens, relationMap)
    if (wildcard.length > 0) {
      wildcard.forEach((column) => {
        if (!columnMap.has(column.name.toLowerCase())) {
          columnMap.set(column.name.toLowerCase(), column)
        }
      })
      return
    }

    const inferredColumn =
      resolveProjectionColumn(itemTokens, relationMap) ??
      (explicitAlias ? createDerivedColumn(explicitAlias, 'projection') : null) ??
      inferProjectionColumn(itemTokens)

    if (inferredColumn) {
      columnMap.set(inferredColumn.name.toLowerCase(), {
        ...inferredColumn,
        name: explicitAlias ?? inferredColumn.name,
      })
    }
  })

  return Array.from(columnMap.values())
}

function resolveProjectionColumn(
  itemTokens: SqlToken[],
  relationMap: Map<string, QueryRelation>,
) {
  const path = readQualifiedIdentifier(itemTokens, 0)
  if (!path || path.next_index !== itemTokens.length) {
    return null
  }

  if (path.identifiers.length === 1) {
    const columnName = path.identifiers[0]
    for (const relation of relationMap.values()) {
      const column = relation.columns.find((item) => item.name === columnName)
      if (column) {
        return column
      }
    }
    return null
  }

  const [scopeName, columnName] = path.identifiers.slice(-2)
  const relation = relationMap.get(scopeName.toLowerCase())
  return relation?.columns.find((item) => item.name === columnName) ?? null
}

function inferProjectionColumn(itemTokens: SqlToken[]) {
  const alias = readProjectionAlias(itemTokens)
  if (alias) {
    return createDerivedColumn(alias, 'projection')
  }

  const lastIdentifier = [...itemTokens]
    .reverse()
    .find((token) => isIdentifierToken(token))
  return lastIdentifier
    ? createDerivedColumn(unquoteSqlIdentifier(lastIdentifier.text), 'projection')
    : null
}

function readProjectionAlias(itemTokens: SqlToken[]) {
  for (let index = itemTokens.length - 1; index >= 0; index -= 1) {
    const token = itemTokens[index]
    if (token.normalized === 'as' && isIdentifierToken(itemTokens[index + 1])) {
      return unquoteSqlIdentifier(itemTokens[index + 1].text)
    }
  }

  const lastToken = itemTokens[itemTokens.length - 1]
  const previousToken = itemTokens[itemTokens.length - 2]
  if (
    isIdentifierToken(lastToken) &&
    previousToken &&
    previousToken.text !== '.' &&
    previousToken.normalized !== 'as'
  ) {
    return unquoteSqlIdentifier(lastToken.text)
  }

  return null
}

function readWildcardProjection(
  itemTokens: SqlToken[],
  relationMap: Map<string, QueryRelation>,
) {
  if (itemTokens.length === 1 && itemTokens[0]?.text === '*') {
    return Array.from(relationMap.values()).flatMap((relation) => relation.columns)
  }

  const path = readQualifiedIdentifier(itemTokens, 0)
  if (!path || itemTokens[path.next_index]?.text !== '.' || itemTokens[path.next_index + 1]?.text !== '*') {
    return []
  }

  const relationName = path.identifiers.at(-1)
  if (!relationName) {
    return []
  }

  return relationMap.get(relationName.toLowerCase())?.columns ?? []
}

function resolveRelationFromPath(
  identifiers: string[],
  alias: string | null,
  catalog: SqlCatalog,
  currentDatabaseName: string | null,
  cteMap: Map<string, QueryRelation>,
) {
  if (identifiers.length === 1) {
    const cteRelation = cteMap.get(identifiers[0].toLowerCase())
    if (cteRelation) {
      return {
        ...cteRelation,
        alias,
      }
    }
  }

  const catalogTable = resolveCatalogTable(identifiers, catalog, currentDatabaseName)
  if (!catalogTable) {
    return null
  }

  return {
    source_kind: 'table' as const,
    name: catalogTable.name,
    database_name: catalogTable.database_name,
    alias,
    columns: catalogTable.columns,
  }
}

function resolveCatalogTable(
  identifiers: string[],
  catalog: SqlCatalog,
  currentDatabaseName: string | null,
) {
  if (identifiers.length === 0) {
    return null
  }

  if (identifiers.length === 1) {
    if (!currentDatabaseName) {
      return null
    }
    return (
      catalog.schemas.get(currentDatabaseName.toLowerCase())?.tables.get(identifiers[0].toLowerCase()) ??
      null
    )
  }

  const databaseName = identifiers[identifiers.length - 2]
  const tableName = identifiers[identifiers.length - 1]
  return catalog.schemas.get(databaseName.toLowerCase())?.tables.get(tableName.toLowerCase()) ?? null
}

function resolveQualifiedNamespace(
  namespaces: string[],
  analysis: QueryAnalysis,
  catalog: SqlCatalog,
  currentDatabaseName: string | null,
) {
  if (namespaces.length === 0) {
    return null
  }

  const relationLookup = new Map<string, QueryRelation>()
  ;[...analysis.relations, ...analysis.ctes].forEach((relation) => {
    relationLookup.set(relation.name.toLowerCase(), relation)
    if (relation.alias) {
      relationLookup.set(relation.alias.toLowerCase(), relation)
    }
  })

  if (namespaces.length === 1) {
    const relation = relationLookup.get(namespaces[0].toLowerCase())
    if (relation) {
      const qualifier = relation.alias ?? relation.name
      return {
        columns: relation.columns,
        expansion_insert_text: relation.columns
          .map((column) => `${quoteSqlIdentifier(qualifier)}.${quoteSqlIdentifier(column.name)}`)
          .join(', '),
        scope_label: relation.alias
          ? `${relation.alias} · ${relation.name}`
          : relation.database_name
            ? `${relation.database_name}.${relation.name}`
            : relation.name,
      }
    }

    const table = resolveCatalogTable(namespaces, catalog, currentDatabaseName)
    if (table) {
      return {
        columns: table.columns,
        expansion_insert_text: table.columns
          .map((column) => `${quoteSqlIdentifier(table.name)}.${quoteSqlIdentifier(column.name)}`)
          .join(', '),
        scope_label: `${table.database_name}.${table.name}`,
      }
    }
  }

  const table = resolveCatalogTable(namespaces, catalog, currentDatabaseName)
  if (!table) {
    return null
  }

  return {
    columns: table.columns,
    expansion_insert_text: table.columns
      .map((column) => `${quoteSqlIdentifier(table.name)}.${quoteSqlIdentifier(column.name)}`)
      .join(', '),
    scope_label: `${table.database_name}.${table.name}`,
  }
}

function detectClauseContext(sqlBeforeCursor: string): CompletionClauseContext {
  const normalized = sqlBeforeCursor.toLowerCase()

  if (
    /\b(from|join|update|into)\s+((?:`[^`]+`|[a-z_][\w$]*)(?:\.(?:`[^`]+`|[a-z_][\w$]*))*(?:\.)?)?$/.test(
      normalized,
    )
  ) {
    return { kind: 'relation' }
  }

  const onClause = normalized.match(
    /\bon\b[\s\S]*?((?:`[^`]+`|[a-z_][\w$]*)(?:\.(?:`[^`]+`|[a-z_][\w$]*))?)?\s*=\s*$/,
  )
  if (onClause) {
    return {
      kind: 'join_on',
      expected_column_name: onClause[1]?.split('.').at(-1)?.replaceAll('`', '') ?? null,
    }
  }

  if (/\bon\b[\s\S]*$/.test(normalized)) {
    return {
      kind: 'join_on',
      expected_column_name: null,
    }
  }

  return { kind: 'column' }
}

function readQualifiedAccess(sqlBeforeCursor: string): QualifiedAccess | null {
  const match = sqlBeforeCursor.match(
    /((?:`[^`]+`|[A-Za-z_][\w$]*)(?:\.(?:`[^`]+`|[A-Za-z_][\w$]*))*)\.(?:([A-Za-z_][\w$]*)?)$/,
  )
  if (!match?.[1]) {
    return null
  }

  return {
    namespaces: match[1]
      .split('.')
      .map((item) => unquoteSqlIdentifier(item))
      .filter(Boolean),
    partial: match[2] ?? '',
  }
}

function extractCurrentStatement(sqlText: string, cursorOffset: number) {
  let start = 0
  let end = sqlText.length
  let nesting = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false

  for (let index = 0; index < sqlText.length; index += 1) {
    const currentChar = sqlText[index]
    const nextChar = sqlText[index + 1] ?? ''

    if (inLineComment) {
      if (currentChar === '\n') {
        inLineComment = false
      }
      continue
    }

    if (inBlockComment) {
      if (currentChar === '*' && nextChar === '/') {
        inBlockComment = false
        index += 1
      }
      continue
    }

    if (inSingleQuote) {
      if (currentChar === "'" && nextChar === "'") {
        index += 1
        continue
      }
      if (currentChar === "'") {
        inSingleQuote = false
      }
      continue
    }

    if (inDoubleQuote) {
      if (currentChar === '"' && nextChar === '"') {
        index += 1
        continue
      }
      if (currentChar === '"') {
        inDoubleQuote = false
      }
      continue
    }

    if (inBacktick) {
      if (currentChar === '`' && nextChar === '`') {
        index += 1
        continue
      }
      if (currentChar === '`') {
        inBacktick = false
      }
      continue
    }

    if (currentChar === '-' && nextChar === '-') {
      inLineComment = true
      index += 1
      continue
    }
    if (currentChar === '#') {
      inLineComment = true
      continue
    }
    if (currentChar === '/' && nextChar === '*') {
      inBlockComment = true
      index += 1
      continue
    }
    if (currentChar === "'") {
      inSingleQuote = true
      continue
    }
    if (currentChar === '"') {
      inDoubleQuote = true
      continue
    }
    if (currentChar === '`') {
      inBacktick = true
      continue
    }
    if (currentChar === '(') {
      nesting += 1
      continue
    }
    if (currentChar === ')') {
      nesting = Math.max(0, nesting - 1)
      continue
    }
    if (currentChar === ';' && nesting === 0) {
      if (index < cursorOffset) {
        start = index + 1
      } else {
        end = index
        break
      }
    }
  }

  const text = sqlText.slice(start, end)
  const statementCursorOffset = Math.max(0, cursorOffset - start)
  return {
    before_cursor_text: text.slice(0, statementCursorOffset),
    cursor_offset: statementCursorOffset,
    text,
  }
}

function tokenizeSql(sqlText: string) {
  const tokens: SqlToken[] = []
  let index = 0

  while (index < sqlText.length) {
    const currentChar = sqlText[index]
    const nextChar = sqlText[index + 1] ?? ''

    if (/\s/.test(currentChar)) {
      index += 1
      continue
    }

    if (currentChar === '-' && nextChar === '-') {
      index = readUntilLineEnd(sqlText, index + 2)
      continue
    }
    if (currentChar === '#') {
      index = readUntilLineEnd(sqlText, index + 1)
      continue
    }
    if (currentChar === '/' && nextChar === '*') {
      index = readUntilBlockCommentEnd(sqlText, index + 2)
      continue
    }

    if (currentChar === "'") {
      const endIndex = readQuoted(sqlText, index, "'", true)
      tokens.push({
        type: 'string',
        text: sqlText.slice(index, endIndex),
        normalized: sqlText.slice(index, endIndex),
      })
      index = endIndex
      continue
    }

    if (currentChar === '`') {
      const endIndex = readQuoted(sqlText, index, '`', true)
      const text = sqlText.slice(index, endIndex)
      tokens.push({
        type: 'identifier',
        text,
        normalized: unquoteSqlIdentifier(text).toLowerCase(),
      })
      index = endIndex
      continue
    }

    if (currentChar === '"') {
      const endIndex = readQuoted(sqlText, index, '"', true)
      const text = sqlText.slice(index, endIndex)
      tokens.push({
        type: 'identifier',
        text,
        normalized: unquoteSqlIdentifier(text).toLowerCase(),
      })
      index = endIndex
      continue
    }

    if (currentChar === '[') {
      const endIndex = sqlText.indexOf(']', index + 1)
      const safeEndIndex = endIndex >= 0 ? endIndex + 1 : sqlText.length
      const text = sqlText.slice(index, safeEndIndex)
      tokens.push({
        type: 'identifier',
        text,
        normalized: unquoteSqlIdentifier(text).toLowerCase(),
      })
      index = safeEndIndex
      continue
    }

    if (/[A-Za-z_]/.test(currentChar)) {
      let endIndex = index + 1
      while (endIndex < sqlText.length && /[A-Za-z0-9_$]/.test(sqlText[endIndex] ?? '')) {
        endIndex += 1
      }
      const text = sqlText.slice(index, endIndex)
      tokens.push({
        type: 'word',
        text,
        normalized: text.toLowerCase(),
      })
      index = endIndex
      continue
    }

    if (/\d/.test(currentChar)) {
      let endIndex = index + 1
      while (endIndex < sqlText.length && /[\d.]/.test(sqlText[endIndex] ?? '')) {
        endIndex += 1
      }
      const text = sqlText.slice(index, endIndex)
      tokens.push({
        type: 'number',
        text,
        normalized: text,
      })
      index = endIndex
      continue
    }

    if ('(),.*;'.includes(currentChar)) {
      tokens.push({
        type: 'punctuation',
        text: currentChar,
        normalized: currentChar,
      })
      index += 1
      continue
    }

    tokens.push({
      type: 'operator',
      text: currentChar,
      normalized: currentChar,
    })
    index += 1
  }

  return tokens
}

function readIdentifierList(tokens: SqlToken[], startIndex: number) {
  const identifiers: string[] = []
  let index = startIndex + 1
  let nesting = 1

  while (index < tokens.length && nesting > 0) {
    const token = tokens[index]
    if (token.text === '(') {
      nesting += 1
      index += 1
      continue
    }
    if (token.text === ')') {
      nesting -= 1
      index += 1
      if (nesting === 0) {
        break
      }
      continue
    }
    if (nesting === 1 && isIdentifierToken(token)) {
      identifiers.push(unquoteSqlIdentifier(token.text))
    }
    index += 1
  }

  return { identifiers, next_index: index }
}

function readParenthesizedTokens(tokens: SqlToken[], startIndex: number) {
  const inner_tokens: SqlToken[] = []
  let index = startIndex
  let nesting = 0

  while (index < tokens.length) {
    const token = tokens[index]
    if (token.text === '(') {
      nesting += 1
      if (nesting > 1) {
        inner_tokens.push(token)
      }
      index += 1
      continue
    }
    if (token.text === ')') {
      nesting -= 1
      if (nesting === 0) {
        index += 1
        break
      }
      inner_tokens.push(token)
      index += 1
      continue
    }
    inner_tokens.push(token)
    index += 1
  }

  return {
    inner_tokens,
    next_index: index,
  }
}

function readAliasToken(tokens: SqlToken[], startIndex: number) {
  if (tokens[startIndex]?.normalized === 'as' && isIdentifierToken(tokens[startIndex + 1])) {
    return {
      name: unquoteSqlIdentifier(tokens[startIndex + 1].text),
      next_index: startIndex + 2,
    }
  }

  if (isIdentifierToken(tokens[startIndex])) {
    const alias = unquoteSqlIdentifier(tokens[startIndex].text)
    if (!aliasStopKeywords.has(alias.toLowerCase())) {
      return {
        name: alias,
        next_index: startIndex + 1,
      }
    }
  }

  return null
}

function readQualifiedIdentifier(tokens: SqlToken[], startIndex: number) {
  if (!isIdentifierToken(tokens[startIndex])) {
    return null
  }

  const identifiers = [unquoteSqlIdentifier(tokens[startIndex].text)]
  let index = startIndex + 1
  while (tokens[index]?.text === '.' && isIdentifierToken(tokens[index + 1])) {
    identifiers.push(unquoteSqlIdentifier(tokens[index + 1].text))
    index += 2
  }

  return {
    identifiers,
    next_index: index,
  }
}

function splitTopLevelTokens(tokens: SqlToken[], delimiter: string) {
  const groups: SqlToken[][] = []
  let currentGroup: SqlToken[] = []
  let nesting = 0

  tokens.forEach((token) => {
    if (token.text === '(') {
      nesting += 1
      currentGroup.push(token)
      return
    }
    if (token.text === ')') {
      nesting = Math.max(0, nesting - 1)
      currentGroup.push(token)
      return
    }
    if (nesting === 0 && token.text === delimiter) {
      groups.push(currentGroup)
      currentGroup = []
      return
    }
    currentGroup.push(token)
  })

  groups.push(currentGroup)
  return groups
}

function toAutocompleteColumn(column: TableDataColumn): SqlAutocompleteColumn {
  return {
    name: column.name,
    data_type: column.data_type,
    nullable: column.nullable,
    primary_key: column.primary_key,
    auto_increment: column.auto_increment,
    comment: column.comment,
  }
}

function createDerivedColumn(name: string, dataType: string): SqlAutocompleteColumn {
  return {
    name,
    data_type: dataType,
    nullable: true,
    primary_key: false,
    auto_increment: false,
    comment: '',
  }
}

function isIdentifierToken(token: SqlToken | undefined) {
  return token?.type === 'identifier' || token?.type === 'word'
}

function unquoteSqlIdentifier(value: string) {
  return value
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/^"|"$/g, '')
    .replace(/^\[|\]$/g, '')
}

function quoteSqlIdentifier(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)
    ? name
    : `\`${name.replaceAll('`', '``')}\``
}

function readUntilLineEnd(sqlText: string, startIndex: number) {
  let index = startIndex
  while (index < sqlText.length && sqlText[index] !== '\n') {
    index += 1
  }
  return index
}

function readUntilBlockCommentEnd(sqlText: string, startIndex: number) {
  let index = startIndex
  while (index < sqlText.length) {
    if (sqlText[index] === '*' && sqlText[index + 1] === '/') {
      return index + 2
    }
    index += 1
  }
  return sqlText.length
}

function readQuoted(
  sqlText: string,
  startIndex: number,
  quoteChar: string,
  supportsDoubleEscape: boolean,
) {
  let index = startIndex + 1
  while (index < sqlText.length) {
    if (
      supportsDoubleEscape &&
      sqlText[index] === quoteChar &&
      sqlText[index + 1] === quoteChar
    ) {
      index += 2
      continue
    }
    if (sqlText[index] === quoteChar) {
      return index + 1
    }
    index += 1
  }
  return sqlText.length
}

function isInsideQuotedRegion(sqlText: string, cursorOffset: number) {
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false

  for (let index = 0; index < cursorOffset; index += 1) {
    const currentChar = sqlText[index]
    const nextChar = sqlText[index + 1] ?? ''

    if (inLineComment) {
      if (currentChar === '\n') {
        inLineComment = false
      }
      continue
    }
    if (inBlockComment) {
      if (currentChar === '*' && nextChar === '/') {
        inBlockComment = false
        index += 1
      }
      continue
    }
    if (inSingleQuote) {
      if (currentChar === "'" && nextChar === "'") {
        index += 1
        continue
      }
      if (currentChar === "'") {
        inSingleQuote = false
      }
      continue
    }
    if (inDoubleQuote) {
      if (currentChar === '"' && nextChar === '"') {
        index += 1
        continue
      }
      if (currentChar === '"') {
        inDoubleQuote = false
      }
      continue
    }
    if (inBacktick) {
      if (currentChar === '`' && nextChar === '`') {
        index += 1
        continue
      }
      if (currentChar === '`') {
        inBacktick = false
      }
      continue
    }

    if (currentChar === '-' && nextChar === '-') {
      inLineComment = true
      index += 1
      continue
    }
    if (currentChar === '#') {
      inLineComment = true
      continue
    }
    if (currentChar === '/' && nextChar === '*') {
      inBlockComment = true
      index += 1
      continue
    }
    if (currentChar === "'") {
      inSingleQuote = true
      continue
    }
    if (currentChar === '"') {
      inDoubleQuote = true
      continue
    }
    if (currentChar === '`') {
      inBacktick = true
    }
  }

  return (
    inSingleQuote ||
    inDoubleQuote ||
    inBacktick ||
    inLineComment ||
    inBlockComment
  )
}

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules\/react(?:-dom)?(?:\/|$)/,
            },
            {
              name: 'monaco-react',
              test: /node_modules\/@monaco-editor\/react(?:\/|$)/,
            },
            {
              name: 'monaco-base-browser',
              test: /node_modules\/monaco-editor\/esm\/vs\/base\/browser(?:\/|$)/,
            },
            {
              name: 'monaco-base-common',
              test: /node_modules\/monaco-editor\/esm\/vs\/base\/common(?:\/|$)/,
            },
            {
              name: 'monaco-base',
              test: /node_modules\/monaco-editor\/esm\/vs\/base(?:\/|$)/,
            },
            {
              name: 'monaco-platform',
              test: /node_modules\/monaco-editor\/esm\/vs\/platform(?:\/|$)/,
            },
            {
              name: 'monaco-editor-viewparts',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/browser\/viewParts(?:\/|$)/,
            },
            {
              name: 'monaco-editor-widget',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/browser\/widget(?:\/|$)/,
            },
            {
              name: 'monaco-editor-view',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/browser\/view(?:\/|$)/,
            },
            {
              name: 'monaco-editor-controller',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/browser\/controller(?:\/|$)/,
            },
            {
              name: 'monaco-editor-services',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/browser\/(?:services|config)(?:\/|$)/,
            },
            {
              name: 'monaco-editor-gpu',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/browser\/gpu(?:\/|$)/,
            },
            {
              name: 'monaco-editor-browser',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/browser(?:\/|$)/,
            },
            {
              name: 'monaco-editor-common',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/common(?:\/|$)/,
            },
            {
              name: 'monaco-editor-contrib-suggest',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/contrib\/(?:suggest|snippet|inlineCompletions|quickAccess)(?:\/|$)/,
            },
            {
              name: 'monaco-editor-contrib-search',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/contrib\/(?:find|hover|links|gotoSymbol|gotoError|peekView|rename|codelens|parameterHints|documentSymbols|codeAction)(?:\/|$)/,
            },
            {
              name: 'monaco-editor-contrib-display',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/contrib\/(?:folding|stickyScroll|colorPicker|semanticTokens|bracketMatching|inlayHints|symbolIcons|diffEditorBreadcrumbs)(?:\/|$)/,
            },
            {
              name: 'monaco-editor-contrib-edit',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/contrib\/(?:comment|multicursor|linesOperations|caretOperations|wordOperations|smartSelect|lineSelection|indentation|anchorSelect|insertFinalNewLine|linkedEditing|inPlaceReplace|tokenization|dnd|dropOrPasteInto|middleScroll|contextmenu|fontZoom|message|readOnlyMessage|toggleTabFocusMode|wordHighlighter|clipboard)(?:\/|$)/,
            },
            {
              name: 'monaco-editor-contrib',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/contrib(?:\/|$)/,
            },
            {
              name: 'monaco-editor-standalone',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/standalone(?:\/|$)/,
            },
            {
              name: 'monaco-editor-internal',
              test: /node_modules\/monaco-editor\/esm\/vs\/editor\/internal(?:\/|$)/,
            },
            {
              name: 'monaco-language',
              test: /node_modules\/monaco-editor\/esm\/vs\/basic-languages(?:\/|$)/,
            },
            {
              name: 'monaco-vendor',
              test: /node_modules\/monaco-editor(?:\/|$)/,
            },
          ],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
})

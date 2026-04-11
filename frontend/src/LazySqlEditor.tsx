import { Suspense, lazy } from 'react'
import type { SqlEditorProps } from './SqlEditor'

const SqlEditorInner = lazy(() =>
  import('./SqlEditor').then((module) => ({
    default: module.SqlEditor,
  })),
)

export function LazySqlEditor(props: SqlEditorProps) {
  return (
    <Suspense
      fallback={<div className="status-panel">SQL 编辑器加载中，正在准备语法能力。</div>}
    >
      <SqlEditorInner {...props} />
    </Suspense>
  )
}

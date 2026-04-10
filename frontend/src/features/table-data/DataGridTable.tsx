import { useEffect, useRef } from 'react'
import type { CellValue, TableDataColumn } from '../../types'
import type { DataGridRow } from '../workspace/types'
import { parseCellValue, stringifyCellValue } from './dataMutations'

type DataGridTableProps = {
  columns: TableDataColumn[]
  rows: DataGridRow[]
  editable: boolean
  rowNumberOffset?: number
  onSelectRowsRange?: (
    startClientId: string,
    endClientId: string,
    options?: { append?: boolean },
  ) => void
  onValueChange?: (clientId: string, columnName: string, value: CellValue) => void
}

export function DataGridTable({
  columns,
  rows,
  editable,
  rowNumberOffset,
  onSelectRowsRange,
  onValueChange,
}: DataGridTableProps) {
  const selectionAnchorRef = useRef<string | null>(null)
  const dragSelectionRef = useRef<{
    startClientId: string
    append: boolean
    lastClientId: string
  } | null>(null)

  useEffect(() => {
    const handleMouseUp = () => {
      if (dragSelectionRef.current) {
        selectionAnchorRef.current = dragSelectionRef.current.lastClientId
      }
      dragSelectionRef.current = null
    }

    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [])

  return (
    <div className="data-grid-viewport">
      <table className="data-table">
        <colgroup>
          <col style={{ width: '56px' }} />
          {columns.map((column) => (
            <col key={`col-${column.name}`} style={{ width: '240px' }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="center-cell">#</th>
            {columns.map((column) => (
              <th key={column.name}>
                <span className="column-title">
                  {column.primary_key ? <strong>PK</strong> : null}
                  {column.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              className={`${row.selected ? 'selected' : ''} row-${row.state}`}
              key={row.client_id}
              onMouseEnter={() => {
                if (!dragSelectionRef.current) {
                  return
                }

                dragSelectionRef.current.lastClientId = row.client_id
                onSelectRowsRange?.(
                  dragSelectionRef.current.startClientId,
                  row.client_id,
                  { append: dragSelectionRef.current.append },
                )
              }}
            >
              <td
                className="center-cell row-selector-cell"
                onMouseDown={(event) => {
                  event.preventDefault()
                  const append = event.metaKey || event.ctrlKey
                  const startClientId =
                    event.shiftKey && selectionAnchorRef.current
                      ? selectionAnchorRef.current
                      : row.client_id
                  dragSelectionRef.current = {
                    startClientId,
                    append,
                    lastClientId: row.client_id,
                  }
                  if (!event.shiftKey || !selectionAnchorRef.current) {
                    selectionAnchorRef.current = row.client_id
                  }
                  onSelectRowsRange?.(startClientId, row.client_id, {
                    append,
                  })
                }}
              >
                {(rowNumberOffset ?? 0) + index + 1}
              </td>

              {columns.map((column) => (
                <td key={`${row.client_id}:${column.name}`}>
                  <input
                    className={`data-cell-input ${
                      row.values[column.name] == null ? 'is-null' : ''
                    }`}
                    disabled={!editable || row.state === 'deleted' || !onValueChange}
                    value={stringifyCellValue(row.values[column.name] ?? null)}
                    onChange={(event) =>
                      onValueChange?.(
                        row.client_id,
                        column.name,
                        parseCellValue(event.target.value, column),
                      )
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

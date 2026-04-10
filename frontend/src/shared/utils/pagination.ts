export function formatTotalRowsLabel(totalRows: number, rowCountExact: boolean) {
  return rowCountExact ? `${totalRows}` : `至少 ${totalRows}`
}

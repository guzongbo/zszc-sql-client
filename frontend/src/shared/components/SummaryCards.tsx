type SummaryCardsProps = {
  items: [string, string][]
}

export function SummaryCards({ items }: SummaryCardsProps) {
  return (
    <div className="compare-summary-grid">
      {items.map(([label, value]) => (
        <div className="compare-summary-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  )
}

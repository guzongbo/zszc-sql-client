type InlineSqlInputProps = {
  value: string
  placeholder?: string
  onChange: (value: string) => void
  onSubmit?: () => void
}

export function InlineSqlInput({
  value,
  placeholder,
  onChange,
  onSubmit,
}: InlineSqlInputProps) {
  return (
    <div className="inline-sql-shell">
      <input
        className="inline-sql-input"
        placeholder={placeholder}
        spellCheck={false}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') {
            return
          }
          event.preventDefault()
          onSubmit?.()
        }}
      />
    </div>
  )
}

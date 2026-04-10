type EmptyNoticeProps = {
  title: string
  text: string
}

export function EmptyNotice({ title, text }: EmptyNoticeProps) {
  return (
    <div className="empty-notice">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  )
}

type AuthNoticeProps = {
  kind?: 'error' | 'success' | 'info'
  children: string
}

export function AuthNotice({ kind = 'info', children }: AuthNoticeProps) {
  return <div className={`auth-notice auth-notice--${kind}`}>{children}</div>
}

import type { ReactNode } from 'react'

type AuthFormShellProps = {
  title: string
  description: string
  children: ReactNode
}

export function AuthFormShell({ title, description, children }: AuthFormShellProps) {
  return (
    <section className="auth-card">
      <div className="auth-card__header">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </section>
  )
}

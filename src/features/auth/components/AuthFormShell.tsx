import type { ReactNode } from 'react'

type AuthFormShellProps = {
  title: string
  description: string
  children: ReactNode
  visual?: {
    eyebrow: string
    title: string
    description?: string
    features?: string[]
  }
}

export function AuthFormShell({ title, description, children, visual }: AuthFormShellProps) {
  return (
    <section className={`auth-card${visual ? ' auth-card--with-visual' : ''}`}>
      {visual && (
        <div className="auth-card__visual" aria-hidden="true">
          <div className="auth-card__visual-copy">
            <span>{visual.eyebrow}</span>
            <strong>{visual.title}</strong>
            {visual.description && <p>{visual.description}</p>}
            {visual.features && (
              <ul>
                {visual.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="auth-card__header">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="auth-card__body">{children}</div>
    </section>
  )
}

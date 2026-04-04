import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../features/auth/AuthProvider'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>{children}</AuthProvider>
    </BrowserRouter>
  )
}

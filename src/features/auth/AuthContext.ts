import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { AuthStatus, AuthUser } from './types'

export type AuthContextValue = {
  configured: boolean
  status: AuthStatus
  user: AuthUser | null
  session: Session | null
}

export const AuthContext = createContext<AuthContextValue | null>(null)

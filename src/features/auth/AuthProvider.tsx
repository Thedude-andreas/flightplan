import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabaseClient, isSupabaseConfigured } from '../../lib/supabase/client'
import { AuthContext, type AuthContextValue } from './AuthContext'
import type { AuthStatus, AuthUser } from './types'

function mapSessionUser(session: Session | null): AuthUser | null {
  const user = session?.user
  if (!user?.email) {
    return null
  }

  return {
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.email_confirmed_at),
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured()
  const [status, setStatus] = useState<AuthStatus>(configured ? 'loading' : 'anonymous')
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    const supabase = getSupabaseClient()

    if (!supabase) {
      return
    }

    let isMounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) {
        return
      }

      setSession(data.session)
      setStatus(data.session ? 'authenticated' : 'anonymous')
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) {
        return
      }

      setSession(nextSession)
      setStatus(nextSession ? 'authenticated' : 'anonymous')
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      configured,
      status,
      user: mapSessionUser(session),
      session,
    }),
    [configured, session, status],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

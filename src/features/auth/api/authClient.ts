import { getSupabaseClient } from '../../../lib/supabase/client'

function requireClient() {
  const client = getSupabaseClient()

  if (!client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }

  return client
}

export async function signInWithPassword(email: string, password: string) {
  const supabase = requireClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    throw error
  }
}

export async function signUpWithPassword(email: string, password: string) {
  const supabase = requireClient()
  const redirectTo = `${window.location.origin}/verify-email`
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: redirectTo,
    },
  })

  if (error) {
    throw error
  }
}

export async function signOut() {
  const supabase = requireClient()
  const { error } = await supabase.auth.signOut()

  if (error) {
    throw error
  }
}

export async function resendVerificationEmail(email: string) {
  const supabase = requireClient()
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/verify-email`,
    },
  })

  if (error) {
    throw error
  }
}

export async function requestPasswordReset(email: string) {
  const supabase = requireClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  })

  if (error) {
    throw error
  }
}

export async function updatePassword(password: string) {
  const supabase = requireClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    throw error
  }
}

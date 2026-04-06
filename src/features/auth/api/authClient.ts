import { getSupabaseClient } from '../../../lib/supabase/client'
import { getPublicAppUrl } from './publicUrl'

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
  const redirectTo = getPublicAppUrl('/verify-email')
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
      emailRedirectTo: getPublicAppUrl('/verify-email'),
    },
  })

  if (error) {
    throw error
  }
}

export async function requestPasswordReset(email: string) {
  const supabase = requireClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: getPublicAppUrl('/reset-password'),
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

export async function ensureOwnProfile() {
  const supabase = requireClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    throw userError
  }

  if (!user?.email) {
    return
  }

  const { error } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      email: user.email,
    },
    {
      onConflict: 'id',
      ignoreDuplicates: false,
    },
  )

  if (error) {
    throw error
  }
}

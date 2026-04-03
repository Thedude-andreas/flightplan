export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export type AuthUser = {
  id: string
  email: string
  emailVerified: boolean
}

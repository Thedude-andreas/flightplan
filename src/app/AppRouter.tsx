import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '../features/auth/components/ProtectedRoute'

const AccountPage = lazy(async () => ({
  default: (await import('../features/account/pages/AccountPage')).AccountPage,
}))
const AircraftProfilesPage = lazy(async () => ({
  default: (await import('../features/aircraft/pages/AircraftProfilesPage')).AircraftProfilesPage,
}))
const DashboardPage = lazy(async () => ({
  default: (await import('../features/dashboard/pages/DashboardPage')).DashboardPage,
}))
const ForgotPasswordPage = lazy(async () => ({
  default: (await import('../features/auth/pages/ForgotPasswordPage')).ForgotPasswordPage,
}))
const LandingPage = lazy(async () => ({
  default: (await import('../features/auth/pages/LandingPage')).LandingPage,
}))
const LoginPage = lazy(async () => ({
  default: (await import('../features/auth/pages/LoginPage')).LoginPage,
}))
const ResetPasswordPage = lazy(async () => ({
  default: (await import('../features/auth/pages/ResetPasswordPage')).ResetPasswordPage,
}))
const SignupPage = lazy(async () => ({
  default: (await import('../features/auth/pages/SignupPage')).SignupPage,
}))
const VerifyEmailPage = lazy(async () => ({
  default: (await import('../features/auth/pages/VerifyEmailPage')).VerifyEmailPage,
}))
const FlightPlanEditorPage = lazy(async () => ({
  default: (await import('../features/flightplan/pages/FlightPlanEditorPage')).FlightPlanEditorPage,
}))
const FlightPlansPage = lazy(async () => ({
  default: (await import('../features/flightplan/pages/FlightPlansPage')).FlightPlansPage,
}))
const AppLayout = lazy(async () => ({
  default: (await import('../layouts/AppLayout')).AppLayout,
}))
const PublicLayout = lazy(async () => ({
  default: (await import('../layouts/PublicLayout')).PublicLayout,
}))

export function AppRouter() {
  return (
    <Suspense fallback={<div className="auth-status-card">Laddar...</div>}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="flightplans" element={<FlightPlansPage />} />
            <Route path="flightplans/new" element={<FlightPlanEditorPage />} />
            <Route path="flightplans/:id" element={<FlightPlanEditorPage />} />
            <Route path="aircraft" element={<AircraftProfilesPage />} />
            <Route path="account" element={<AccountPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

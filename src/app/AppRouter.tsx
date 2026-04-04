import { Navigate, Route, Routes } from 'react-router-dom'
import { AccountPage } from '../features/account/pages/AccountPage'
import { AircraftProfilesPage } from '../features/aircraft/pages/AircraftProfilesPage'
import { DashboardPage } from '../features/dashboard/pages/DashboardPage'
import { ProtectedRoute } from '../features/auth/components/ProtectedRoute'
import { ForgotPasswordPage } from '../features/auth/pages/ForgotPasswordPage'
import { LandingPage } from '../features/auth/pages/LandingPage'
import { LoginPage } from '../features/auth/pages/LoginPage'
import { ResetPasswordPage } from '../features/auth/pages/ResetPasswordPage'
import { SignupPage } from '../features/auth/pages/SignupPage'
import { VerifyEmailPage } from '../features/auth/pages/VerifyEmailPage'
import { FlightPlanEditorPage } from '../features/flightplan/pages/FlightPlanEditorPage'
import { FlightPlansPage } from '../features/flightplan/pages/FlightPlansPage'
import { AppLayout } from '../layouts/AppLayout'
import { PublicLayout } from '../layouts/PublicLayout'

export function AppRouter() {
  return (
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
  )
}

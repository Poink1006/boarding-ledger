import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { UpdateBanner } from './components/UpdateBanner'
import { ErrorBoundary } from './components/ErrorBoundary'
import { logError } from './lib/errorLog'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Rooms } from './pages/Rooms'
import { Tenants } from './pages/Tenants'
import { TenantProfile } from './pages/TenantProfile'
import { Payments } from './pages/Payments'
import { Vacancies } from './pages/Vacancies'
import { Utilities } from './pages/Utilities'
import { Expenses } from './pages/Expenses'
import { Settings } from './pages/Settings'
import { Unauthorized } from './pages/Unauthorized'

export default function App() {
  // capture errors that escape React's render tree — uncaught exceptions and
  // unhandled promise rejections — so they land in the error log too
  useEffect(() => {
    const onError = (e: ErrorEvent) => logError(e.message, e.error?.stack, 'window.onerror')
    const onRejection = (e: PromiseRejectionEvent) =>
      logError(String(e.reason?.message ?? e.reason), e.reason?.stack, 'unhandledrejection')
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return (
    <ToastProvider>
      <AuthProvider>
        <UpdateBanner />
        <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/unauthorized" element={<Unauthorized />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/rooms" element={<Rooms />} />
              <Route path="/tenants" element={<Tenants />} />
              <Route path="/tenants/:id" element={<TenantProfile />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/vacancies" element={<Vacancies />} />
              <Route path="/utilities" element={<Utilities />} />

              <Route element={<AdminRoute />}>
                <Route path="/expenses" element={<Expenses />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
      </AuthProvider>
    </ToastProvider>
  )
}

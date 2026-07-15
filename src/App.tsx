import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { UpdateBanner } from './components/UpdateBanner'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Rooms } from './pages/Rooms'
import { Tenants } from './pages/Tenants'
import { Payments } from './pages/Payments'
import { Utilities } from './pages/Utilities'
import { Expenses } from './pages/Expenses'
import { Settings } from './pages/Settings'
import { Unauthorized } from './pages/Unauthorized'

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <UpdateBanner />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/unauthorized" element={<Unauthorized />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/rooms" element={<Rooms />} />
              <Route path="/tenants" element={<Tenants />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/utilities" element={<Utilities />} />

              <Route element={<AdminRoute />}>
                <Route path="/expenses" element={<Expenses />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  )
}

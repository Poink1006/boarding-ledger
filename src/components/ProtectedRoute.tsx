import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function ProtectedRoute() {
  const { session, loading } = useAuth()

  if (loading) return <div className="empty-state"><h3>Loading…</h3></div>
  if (!session) return <Navigate to="/login" replace />

  return <Outlet />
}

export function AdminRoute() {
  const { isAdmin, loading } = useAuth()

  if (loading) return <div className="empty-state"><h3>Loading…</h3></div>
  if (!isAdmin) return <Navigate to="/unauthorized" replace />

  return <Outlet />
}

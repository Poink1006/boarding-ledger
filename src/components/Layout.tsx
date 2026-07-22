import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { MigrationBanner } from './MigrationBanner'
import { OfflineBanner } from './OfflineBanner'
import logo from '../assets/logo.png'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '▤', end: true },
  { to: '/rooms', label: 'Units & Rooms', icon: '▦' },
  { to: '/tenants', label: 'Tenants', icon: '☰' },
  { to: '/payments', label: 'Payments', icon: '◈' },
  { to: '/utilities', label: 'Utilities', icon: '⚡' },
]

export function Layout() {
  const { profile, isAdmin, isRealAdmin, viewingAsUser, toggleViewAsUser, signOut } = useAuth()

  return (
    <div id="app">
      <div className="sidebar">
        <div className="brand">
          <img src={logo} alt="" className="brand-logo" />
          Victoria Residence
        </div>
        <div className="brand-sub">8 Units · 34 Rooms</div>

        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}

        {isAdmin && (
          <NavLink to="/expenses" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span className="nav-icon">⊖</span>
            <span className="nav-label">Expenses</span>
          </NavLink>
        )}

        {isAdmin && (
          <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span className="nav-icon">⚙</span>
            <span className="nav-label">Settings</span>
          </NavLink>
        )}

        <div className="sidebar-foot">
          <div style={{ marginBottom: 8 }}>
            {profile?.full_name || 'Signed in'}
            <br />
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {viewingAsUser ? 'user (preview)' : profile?.role ?? '—'}
            </span>
          </div>
          {isRealAdmin && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: '100%', marginBottom: 8 }}
              onClick={toggleViewAsUser}
              type="button"
            >
              {viewingAsUser ? '↺ Switch back to Admin' : '👁 View as User'}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </div>
      <div className="main">
        <OfflineBanner />
        <MigrationBanner />
        {viewingAsUser && (
          <div className="view-as-banner">
            Previewing the app as a regular user. <button onClick={toggleViewAsUser} type="button">Switch back to Admin</button>
          </div>
        )}
        <Outlet />
      </div>
    </div>
  )
}

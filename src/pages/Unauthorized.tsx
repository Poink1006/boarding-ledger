import { Link } from 'react-router-dom'

export function Unauthorized() {
  return (
    <div className="empty-state" style={{ paddingTop: 80 }}>
      <h3>Not authorized</h3>
      <p>This page is restricted to admin accounts.</p>
      <Link to="/" className="btn btn-ghost" style={{ marginTop: 12, display: 'inline-flex' }}>
        Back to dashboard
      </Link>
    </div>
  )
}

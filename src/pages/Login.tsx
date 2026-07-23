import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { toLoginEmail } from '../lib/username'
import logo from '../assets/logo.png'

export function Login() {
  const { session, loading, signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && session) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    // maps a username to its synthetic email; a typed email passes through
    const { error } = await signIn(toLoginEmail(username), password)
    setSubmitting(false)
    if (error) setError(error)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--paper)',
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="table-wrap"
        style={{ width: 360, padding: '28px 28px 24px' }}
      >
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img src={logo} alt="" style={{ width: 76, height: 76, marginBottom: 8 }} />
          <div className="login-title" style={{ fontSize: 22 }}>
            Victoria Residence
          </div>
          <div className="page-sub" style={{ marginTop: 4 }}>
            Sign in to manage apartments, tenants, and payments.
          </div>
        </div>

        <div className="form-group">
          <label>Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            required
          />
        </div>
        <div className="form-group">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <div className="hint" style={{ color: 'var(--clay)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

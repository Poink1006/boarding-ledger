import { Component, type ReactNode } from 'react'
import { logError } from '../lib/errorLog'

// Catches render-time crashes anywhere below it, records them to the error log
// so an admin can see what happened, and shows a recoverable fallback instead
// of a blank white screen. Class component because React error boundaries have
// no hook equivalent.
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    logError(error.message, error.stack, `render${info.componentStack ? ': ' + info.componentStack.slice(0, 600) : ''}`)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 48, textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
          <h2>Something went wrong</h2>
          <p className="hint" style={{ marginBottom: 20 }}>
            The problem has been logged. Reloading usually fixes it — if it keeps happening, let the admin know.
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

import { useEffect, useState } from 'react'

// Shows a banner while the machine is offline, so front-desk staff know they're
// looking at saved (possibly stale) data and that new changes won't save until
// the connection returns. Reads persist from the localStorage cache; writes
// still need the network.
export function OfflineBanner() {
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      style={{
        background: 'var(--brass-soft)',
        color: 'var(--ink)',
        borderBottom: '1px solid var(--brass)',
        padding: '10px 20px',
        fontSize: 13,
      }}
    >
      <strong>You're offline.</strong> Showing the last saved data. New payments and changes can't be saved until the
      connection comes back.
    </div>
  )
}

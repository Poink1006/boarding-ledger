import { useEffect, useState } from 'react'

// Shows an in-app banner when the auto-updater finds/downloads a new version.
// Renders nothing in a plain browser (no window.electronAPI) or until an
// update actually arrives, so it's safe to mount at the app root always.
export function UpdateBanner() {
  const [status, setStatus] = useState<'idle' | 'available' | 'downloaded'>('idle')
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    const offAvailable = api.onUpdateAvailable((info) => {
      setVersion(info.version)
      setStatus((s) => (s === 'downloaded' ? s : 'available'))
    })
    const offDownloaded = api.onUpdateDownloaded((info) => {
      setVersion(info.version)
      setStatus('downloaded')
    })
    return () => {
      offAvailable?.()
      offDownloaded?.()
    }
  }, [])

  if (status === 'idle') return null

  return (
    <div className="update-banner">
      {status === 'available' ? (
        <span>
          A new version{version ? ` (${version})` : ''} is available — downloading in the background…
        </span>
      ) : (
        <>
          <span>
            Update{version ? ` ${version}` : ''} is ready to install.
          </span>
          <button type="button" onClick={() => window.electronAPI?.restartToUpdate()}>
            Restart &amp; update
          </button>
        </>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { EXPECTED_MIGRATIONS } from '../lib/migrations'

// Warns an admin when the database is behind the app — i.e. a migration this
// build expects hasn't been run in Supabase yet. Only real admins see it (they
// alone can run the SQL), and it checks once per mount. If the registry table
// itself is missing, migration 016 hasn't been run, which we call out directly.
export function MigrationBanner() {
  const { isRealAdmin } = useAuth()
  const [missing, setMissing] = useState<string[]>([])
  const [needsRegistry, setNeedsRegistry] = useState(false)

  useEffect(() => {
    if (!isRealAdmin) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from('schema_migrations').select('version')
      if (cancelled) return
      if (error) {
        // table absent (or unreadable) → the registry migration isn't in yet
        setNeedsRegistry(true)
        return
      }
      const applied = new Set((data ?? []).map((r) => r.version))
      setMissing(EXPECTED_MIGRATIONS.filter((v) => !applied.has(v)))
    })()
    return () => {
      cancelled = true
    }
  }, [isRealAdmin])

  if (!isRealAdmin) return null
  if (!needsRegistry && missing.length === 0) return null

  return (
    <div
      style={{
        background: 'var(--clay-soft)',
        color: 'var(--clay)',
        borderBottom: '1px solid var(--clay)',
        padding: '10px 20px',
        fontSize: 13,
      }}
    >
      {needsRegistry ? (
        <>
          <strong>Database update needed.</strong> Run the migrations in{' '}
          <code>supabase/migrations/</code> (starting with <code>016_schema_migrations.sql</code>) in your Supabase SQL
          editor to enable update checks.
        </>
      ) : (
        <>
          <strong>Database update needed.</strong> These migration(s) haven't been run yet in Supabase:{' '}
          <code>{missing.join(', ')}</code>. Run the matching files in <code>supabase/migrations/</code> — new features
          may not work until you do.
        </>
      )}
    </div>
  )
}

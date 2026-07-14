import { supabase } from './supabase'

// A full-fidelity export of every table, meant for disaster recovery: if the
// Supabase project is ever wiped or corrupted, this file holds everything
// needed to rebuild it. We deliberately do NOT filter out soft-deleted rows
// (no `.is('deleted_at', null)`) — a backup should capture the complete state,
// archived records included, or a restore would silently lose history.
//
// Order matters for a hypothetical restore: parents before children, so
// foreign keys resolve (apartments -> rooms -> tenants -> payments, etc.).
const BACKUP_TABLES = [
  'profiles',
  'app_settings',
  'room_price_groups',
  'apartments',
  'rooms',
  'tenants',
  'tenant_rate_changes',
  'payments',
  'utility_bills',
  'audit_log',
] as const

const LAST_BACKUP_KEY = 'lastBackupAt'
// nudge the operator if it's been longer than this since the last export —
// long enough not to nag, short enough that a loss stays small
export const BACKUP_STALE_DAYS = 7

export interface BackupFile {
  app: string
  version: number
  exportedAt: string
  tables: Record<string, unknown[]>
}

export function getLastBackupAt(): string | null {
  return localStorage.getItem(LAST_BACKUP_KEY)
}

export function daysSinceLastBackup(): number | null {
  const last = getLastBackupAt()
  if (!last) return null
  const ms = Date.now() - new Date(last).getTime()
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

// Pull every table, assemble one JSON document, and hand it to the browser as a
// download. Returns the row count per table so the UI can confirm what was
// saved. Throws on the first table that errors, so a partial/misleading backup
// is never presented as complete.
export async function exportAllData(): Promise<{ counts: Record<string, number>; filename: string }> {
  const tables: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}

  for (const name of BACKUP_TABLES) {
    const { data, error } = await supabase.from(name).select('*')
    if (error) {
      throw new Error(`Could not export "${name}": ${error.message}`)
    }
    tables[name] = data ?? []
    counts[name] = data?.length ?? 0
  }

  const now = new Date()
  const backup: BackupFile = {
    app: 'Victoria Residence',
    version: 1,
    exportedAt: now.toISOString(),
    tables,
  }

  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const filename = `victoria-residence-backup-${stamp}.json`

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  localStorage.setItem(LAST_BACKUP_KEY, now.toISOString())
  return { counts, filename }
}

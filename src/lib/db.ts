import { supabase } from './supabase'

// Tables that carry updated_at and a set_updated_at trigger (so updated_at
// reliably changes on every write) — the ones we can guard optimistically.
type GuardedTable = 'payments' | 'tenants' | 'expenses' | 'utility_bills'

export const CONFLICT_MESSAGE =
  'Someone else changed this record while you had it open. Reload the page, then make your change again.'

// Optimistic-locking update. Only writes if the row's updated_at still matches
// what was loaded into the form; if another user (or another tab) saved in the
// meantime, updated_at has moved on, the filter matches no row, and we report a
// conflict instead of silently overwriting their change. A set_updated_at
// trigger bumps updated_at on every write, which is what makes this work.
//
// Returns a friendly error string (or null on success), matching the shape the
// modals already use for Supabase errors.
export async function updateGuarded(
  table: GuardedTable,
  row: { id: string; updated_at: string },
  payload: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from(table)
    // cast: with a dynamic table name the typed client narrows Update to the
    // intersection of all four tables (effectively never); the caller passes a
    // payload valid for the specific table
    .update(payload as never)
    .eq('id', row.id)
    .eq('updated_at', row.updated_at)
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: CONFLICT_MESSAGE }
  return { error: null }
}

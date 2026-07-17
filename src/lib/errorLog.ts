import { supabase } from './supabase'

// Record a runtime error to the error_log table, best-effort. Logging must
// never itself throw (that would turn one error into a cascade), so everything
// here is wrapped and failures are swallowed. Fields are length-capped so a
// giant stack can't bloat a row. Requires a signed-in session (RLS); errors
// before login are dropped, which is fine — those are rare and pre-data.
export async function logError(message: string, stack?: string | null, context?: string) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    let userName: string | null = null
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
    userName = profile?.full_name ?? null

    await supabase.from('error_log').insert({
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 8000) : null,
      context: context ?? null,
      user_id: user.id,
      user_name: userName,
    })
  } catch {
    // never let logging failures surface
  }
}

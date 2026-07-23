// Edge Function: create-user
//
// Creates a staff login using the Supabase Admin API (service_role) so there is
// NO confirmation email and NO email rate limit — unlike the client signUp path.
// The service_role key is read from the function's environment (Supabase injects
// SUPABASE_SERVICE_ROLE_KEY automatically); it never leaves the server, so the
// app still ships only the public anon key.
//
// Only an authenticated ADMIN may call this: we read the caller's JWT, look up
// their profile role with the service client, and reject non-admins.
//
// Deploy from the project root with:  supabase functions deploy create-user
// (No extra secrets to set — SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY are
//  provided to the function by default.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// keep in sync with src/lib/username.ts
const USERNAME_DOMAIN = 'victoria.local'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // 1) identify the caller from their JWT
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'You must be signed in.' }, 401)

    // 2) confirm the caller is an admin (service client bypasses RLS for the lookup)
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return json({ error: 'Only an admin can add users.' }, 403)

    // 3) validate input
    const { fullName, username, password } = await req.json()
    const name = String(fullName ?? '').trim()
    const uname = String(username ?? '')
      .trim()
      .toLowerCase()
    if (!name) return json({ error: 'Enter the person’s name.' }, 400)
    if (!/^[a-z0-9._-]{3,}$/.test(uname)) return json({ error: 'Username must be 3+ characters (letters, numbers, . _ -).' }, 400)
    if (String(password ?? '').length < 6) return json({ error: 'Password must be at least 6 characters.' }, 400)

    // 4) create the confirmed account (no email sent because email_confirm: true)
    const { error: createErr } = await admin.auth.admin.createUser({
      email: `${uname}@${USERNAME_DOMAIN}`,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, username: uname },
    })
    if (createErr) {
      const msg = /registered|already exists|duplicate/i.test(createErr.message) ? 'That username is already taken.' : createErr.message
      return json({ error: msg }, 400)
    }

    return json({ ok: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error.' }, 500)
  }
})

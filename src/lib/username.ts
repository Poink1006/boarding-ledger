// Supabase Auth is email-based, but staff sign in with a plain username. Each
// account is created with an internal "synthetic" email, username@THIS_DOMAIN,
// which nobody ever types or receives mail at — it's just how the username is
// stored in Auth. The domain is arbitrary but must stay constant so the mapping
// is stable.
export const USERNAME_DOMAIN = 'victoria.local'

// Turn what someone typed in the login (or the Add-user) field into the email
// Supabase expects. A real email (contains '@') passes through unchanged, so
// pre-existing email accounts keep working; a bare username becomes its
// synthetic address. Lowercased so usernames are case-insensitive.
export function toLoginEmail(input: string): string {
  const v = input.trim()
  if (v.includes('@')) return v.toLowerCase()
  return `${v.toLowerCase()}@${USERNAME_DOMAIN}`
}

import { fmtMoney } from './format'
import type { computeTenantBalance } from './balance'
import type { Database } from './database.types'

type Tenant = Database['public']['Tables']['tenants']['Row']
type AppSettings = Database['public']['Tables']['app_settings']['Row']
type Balance = ReturnType<typeof computeTenantBalance>

export interface Reminder {
  subject: string
  body: string
}

// Compose a friendly, ready-to-send rent/utility reminder for a tenant who owes
// money. Only mentions the pool(s) they're actually behind on, and appends the
// operator's payment instructions (GCash, etc.) so the tenant knows where to
// send it. Kept as plain text so it works in email, Messenger, or SMS alike.
export function buildReminder(tenant: Tenant, balance: Balance, settings: AppSettings | null): Reminder {
  const business = settings?.business_name || 'Victoria Residence'
  const rentOwed = balance.rentBalance < 0 ? -balance.rentBalance : 0
  const utilityOwed = balance.utilityBalance < 0 ? -balance.utilityBalance : 0
  const monthsBehind = balance.cycles.filter((c) => c.status !== 'paid').length

  const lines: string[] = []
  lines.push(`Hi ${tenant.first_name},`)
  lines.push('')
  lines.push(`This is a friendly reminder about your outstanding balance at ${business}:`)
  lines.push('')
  if (rentOwed > 0) {
    const behind = monthsBehind > 0 ? ` (${monthsBehind} month${monthsBehind === 1 ? '' : 's'} behind)` : ''
    lines.push(`• Rent: ${fmtMoney(rentOwed)}${behind}`)
  }
  if (utilityOwed > 0) {
    lines.push(`• Utilities: ${fmtMoney(utilityOwed)}`)
  }
  lines.push(`• Total due: ${fmtMoney(rentOwed + utilityOwed)}`)
  lines.push('')

  if (settings?.payment_instructions?.trim()) {
    lines.push('How to pay:')
    lines.push(settings.payment_instructions.trim())
    lines.push('')
  }

  lines.push('Please settle at your earliest convenience. Thank you!')
  lines.push('')
  lines.push(business)

  return {
    subject: `Payment reminder — ${business}`,
    body: lines.join('\n'),
  }
}

// A mailto: link that opens the operator's mail client with the reminder ready
// to send. Returns null when the tenant has no email on file.
export function reminderMailto(email: string | null, reminder: Reminder): string | null {
  if (!email?.trim()) return null
  const params = new URLSearchParams({ subject: reminder.subject, body: reminder.body })
  // URLSearchParams encodes spaces as "+", which some mail clients show
  // literally in the body; use %20 so the message reads cleanly
  return `mailto:${encodeURIComponent(email.trim())}?${params.toString().replace(/\+/g, '%20')}`
}

import { describe, expect, it } from 'vitest'
import { buildReminder, reminderMailto } from './reminder'
import type { computeTenantBalance } from './balance'
import type { Database } from './database.types'

type Tenant = Database['public']['Tables']['tenants']['Row']
type AppSettings = Database['public']['Tables']['app_settings']['Row']
type Balance = ReturnType<typeof computeTenantBalance>

function tenant(over: Partial<Tenant> = {}): Tenant {
  return { first_name: 'Maria', last_name: 'Santos', email: 'maria@example.com', ...(over as Tenant) } as Tenant
}

// only the fields buildReminder reads need to be real
function balance(over: Partial<Balance>): Balance {
  return { rentBalance: 0, utilityBalance: 0, cycles: [], ...over } as Balance
}

function settings(over: Partial<AppSettings> = {}): AppSettings {
  return { business_name: 'Victoria Residence', payment_instructions: null, ...(over as AppSettings) } as AppSettings
}

describe('buildReminder', () => {
  it('lists only the pools the tenant is actually behind on', () => {
    const b = balance({
      rentBalance: -10000,
      utilityBalance: 0,
      cycles: [{ status: 'unpaid' }, { status: 'partial' }] as Balance['cycles'],
    })
    const r = buildReminder(tenant(), b, settings())
    expect(r.body).toContain('Rent: ₱10,000 (2 months behind)')
    expect(r.body).not.toContain('Utilities:')
    expect(r.body).toContain('Total due: ₱10,000')
    expect(r.subject).toBe('Payment reminder — Victoria Residence')
  })

  it('includes utilities and payment instructions when present', () => {
    const b = balance({ rentBalance: -5000, utilityBalance: -333.33, cycles: [{ status: 'unpaid' }] as Balance['cycles'] })
    const r = buildReminder(tenant(), b, settings({ payment_instructions: 'GCash: 0917 000 0000' }))
    expect(r.body).toContain('Rent: ₱5,000 (1 month behind)')
    expect(r.body).toContain('Utilities: ₱333.33')
    expect(r.body).toContain('Total due: ₱5,333.33')
    expect(r.body).toContain('GCash: 0917 000 0000')
  })
})

describe('reminderMailto', () => {
  it('builds a mailto link with encoded subject and body', () => {
    const link = reminderMailto('maria@example.com', { subject: 'Payment reminder', body: 'Hi Maria,\nTotal due: ₱5,000' })
    expect(link).toMatch(/^mailto:maria%40example\.com\?/)
    expect(link).toContain('subject=Payment%20reminder')
    expect(link).not.toContain('+') // spaces encoded as %20, not +
  })

  it('returns null when the tenant has no email', () => {
    expect(reminderMailto(null, { subject: 's', body: 'b' })).toBeNull()
    expect(reminderMailto('  ', { subject: 's', body: 'b' })).toBeNull()
  })
})

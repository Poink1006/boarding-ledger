import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeTenantBalance, type UtilityBalanceContext } from './balance'
import type { Database } from './database.types'

type Tenant = Database['public']['Tables']['tenants']['Row']
type Payment = Database['public']['Tables']['payments']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type UtilityBill = Database['public']['Tables']['utility_bills']['Row']
type AppSettings = Database['public']['Tables']['app_settings']['Row']
type RateChange = Database['public']['Tables']['tenant_rate_changes']['Row']

// Balances depend on "today" (an active tenant is billed for every cycle whose
// anchor date has arrived), so freeze the clock to keep the math deterministic.
// Noon avoids any timezone landing us on the wrong calendar day.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0)) // 2026-07-15
})
afterEach(() => {
  vi.useRealTimers()
})

// ---- fixture factories: sensible defaults, override only what a test cares about
let seq = 0
function makeTenant(over: Partial<Tenant> = {}): Tenant {
  seq++
  return {
    id: `t${seq}`,
    tenant_number: `26-${String(seq).padStart(3, '0')}`,
    first_name: 'Test',
    last_name: 'Tenant',
    birthdate: null,
    contact_number: null,
    email: null,
    address: null,
    emergency_name: null,
    emergency_relationship: null,
    emergency_phone: null,
    school: null,
    course: null,
    year_level: null,
    room_id: null,
    bed_index: null,
    monthly_rate: 5000,
    custom_rate_per_pax: null,
    date_applied: '2026-01-01',
    move_in_date: null,
    duration_months: null,
    move_out_date: null,
    status: 'active',
    deposit_amount: 0,
    deposit_status: 'unpaid',
    deposit_collected_date: null,
    deposit_returned_amount: null,
    deposit_returned_date: null,
    deposit_notes: null,
    deleted_at: null,
    created_at: '2026-01-01',
    created_by: null,
    updated_at: '2026-01-01',
    ...over,
  }
}

function makePayment(over: Partial<Payment> & { tenant_id: string; amount: number }): Payment {
  seq++
  return {
    id: `p${seq}`,
    payment_type: 'rent',
    date_paid: '2026-01-15',
    notes: null,
    receipt_no: null,
    deleted_at: null,
    created_at: '2026-01-15',
    created_by: null,
    updated_at: '2026-01-15',
    ...over,
  }
}

function makeRoom(over: Partial<Room> & { id: string; apartment_id: string }): Room {
  return {
    label: 'A',
    capacity: 2,
    private_capacity: null,
    mode: 'shared',
    custom_rate_per_pax: null,
    price_group_id: null,
    created_at: '2026-01-01',
    ...over,
  }
}

function makeBill(over: Partial<UtilityBill> & { apartment_id: string; total_cost: number }): UtilityBill {
  seq++
  return {
    id: `b${seq}`,
    utility_type: 'electricity',
    billing_month: '2026-06-01',
    usage: 0,
    notes: null,
    created_at: '2026-06-05',
    created_by: null,
    updated_at: '2026-06-05',
    ...over,
  }
}

function makeSettings(over: Partial<AppSettings> = {}): AppSettings {
  // only the utility-allowance fields matter to balance.ts; the rest are filled
  // to satisfy the type
  return {
    id: true,
    default_shared_rate_per_pax: 0,
    default_private_rate_per_pax: 0,
    electricity_allowance_per_tenant: 500,
    water_allowance_per_tenant: 300,
    business_name: 'Test',
    business_address: null,
    business_contact: null,
    updated_at: '2026-01-01',
    updated_by: null,
  } as AppSettings & typeof over
}

function rateChange(over: Partial<RateChange> & { tenant_id: string; monthly_rate: number; effective_date: string }): RateChange {
  seq++
  return {
    id: `rc${seq}`,
    created_at: over.effective_date,
    created_by: null,
    ...over,
  }
}

describe('rent billing', () => {
  it('bills nothing before a move-in date is set', () => {
    const tenant = makeTenant({ move_in_date: null })
    const b = computeTenantBalance(tenant, [makePayment({ tenant_id: tenant.id, amount: 3000 })])
    expect(b.rentDue).toBe(0)
    expect(b.rentBalance).toBe(3000) // the payment sits as pure credit
    expect(b.cycles).toHaveLength(0)
  })

  it('bills one cycle per month from move-in through move-out (inactive tenant)', () => {
    // Jan 15 -> Apr 15 inclusive = 4 anchors, at ₱5,000 each = ₱20,000
    const tenant = makeTenant({
      move_in_date: '2026-01-15',
      status: 'inactive',
      move_out_date: '2026-04-15',
      monthly_rate: 5000,
    })
    const b = computeTenantBalance(tenant, [])
    expect(b.cyclesBilled).toBe(4)
    expect(b.rentDue).toBe(20000)
    expect(b.rentBalance).toBe(-20000) // owes it all, nothing paid
    expect(b.nextDueDate).toBeNull() // moved-out tenants have no next cycle
  })

  it('marks cycles paid/partial/unpaid via oldest-first (FIFO) allocation', () => {
    const tenant = makeTenant({
      move_in_date: '2026-01-15',
      status: 'inactive',
      move_out_date: '2026-03-15', // 3 cycles: Jan, Feb, Mar
      monthly_rate: 5000,
    })
    // pay 1.5 months' worth: first cycle fully covered, second half, third none
    const b = computeTenantBalance(tenant, [makePayment({ tenant_id: tenant.id, amount: 7500 })])
    expect(b.cycles.map((c) => c.status)).toEqual(['paid', 'partial', 'unpaid'])
    expect(b.cycles[0].appliedAmount).toBe(5000)
    expect(b.cycles[1].appliedAmount).toBe(2500)
    expect(b.cycles[2].appliedAmount).toBe(0)
    expect(b.rentBalance).toBe(-7500) // 7500 paid of 15000 due
  })

  it('gives an active tenant a next due date one cycle past the last billed one', () => {
    const tenant = makeTenant({ move_in_date: '2026-05-15', status: 'active', monthly_rate: 5000 })
    // today is 2026-07-15: anchors May 15, Jun 15, Jul 15 have arrived = 3 cycles
    const b = computeTenantBalance(tenant, [])
    expect(b.cyclesBilled).toBe(3)
    expect(b.nextDueDate).toBe('2026-08-15')
  })
})

describe('grandfathered rate changes', () => {
  it('falls back to the flat monthly_rate when there is no rate history', () => {
    const tenant = makeTenant({
      move_in_date: '2026-01-15',
      status: 'inactive',
      move_out_date: '2026-02-15', // 2 cycles
      monthly_rate: 4200,
    })
    const b = computeTenantBalance(tenant, [], [])
    expect(b.rentDue).toBe(8400)
    expect(b.cycles.every((c) => c.rate === 4200)).toBe(true)
  })

  it('charges each cycle the rate in effect on its anchor date', () => {
    const tenant = makeTenant({
      id: 'grandpa',
      move_in_date: '2026-01-15',
      status: 'inactive',
      move_out_date: '2026-03-15', // 3 cycles: Jan, Feb, Mar
      monthly_rate: 5000,
    })
    // ₱5,000 from move-in, then a raise to ₱6,000 effective Mar 1
    const history: RateChange[] = [
      rateChange({ tenant_id: 'grandpa', monthly_rate: 5000, effective_date: '2026-01-15' }),
      rateChange({ tenant_id: 'grandpa', monthly_rate: 6000, effective_date: '2026-03-01' }),
    ]
    const b = computeTenantBalance(tenant, [], history)
    expect(b.cycles.map((c) => c.rate)).toEqual([5000, 5000, 6000])
    expect(b.rentDue).toBe(16000)
  })
})

describe('rent and utilities are independent pools', () => {
  it('never lets a rent payment cover a utility charge or vice versa', () => {
    const tenant = makeTenant({ id: 'solo', room_id: 'R1', move_in_date: '2026-01-15', status: 'active' })
    const ctx: UtilityBalanceContext = {
      rooms: [makeRoom({ id: 'R1', apartment_id: 'A1' })],
      tenants: [tenant], // headcount 1
      utilityBills: [makeBill({ apartment_id: 'A1', utility_type: 'electricity', total_cost: 1500 })],
      settings: makeSettings(), // electricity allowance 500 * 1 head = 500; excess 1000
    }
    // pay a big RENT payment only — utilities must stay fully owed
    const b = computeTenantBalance(tenant, [makePayment({ tenant_id: 'solo', amount: 99999, payment_type: 'rent' })], [], ctx)
    expect(b.utilityDue).toBe(1000)
    expect(b.utilityPaid).toBe(0)
    expect(b.utilityBalance).toBe(-1000) // still owes utilities despite rent overpayment
    expect(b.utilityCharges[0].status).toBe('unpaid')
  })
})

describe('per-tenant utility overage', () => {
  const room = makeRoom({ id: 'R1', apartment_id: 'A1' })

  it('splits the excess over (allowance × headcount) evenly among current occupants', () => {
    const t1 = makeTenant({ id: 'u1', room_id: 'R1', move_in_date: '2026-01-15', status: 'active' })
    const t2 = makeTenant({ id: 'u2', room_id: 'R1', move_in_date: '2026-01-15', status: 'active' })
    const ctx: UtilityBalanceContext = {
      rooms: [room],
      tenants: [t1, t2], // headcount 2
      // electricity bill 2000; allowance 500 * 2 = 1000; excess 1000; each owes 500
      utilityBills: [makeBill({ apartment_id: 'A1', utility_type: 'electricity', total_cost: 2000 })],
      settings: makeSettings(),
    }
    const b = computeTenantBalance(t1, [], [], ctx)
    expect(b.utilityDue).toBe(500)
    expect(b.utilityCharges).toHaveLength(1)
    expect(b.utilityCharges[0]).toMatchObject({ type: 'electricity', amount: 500, status: 'unpaid' })
  })

  it('charges nothing when a bill is within the allowance', () => {
    const t1 = makeTenant({ id: 'u3', room_id: 'R1', move_in_date: '2026-01-15', status: 'active' })
    const ctx: UtilityBalanceContext = {
      rooms: [room],
      tenants: [t1], // headcount 1, allowance 300 for water
      utilityBills: [makeBill({ apartment_id: 'A1', utility_type: 'water', total_cost: 250 })],
      settings: makeSettings(),
    }
    const b = computeTenantBalance(t1, [], [], ctx)
    expect(b.utilityDue).toBe(0)
    expect(b.utilityCharges).toHaveLength(0)
  })

  it('applies utility payments oldest-first across months', () => {
    const t1 = makeTenant({ id: 'u4', room_id: 'R1', move_in_date: '2026-01-15', status: 'active' })
    const ctx: UtilityBalanceContext = {
      rooms: [room],
      tenants: [t1], // headcount 1
      utilityBills: [
        makeBill({ apartment_id: 'A1', utility_type: 'electricity', billing_month: '2026-05-01', total_cost: 1000 }), // excess 500
        makeBill({ apartment_id: 'A1', utility_type: 'electricity', billing_month: '2026-06-01', total_cost: 1000 }), // excess 500
      ],
      settings: makeSettings(),
    }
    // pay ₱700 of utilities: May fully covered, June partial
    const b = computeTenantBalance(t1, [makePayment({ tenant_id: 'u4', amount: 700, payment_type: 'utility' })], [], ctx)
    expect(b.utilityDue).toBe(1000)
    expect(b.utilityCharges.map((c) => c.month)).toEqual(['2026-05-01', '2026-06-01'])
    expect(b.utilityCharges.map((c) => c.status)).toEqual(['paid', 'partial'])
    expect(b.utilityCharges[1].appliedAmount).toBe(200)
    expect(b.utilityBalance).toBe(-300) // 700 paid of 1000 due
  })

  it('excludes utility bills from before the tenant moved in', () => {
    const t1 = makeTenant({ id: 'u5', room_id: 'R1', move_in_date: '2026-06-01', status: 'active' })
    const ctx: UtilityBalanceContext = {
      rooms: [room],
      tenants: [t1],
      utilityBills: [
        makeBill({ apartment_id: 'A1', utility_type: 'electricity', billing_month: '2026-03-01', total_cost: 5000 }), // before move-in
        makeBill({ apartment_id: 'A1', utility_type: 'electricity', billing_month: '2026-06-01', total_cost: 1000 }), // excess 500
      ],
      settings: makeSettings(),
    }
    const b = computeTenantBalance(t1, [], [], ctx)
    expect(b.utilityDue).toBe(500)
    expect(b.utilityCharges).toHaveLength(1)
    expect(b.utilityCharges[0].month).toBe('2026-06-01')
  })
})

describe('combined balance', () => {
  it('sums rent and utility balances into one number', () => {
    const tenant = makeTenant({
      id: 'combo',
      room_id: 'R1',
      move_in_date: '2026-06-15',
      status: 'active',
      monthly_rate: 5000,
    })
    const ctx: UtilityBalanceContext = {
      rooms: [makeRoom({ id: 'R1', apartment_id: 'A1' })],
      tenants: [tenant], // headcount 1
      utilityBills: [makeBill({ apartment_id: 'A1', utility_type: 'electricity', billing_month: '2026-06-01', total_cost: 1000 })], // excess 500
      settings: makeSettings(),
    }
    // move-in Jun 15: anchors Jun 15, Jul 15 = 2 cycles = ₱10,000 rent due; ₱500 utility due
    const payments = [
      makePayment({ tenant_id: 'combo', amount: 10000, payment_type: 'rent' }),
      makePayment({ tenant_id: 'combo', amount: 200, payment_type: 'utility' }),
    ]
    const b = computeTenantBalance(tenant, payments, [], ctx)
    expect(b.rentBalance).toBe(0) // 10000 paid of 10000
    expect(b.utilityBalance).toBe(-300) // 200 paid of 500
    expect(b.balance).toBe(-300) // rent 0 + utility -300
    expect(b.totalDue).toBe(10500)
    expect(b.totalPaid).toBe(10200)
  })
})

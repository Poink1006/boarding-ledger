import { addMonths, todayStr, dateToMonthInput } from './format'
import { occupiesBed } from './tenantStatus'
import type { Database } from './database.types'

type Tenant = Database['public']['Tables']['tenants']['Row']
type Payment = Database['public']['Tables']['payments']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type UtilityBill = Database['public']['Tables']['utility_bills']['Row']
type AppSettings = Database['public']['Tables']['app_settings']['Row']
type RateChange = Database['public']['Tables']['tenant_rate_changes']['Row']

export interface BillingCycle {
  index: number
  anchorDate: string
  rate: number
  dueCumulative: number
  appliedAmount: number
  status: 'paid' | 'partial' | 'unpaid'
}

export interface TenantBalance {
  // rent and utilities are independent pools — a rent top-up never covers a
  // utility charge or vice versa
  rentPaid: number
  rentDue: number
  rentBalance: number
  utilityPaid: number
  utilityDue: number
  utilityBalance: number
  totalPaid: number // rentPaid + utilityPaid
  totalDue: number // rentDue + utilityDue
  balance: number // rentBalance + utilityBalance; positive = credit, negative = owed
  cyclesBilled: number
  nextDueDate: string | null
  cycles: BillingCycle[]
}

export interface UtilityBalanceContext {
  rooms: Room[]
  tenants: Tenant[]
  utilityBills: UtilityBill[]
  settings: AppSettings | null
}

// How many current occupants (active + reserved) share apartmentId's beds —
// this is always the CURRENT roster, not a historical per-month snapshot,
// so it's a simplification: bills are assumed to be entered soon after the
// month they cover, when the current roster still matches who was there.
function apartmentHeadcount(apartmentId: string, ctx: UtilityBalanceContext) {
  const roomIds = new Set(ctx.rooms.filter((r) => r.apartment_id === apartmentId).map((r) => r.id))
  return ctx.tenants.filter((t) => occupiesBed(t.status) && t.room_id && roomIds.has(t.room_id)).length
}

// Each tenant's rent is assumed to cover an allowance per utility. Any
// apartment bill beyond (allowance * current headcount) is split evenly
// across the apartment's current occupants and added to what each owes.
function computeUtilityDue(tenant: Tenant, ctx: UtilityBalanceContext): number {
  if (!tenant.room_id || !ctx.settings) return 0
  const room = ctx.rooms.find((r) => r.id === tenant.room_id)
  if (!room) return 0
  const headcount = apartmentHeadcount(room.apartment_id, ctx)
  if (headcount === 0) return 0

  const cutoff = tenant.status === 'inactive' && tenant.move_out_date ? tenant.move_out_date : todayStr()
  const cutoffMonth = dateToMonthInput(cutoff)
  const startMonth = tenant.move_in_date ? dateToMonthInput(tenant.move_in_date) : null

  let due = 0
  for (const bill of ctx.utilityBills) {
    if (bill.apartment_id !== room.apartment_id) continue
    const billMonth = dateToMonthInput(bill.billing_month)
    if (startMonth && billMonth < startMonth) continue
    if (billMonth > cutoffMonth) continue
    const allowance =
      (bill.utility_type === 'electricity'
        ? ctx.settings.electricity_allowance_per_tenant
        : ctx.settings.water_allowance_per_tenant) * headcount
    const excess = Math.max(0, bill.total_cost - allowance)
    due += excess / headcount
  }
  return due
}

// The rate in effect for a cycle anchored on `anchorDate` — the most recent
// rate_changes entry whose effective_date has arrived by then. Tenants with
// no history yet (created before this feature) fall back to their flat
// tenant.monthly_rate, matching the old behavior exactly.
function rateForCycle(tenant: Tenant, anchorDate: string, rateHistory: RateChange[]): number {
  let latest: RateChange | null = null
  for (const change of rateHistory) {
    if (change.tenant_id !== tenant.id || change.effective_date > anchorDate) continue
    if (!latest || change.effective_date > latest.effective_date) latest = change
  }
  return latest ? Number(latest.monthly_rate || 0) : Number(tenant.monthly_rate || 0)
}

// Billing cycles anchor to the move-in date (move-in, +1mo, +2mo, ...). A
// cycle counts as "billed" once its anchor date has arrived. No scheduled
// job needed — this is recomputed fresh every time the page loads. Payments
// are allocated to cycles oldest-first (FIFO) purely for the monthly
// breakdown display — the underlying balance is still one running number.
export function computeTenantBalance(
  tenant: Tenant,
  payments: Payment[],
  rateHistory: RateChange[] = [],
  utilityContext?: UtilityBalanceContext,
): TenantBalance {
  const tenantPayments = payments.filter((p) => p.tenant_id === tenant.id)
  const rentPaid = tenantPayments
    .filter((p) => p.payment_type === 'rent')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const utilityPaid = tenantPayments
    .filter((p) => p.payment_type === 'utility')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const totalPaid = rentPaid + utilityPaid

  const utilityDue = utilityContext ? computeUtilityDue(tenant, utilityContext) : 0
  const utilityBalance = utilityPaid - utilityDue

  if (!tenant.move_in_date) {
    return {
      rentPaid,
      rentDue: 0,
      rentBalance: rentPaid,
      utilityPaid,
      utilityDue,
      utilityBalance,
      totalPaid,
      totalDue: utilityDue,
      balance: rentPaid + utilityBalance,
      cyclesBilled: 0,
      nextDueDate: null,
      cycles: [],
    }
  }

  const cutoff = tenant.status === 'inactive' && tenant.move_out_date ? tenant.move_out_date : todayStr()

  const cycles: BillingCycle[] = []
  let anchor = tenant.move_in_date
  let index = 0
  let dueCumulative = 0
  // only rent payments cover rent cycles — utility payments never bleed
  // into the monthly rent breakdown
  let remainingPaid = rentPaid
  while (anchor <= cutoff) {
    const rate = rateForCycle(tenant, anchor, rateHistory)
    dueCumulative += rate
    const appliedAmount = Math.max(0, Math.min(rate, remainingPaid))
    remainingPaid -= appliedAmount
    const status: BillingCycle['status'] = appliedAmount >= rate ? 'paid' : appliedAmount > 0 ? 'partial' : 'unpaid'
    cycles.push({ index, anchorDate: anchor, rate, dueCumulative, appliedAmount, status })
    index++
    anchor = addMonths(tenant.move_in_date, index)
  }

  const rentDue = dueCumulative
  const rentBalance = rentPaid - rentDue
  const totalDue = rentDue + utilityDue
  const nextDueDate = tenant.status === 'active' ? addMonths(tenant.move_in_date, index) : null

  return {
    rentPaid,
    rentDue,
    rentBalance,
    utilityPaid,
    utilityDue,
    utilityBalance,
    totalPaid,
    totalDue,
    balance: rentBalance + utilityBalance,
    cyclesBilled: index,
    nextDueDate,
    cycles,
  }
}

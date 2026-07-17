import { addMonths, todayStr, dateToMonthInput } from './format'
import { roundCentavos } from './money'
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

export interface UtilityCharge {
  month: string // billing_month (a date)
  type: 'electricity' | 'water'
  amount: number // this tenant's share of the overage
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
  utilityCharges: UtilityCharge[] // per-month utility overage share for this tenant
}

export interface UtilityBalanceContext {
  rooms: Room[]
  tenants: Tenant[]
  utilityBills: UtilityBill[]
  settings: AppSettings | null
}

// How many tenants were living in apartmentId during billMonth ('YYYY-MM').
// Uses each tenant's move-in / move-out dates — the roster AS OF that month —
// not the current roster, so a bill from a past month is split among the people
// who actually lived there then, and doesn't silently re-split when someone
// later moves out. Room attribution uses the tenant's current room_id (we don't
// track historical room moves), a bounded simplification.
function apartmentHeadcountForMonth(apartmentId: string, billMonth: string, ctx: UtilityBalanceContext) {
  const roomIds = new Set(ctx.rooms.filter((r) => r.apartment_id === apartmentId).map((r) => r.id))
  return ctx.tenants.filter((t) => {
    if (!t.room_id || !roomIds.has(t.room_id)) return false
    if (!t.move_in_date || dateToMonthInput(t.move_in_date) > billMonth) return false // not yet moved in that month
    if (t.move_out_date && dateToMonthInput(t.move_out_date) < billMonth) return false // already moved out before it
    return true
  }).length
}

// Each tenant's rent is assumed to cover an allowance per utility. Any
// apartment bill beyond (allowance * current headcount) is split evenly
// across the apartment's current occupants and added to what each owes.
// Returns one entry per relevant utility bill (this tenant's share), oldest
// month first, so a per-month statement can list them.
function computeUtilityShares(
  tenant: Tenant,
  ctx: UtilityBalanceContext,
): { month: string; type: 'electricity' | 'water'; amount: number }[] {
  if (!tenant.room_id || !ctx.settings) return []
  const room = ctx.rooms.find((r) => r.id === tenant.room_id)
  if (!room) return []

  const cutoff = tenant.status === 'inactive' && tenant.move_out_date ? tenant.move_out_date : todayStr()
  const cutoffMonth = dateToMonthInput(cutoff)
  const startMonth = tenant.move_in_date ? dateToMonthInput(tenant.move_in_date) : null

  const shares: { month: string; type: 'electricity' | 'water'; amount: number }[] = []
  for (const bill of ctx.utilityBills) {
    if (bill.apartment_id !== room.apartment_id) continue
    const billMonth = dateToMonthInput(bill.billing_month)
    if (startMonth && billMonth < startMonth) continue
    if (billMonth > cutoffMonth) continue
    // headcount is the roster for THAT bill's month, so past bills stay split
    // among who lived there then
    const headcount = apartmentHeadcountForMonth(room.apartment_id, billMonth, ctx)
    if (headcount === 0) continue
    const allowance =
      (bill.utility_type === 'electricity'
        ? ctx.settings.electricity_allowance_per_tenant
        : ctx.settings.water_allowance_per_tenant) * headcount
    const excess = Math.max(0, bill.total_cost - allowance)
    if (excess <= 0) continue
    // round each occupant's share to whole centavos so the charge is a clean,
    // payable amount and repeated shares don't drift when summed month over month
    shares.push({ month: bill.billing_month, type: bill.utility_type, amount: roundCentavos(excess / headcount) })
  }
  shares.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.type < b.type ? -1 : 1))
  return shares
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

  // per-month utility shares, then FIFO-allocate utility payments across them
  // (oldest month first) to give each a paid/partial/unpaid status
  const rawShares = utilityContext ? computeUtilityShares(tenant, utilityContext) : []
  const utilityDue = rawShares.reduce((s, c) => s + c.amount, 0)
  const utilityBalance = utilityPaid - utilityDue
  let remainingUtilityPaid = utilityPaid
  const utilityCharges: UtilityCharge[] = rawShares.map((c) => {
    const appliedAmount = Math.max(0, Math.min(c.amount, remainingUtilityPaid))
    remainingUtilityPaid -= appliedAmount
    const status: UtilityCharge['status'] =
      appliedAmount >= c.amount ? 'paid' : appliedAmount > 0 ? 'partial' : 'unpaid'
    return { month: c.month, type: c.type, amount: c.amount, appliedAmount, status }
  })

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
      utilityCharges,
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
    utilityCharges,
  }
}

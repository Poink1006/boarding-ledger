import { fmtMoney } from '../../lib/format'
import type { computeTenantBalance } from '../../lib/balance'

type Balance = ReturnType<typeof computeTenantBalance>

export function BalanceBadge({ value, zeroLabel = 'Paid up' }: { value: number; zeroLabel?: string }) {
  if (value < 0) return <span className="badge badge-overdue">Owes {fmtMoney(-value)}</span>
  if (value > 0) return <span className="badge badge-paid">Credit {fmtMoney(value)}</span>
  return <span className="badge badge-pending">{zeroLabel}</span>
}

export function MonthStatusBadge({ status }: { status: 'paid' | 'partial' | 'unpaid' | null }) {
  if (status == null) return <span className="sub-cell">Not billed</span>
  const cls = status === 'paid' ? 'badge-paid' : status === 'partial' ? 'badge-partial' : 'badge-overdue'
  const label = status === 'paid' ? 'Paid' : status === 'partial' ? 'Partial' : 'Unpaid'
  return <span className={`badge ${cls}`}>{label}</span>
}

// the tenant's rent cycle / utility charge for a specific YYYY-MM (or null if
// they weren't billed that month)
export function rentForMonth(balance: Balance, ym: string) {
  const c = balance.cycles.find((cy) => cy.anchorDate.slice(0, 7) === ym)
  return c ? { charge: c.rate, paid: c.appliedAmount, status: c.status } : null
}

export function utilityForMonth(balance: Balance, ym: string) {
  const list = balance.utilityCharges.filter((c) => c.month.slice(0, 7) === ym)
  if (list.length === 0) return null
  const charge = list.reduce((s, c) => s + c.amount, 0)
  const paid = list.reduce((s, c) => s + c.appliedAmount, 0)
  const status: 'paid' | 'partial' | 'unpaid' = paid >= charge ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
  return { charge, paid, status }
}

// every YYYY-MM from the earliest move-in / utility bill up to this month
export function monthsUpToNow(earliest: string, current: string): string[] {
  const out: string[] = []
  let [y, m] = earliest.split('-').map(Number)
  const [ey, em] = current.split('-').map(Number)
  let guard = 0
  while ((y < ey || (y === ey && m <= em)) && guard++ < 600) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { updateGuarded } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Modal } from '../components/Modal'
import { PrintModal } from '../components/PrintModal'
import { MonthlySummaryDoc, type MonthlyApartmentRow } from '../components/documents'
import { SkeletonTable } from '../components/Skeleton'
import { getCached, setCached, hasCached } from '../lib/cache'
import { naturalSort } from '../lib/rooms'
import { fmtMoney, fmtMonth, todayStr, monthInputToDate } from '../lib/format'
import type { Database, ExpenseCategory } from '../lib/database.types'

type Expense = Database['public']['Tables']['expenses']['Row']
type UtilityBill = Database['public']['Tables']['utility_bills']['Row']
type Payment = Database['public']['Tables']['payments']['Row']
type Apartment = Database['public']['Tables']['apartments']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type AppSettings = Database['public']['Tables']['app_settings']['Row']

// display order + labels for the fixed category set
const CATEGORIES: { id: ExpenseCategory; label: string }[] = [
  { id: 'salary', label: 'Employee salary' },
  { id: 'internet', label: 'Internet' },
  { id: 'cleaning', label: 'Cleaning materials' },
  { id: 'miscellaneous', label: 'Miscellaneous' },
]
const CATEGORY_LABEL: Record<ExpenseCategory, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label]),
) as Record<ExpenseCategory, string>

// every YYYY-MM from the earliest expense/utility record up to this month
function monthsUpToNow(earliest: string, current: string): string[] {
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

type ExpenseModalState = { initial: Expense | null; defaultCategory: ExpenseCategory } | null
type TabId = 'summary' | ExpenseCategory
const TABS: { id: TabId; label: string }[] = [{ id: 'summary', label: 'Summary' }, ...CATEGORIES]

const CACHE_KEY = 'expenses'
interface ExpensesData {
  expenses: Expense[]
  utilityBills: UtilityBill[]
  payments: Payment[]
  apartments: Apartment[]
  rooms: Room[]
  tenants: Tenant[]
  settings: AppSettings | null
}

export function Expenses() {
  const { profile } = useAuth()
  const { showToast } = useToast()

  const cached = getCached<ExpensesData>(CACHE_KEY)
  const [expenses, setExpenses] = useState<Expense[]>(cached?.expenses ?? [])
  const [utilityBills, setUtilityBills] = useState<UtilityBill[]>(cached?.utilityBills ?? [])
  const [payments, setPayments] = useState<Payment[]>(cached?.payments ?? [])
  const [apartments, setApartments] = useState<Apartment[]>(cached?.apartments ?? [])
  const [rooms, setRooms] = useState<Room[]>(cached?.rooms ?? [])
  const [tenants, setTenants] = useState<Tenant[]>(cached?.tenants ?? [])
  const [settings, setSettings] = useState<AppSettings | null>(cached?.settings ?? null)
  const [loading, setLoading] = useState(!cached)

  const currentMonth = todayStr().slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const [activeTab, setActiveTab] = useState<TabId>('summary')
  const [modal, setModal] = useState<ExpenseModalState>(null)
  const [reportOpen, setReportOpen] = useState(false)

  const loadAll = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true)
      const [expensesRes, utilityBillsRes, paymentsRes, apartmentsRes, roomsRes, tenantsRes, settingsRes] =
        await Promise.all([
          supabase.from('expenses').select('*').is('deleted_at', null),
          supabase.from('utility_bills').select('*'),
          supabase.from('payments').select('*').is('deleted_at', null),
          supabase.from('apartments').select('*'),
          supabase.from('rooms').select('*'),
          supabase.from('tenants').select('*').is('deleted_at', null),
          supabase.from('app_settings').select('*').single(),
        ])
      if (expensesRes.error) showToast(expensesRes.error.message)
      if (utilityBillsRes.error) showToast(utilityBillsRes.error.message)
      if (paymentsRes.error) showToast(paymentsRes.error.message)
      const data: ExpensesData = {
        expenses: expensesRes.data ?? [],
        utilityBills: utilityBillsRes.data ?? [],
        payments: paymentsRes.data ?? [],
        apartments: [...(apartmentsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.name, b.name)),
        rooms: roomsRes.data ?? [],
        tenants: tenantsRes.data ?? [],
        settings: settingsRes.data ?? null,
      }
      setCached(CACHE_KEY, data)
      setExpenses(data.expenses)
      setUtilityBills(data.utilityBills)
      setPayments(data.payments)
      setApartments(data.apartments)
      setRooms(data.rooms)
      setTenants(data.tenants)
      setSettings(data.settings)
      setLoading(false)
    },
    [showToast],
  )

  useEffect(() => {
    loadAll(hasCached(CACHE_KEY))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAll])

  // soft-delete so the record survives and stays in the audit log
  async function deleteExpense(expense: Expense) {
    if (!window.confirm('Remove this expense? The record is archived, not destroyed.')) return
    const { error } = await supabase
      .from('expenses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', expense.id)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Expense removed.')
    loadAll(true)
  }

  if (loading) {
    return (
      <>
        <div className="page-head">
          <div>
            <h2>Expenses</h2>
          </div>
        </div>
        <SkeletonTable rows={6} cols={4} />
      </>
    )
  }

  // month options span the earliest record to the current month, newest first
  const monthDates = [
    ...expenses.map((e) => e.expense_month),
    ...utilityBills.map((b) => b.billing_month),
  ].map((d) => d.slice(0, 7))
  let earliestMonth = monthDates.length ? monthDates.reduce((a, b) => (a < b ? a : b)) : currentMonth
  if (earliestMonth > currentMonth) earliestMonth = currentMonth
  const monthOptions = monthsUpToNow(earliestMonth, currentMonth).reverse()

  const monthExpenses = expenses
    .filter((e) => e.expense_month.slice(0, 7) === month)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  // apartment utility cost for the month — pulled live from utility_bills (the
  // Utilities page), not re-entered here, so there's one source of truth
  const utilitiesTotal = utilityBills
    .filter((b) => b.billing_month.slice(0, 7) === month)
    .reduce((s, b) => s + Number(b.total_cost || 0), 0)

  const categoryTotals = CATEGORIES.map((c) => ({
    ...c,
    total: monthExpenses.filter((e) => e.category === c.id).reduce((s, e) => s + Number(e.amount || 0), 0),
  }))
  const manualTotal = monthExpenses.reduce((s, e) => s + Number(e.amount || 0), 0)
  const grandTotal = manualTotal + utilitiesTotal

  // income = payments actually collected this month (cash basis)
  const monthPayments = payments.filter((p) => p.date_paid.slice(0, 7) === month)
  const totalIncome = monthPayments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const netIncome = totalIncome - grandTotal

  // per-apartment income/expense rows for the printable monthly summary: resolve
  // each payment to an apartment via tenant -> room; unattributable ones (tenant
  // with no room) fall into an "Unassigned" row so totals still add up
  const roomApt = new Map(rooms.map((r) => [r.id, r.apartment_id]))
  const tenantById = new Map(tenants.map((t) => [t.id, t]))
  const paymentApt = (p: Payment): string | null => {
    const t = tenantById.get(p.tenant_id)
    return t?.room_id ? roomApt.get(t.room_id) ?? null : null
  }
  const sumBy = (list: Payment[], type: string) =>
    list.filter((p) => p.payment_type === type).reduce((s, p) => s + Number(p.amount || 0), 0)
  const summaryRows: MonthlyApartmentRow[] = apartments.map((a) => {
    const pays = monthPayments.filter((p) => paymentApt(p) === a.id)
    return {
      name: a.name,
      rent: sumBy(pays, 'rent'),
      utilityIn: sumBy(pays, 'utility'),
      utilityCost: utilityBills
        .filter((b) => b.apartment_id === a.id && b.billing_month.slice(0, 7) === month)
        .reduce((s, b) => s + Number(b.total_cost || 0), 0),
    }
  })
  const unassigned = monthPayments.filter((p) => paymentApt(p) === null)
  if (unassigned.length > 0) {
    summaryRows.push({ name: 'Unassigned', rent: sumBy(unassigned, 'rent'), utilityIn: sumBy(unassigned, 'utility'), utilityCost: 0 })
  }
  const overheadRows = categoryTotals.map((c) => ({ label: c.label, amount: c.total }))

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Expenses</h2>
          <div className="page-sub">Money going out — salaries, internet, supplies, and apartment utilities</div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setModal({ initial: null, defaultCategory: activeTab === 'summary' ? 'salary' : activeTab })}
        >
          + Add expense
        </button>
      </div>

      <div className="toolbar">
        <label className="hint" style={{ alignSelf: 'center' }}>
          Month
        </label>
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {fmtMonth(monthInputToDate(m))}
            </option>
          ))}
        </select>
      </div>

      <div className="tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab-item${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'summary' ? (
        <>
          {/* headline P&L for the month: what came in vs. what went out, net below */}
          <MonthPLChart
            income={totalIncome}
            expenses={grandTotal}
            net={netIncome}
            monthLabel={fmtMonth(monthInputToDate(month))}
          />

          <div style={{ marginBottom: 24 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setReportOpen(true)}>
              Print monthly summary
            </button>
          </div>

          <div className="section-title">Expense breakdown · {fmtMonth(monthInputToDate(month))}</div>
          <ExpensePieChart
            slices={[
              ...categoryTotals.map((c) => ({ label: c.label, value: c.total })),
              { label: 'Apartment utilities', value: utilitiesTotal },
            ]}
            total={grandTotal}
          />
        </>
      ) : (
        <CategoryEntries
          category={activeTab}
          entries={monthExpenses.filter((e) => e.category === activeTab)}
          month={month}
          onEdit={(e) => setModal({ initial: e, defaultCategory: activeTab })}
          onDelete={deleteExpense}
          onAdd={() => setModal({ initial: null, defaultCategory: activeTab })}
        />
      )}

      {modal && (
        <ExpenseModal
          initial={modal.initial}
          defaultMonth={month}
          defaultCategory={modal.defaultCategory}
          createdBy={profile?.id ?? null}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            loadAll(true)
          }}
        />
      )}

      {reportOpen && (
        <PrintModal onClose={() => setReportOpen(false)} pdfName={`monthly-summary-${month}.pdf`}>
          <MonthlySummaryDoc
            settings={settings}
            monthLabel={fmtMonth(monthInputToDate(month))}
            rows={summaryRows}
            overhead={overheadRows}
          />
        </PrintModal>
      )}
    </>
  )
}

// Income-vs-expenses bar chart for the month, with net income labeled below.
// Inline SVG (no chart library) using the app's own color tokens so it stays
// consistent with the rest of the UI. Bars scale to the larger of the two.
function MonthPLChart({
  income,
  expenses,
  net,
  monthLabel,
}: {
  income: number
  expenses: number
  net: number
  monthLabel: string
}) {
  const W = 340
  const H = 210
  const top = 34
  const baseline = 168
  const maxH = baseline - top
  const max = Math.max(income, expenses, 1)
  const barW = 84
  const incomeX = 58
  const expenseX = 198
  const incomeH = (income / max) * maxH
  const expenseH = (expenses / max) * maxH

  return (
    <div className="table-wrap" style={{ maxWidth: 420, padding: '18px 20px 14px', marginBottom: 24 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Income ${income}, expenses ${expenses}, net ${net}`}>
        <line x1={20} y1={baseline} x2={W - 20} y2={baseline} stroke="var(--line)" />

        <rect x={incomeX} y={baseline - incomeH} width={barW} height={incomeH} rx={5} fill="var(--sage)" />
        <text x={incomeX + barW / 2} y={baseline - incomeH - 8} textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--ink)">
          {fmtMoney(income)}
        </text>
        <text x={incomeX + barW / 2} y={baseline + 18} textAnchor="middle" fontSize="12" fill="var(--ink-soft)">
          Income
        </text>

        <rect x={expenseX} y={baseline - expenseH} width={barW} height={expenseH} rx={5} fill="var(--clay)" />
        <text x={expenseX + barW / 2} y={baseline - expenseH - 8} textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--ink)">
          {fmtMoney(expenses)}
        </text>
        <text x={expenseX + barW / 2} y={baseline + 18} textAnchor="middle" fontSize="12" fill="var(--ink-soft)">
          Expenses
        </text>
      </svg>

      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <div className="stat-label">Net income · {monthLabel}</div>
        <div style={{ fontSize: 24, fontWeight: 600, color: net < 0 ? 'var(--clay)' : 'var(--sage)' }}>
          {net < 0 ? `-${fmtMoney(-net)}` : fmtMoney(net)}
        </div>
      </div>
    </div>
  )
}

// distinct earthy tones for the pie slices, in category order
const PIE_COLORS = ['#b98a3d', '#5f7f5c', '#a64b3c', '#7a6a55', '#4a5d57']

// Pie chart of the month's expenses by category, with a legend showing each
// slice's share of the total. Inline SVG (no chart library). Zero-value
// categories are dropped so the legend only lists what was actually spent.
function ExpensePieChart({ slices, total }: { slices: { label: string; value: number }[]; total: number }) {
  const data = slices
    .map((s, i) => ({ ...s, color: PIE_COLORS[i % PIE_COLORS.length] }))
    .filter((s) => s.value > 0)

  if (total <= 0 || data.length === 0) {
    return (
      <div className="table-wrap" style={{ maxWidth: 560, padding: '18px 20px' }}>
        <div className="hint">No expenses recorded for this month yet.</div>
      </div>
    )
  }

  const cx = 90
  const cy = 90
  const r = 84
  const point = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]

  let angle = -Math.PI / 2 // start at 12 o'clock
  const wedges = data.map((s) => {
    const frac = s.value / total
    const start = angle
    const end = angle + frac * Math.PI * 2
    angle = end
    const [x1, y1] = point(start)
    const [x2, y2] = point(end)
    const large = end - start > Math.PI ? 1 : 0
    const path = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
    return { ...s, frac, path }
  })

  return (
    <div
      className="table-wrap"
      style={{ maxWidth: 560, padding: 20, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}
    >
      <svg viewBox="0 0 180 180" width="170" height="170" role="img" aria-label="Expense breakdown by category">
        {wedges.length === 1 ? (
          <circle cx={cx} cy={cy} r={r} fill={wedges[0].color} />
        ) : (
          wedges.map((w, i) => <path key={i} d={w.path} fill={w.color} />)
        )}
      </svg>
      <div style={{ flex: 1, minWidth: 220 }}>
        {wedges.map((w, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: w.color, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{w.label}</span>
            <span style={{ fontWeight: 600, minWidth: 42, textAlign: 'right' }}>{Math.round(w.frac * 100)}%</span>
            <span className="sub-cell" style={{ minWidth: 84, textAlign: 'right' }}>{fmtMoney(w.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CategoryEntries({
  category,
  entries,
  month,
  onEdit,
  onDelete,
  onAdd,
}: {
  category: ExpenseCategory
  entries: Expense[]
  month: string
  onEdit: (e: Expense) => void
  onDelete: (e: Expense) => void
  onAdd: () => void
}) {
  const total = entries.reduce((s, e) => s + Number(e.amount || 0), 0)
  return (
    <div className="table-wrap">
      {entries.length === 0 ? (
        <div className="empty-state">
          <h3>No {CATEGORY_LABEL[category].toLowerCase()} logged for {fmtMonth(monthInputToDate(month))}</h3>
          <p>
            <button className="btn btn-primary btn-sm" onClick={onAdd}>
              + Add {CATEGORY_LABEL[category].toLowerCase()}
            </button>
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>
                  {e.label || <span className="sub-cell">—</span>}
                  {e.notes && <div className="sub-cell">{e.notes}</div>}
                </td>
                <td style={{ textAlign: 'right' }}>{fmtMoney(e.amount)}</td>
                <td>
                  <div className="row-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => onEdit(e)}>
                      Edit
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => onDelete(e)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ fontWeight: 600 }}>{CATEGORY_LABEL[category]} total</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(total)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}

function ExpenseModal({
  initial,
  defaultMonth,
  defaultCategory,
  createdBy,
  onClose,
  onSaved,
}: {
  initial: Expense | null
  defaultMonth: string
  defaultCategory: ExpenseCategory
  createdBy: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()

  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? defaultCategory)
  const [label, setLabel] = useState(initial?.label ?? '')
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '')
  const [month, setMonth] = useState(initial ? initial.expense_month.slice(0, 7) : defaultMonth)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const amountNum = Number(amount)
    if (!amountNum || amountNum <= 0) {
      showToast('Enter an amount greater than 0.')
      return
    }
    const payload = {
      category,
      label: label.trim() || null,
      amount: amountNum,
      expense_month: monthInputToDate(month),
      notes: notes.trim() || null,
    }
    setSaving(true)
    // edits use an optimistic-locking guard so two admins can't silently
    // overwrite each other; a fresh insert has nothing to conflict with
    const errorMsg = initial
      ? (await updateGuarded('expenses', initial, payload)).error
      : (await supabase.from('expenses').insert({ ...payload, created_by: createdBy })).error?.message ?? null
    setSaving(false)
    if (errorMsg) {
      showToast(errorMsg)
      return
    }
    showToast(initial ? 'Expense updated.' : 'Expense added.')
    onSaved()
  }

  return (
    <Modal
      title={initial ? 'Edit expense' : 'Add expense'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Add expense'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label>Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Description (optional)</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Juan (caretaker), PLDT, etc."
          autoFocus
        />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Amount (₱)</label>
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Notes (optional)</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  )
}

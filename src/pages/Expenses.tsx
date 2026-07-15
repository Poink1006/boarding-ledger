import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Modal } from '../components/Modal'
import { SkeletonTable } from '../components/Skeleton'
import { getCached, setCached, hasCached } from '../lib/cache'
import { fmtMoney, fmtMonth, todayStr, monthInputToDate } from '../lib/format'
import type { Database, ExpenseCategory } from '../lib/database.types'

type Expense = Database['public']['Tables']['expenses']['Row']
type UtilityBill = Database['public']['Tables']['utility_bills']['Row']

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

type ExpenseModalState = { initial: Expense | null } | null

const CACHE_KEY = 'expenses'
interface ExpensesData {
  expenses: Expense[]
  utilityBills: UtilityBill[]
}

export function Expenses() {
  const { profile } = useAuth()
  const { showToast } = useToast()

  const cached = getCached<ExpensesData>(CACHE_KEY)
  const [expenses, setExpenses] = useState<Expense[]>(cached?.expenses ?? [])
  const [utilityBills, setUtilityBills] = useState<UtilityBill[]>(cached?.utilityBills ?? [])
  const [loading, setLoading] = useState(!cached)

  const currentMonth = todayStr().slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const [modal, setModal] = useState<ExpenseModalState>(null)

  const loadAll = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true)
      const [expensesRes, utilityBillsRes] = await Promise.all([
        supabase.from('expenses').select('*').is('deleted_at', null),
        supabase.from('utility_bills').select('*'),
      ])
      if (expensesRes.error) showToast(expensesRes.error.message)
      if (utilityBillsRes.error) showToast(utilityBillsRes.error.message)
      const data: ExpensesData = {
        expenses: expensesRes.data ?? [],
        utilityBills: utilityBillsRes.data ?? [],
      }
      setCached(CACHE_KEY, data)
      setExpenses(data.expenses)
      setUtilityBills(data.utilityBills)
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

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Expenses</h2>
          <div className="page-sub">Money going out — salaries, internet, supplies, and apartment utilities</div>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ initial: null })}>
          + Add expense
        </button>
      </div>

      <div className="toolbar">
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {fmtMonth(monthInputToDate(m))}
            </option>
          ))}
        </select>
      </div>

      {/* month summary: category subtotals + the live utilities line + grand total */}
      <div className="table-wrap" style={{ marginBottom: 28, maxWidth: 560 }}>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {categoryTotals.map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td style={{ textAlign: 'right' }}>{fmtMoney(c.total)}</td>
              </tr>
            ))}
            <tr>
              <td>
                Apartment utilities{' '}
                <Link to="/utilities" className="hint" style={{ textDecoration: 'underline' }}>
                  (from Utilities)
                </Link>
              </td>
              <td style={{ textAlign: 'right' }}>{fmtMoney(utilitiesTotal)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td style={{ fontWeight: 600 }}>Total this month</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="section-title">Entries · {fmtMonth(monthInputToDate(month))}</div>
      <div className="table-wrap">
        {monthExpenses.length === 0 ? (
          <div className="empty-state">
            <h3>No expenses logged for this month</h3>
            <p>Add salaries, internet, cleaning materials, or other costs. Apartment utilities are pulled in automatically above.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {monthExpenses.map((e) => (
                <tr key={e.id}>
                  <td>{CATEGORY_LABEL[e.category]}</td>
                  <td>
                    {e.label || <span className="sub-cell">—</span>}
                    {e.notes && <div className="sub-cell">{e.notes}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtMoney(e.amount)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setModal({ initial: e })}>
                        Edit
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteExpense(e)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <ExpenseModal
          initial={modal.initial}
          defaultMonth={month}
          createdBy={profile?.id ?? null}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            loadAll(true)
          }}
        />
      )}
    </>
  )
}

function ExpenseModal({
  initial,
  defaultMonth,
  createdBy,
  onClose,
  onSaved,
}: {
  initial: Expense | null
  defaultMonth: string
  createdBy: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()

  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? 'salary')
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
    const { error } = initial
      ? await supabase.from('expenses').update(payload).eq('id', initial.id)
      : await supabase.from('expenses').insert({ ...payload, created_by: createdBy })
    setSaving(false)
    if (error) {
      showToast(error.message)
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

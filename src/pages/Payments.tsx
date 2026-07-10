import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Modal } from '../components/Modal'
import { computeTenantBalance } from '../lib/balance'
import { naturalSort } from '../lib/rooms'
import { fmtMoney, fmtDate, todayStr } from '../lib/format'
import type { Database, PaymentType } from '../lib/database.types'

type Tenant = Database['public']['Tables']['tenants']['Row']
type Apartment = Database['public']['Tables']['apartments']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type Payment = Database['public']['Tables']['payments']['Row']
type UtilityBill = Database['public']['Tables']['utility_bills']['Row']
type AppSettings = Database['public']['Tables']['app_settings']['Row']
type RateChange = Database['public']['Tables']['tenant_rate_changes']['Row']

type PaymentModalState = { tenantId: string; initial: Payment | null; defaultType: PaymentType } | null
type HistoryModalState = { tenant: Tenant } | null

function BalanceBadge({ value, zeroLabel = 'Paid up' }: { value: number; zeroLabel?: string }) {
  if (value < 0) return <span className="badge badge-overdue">Owes {fmtMoney(-value)}</span>
  if (value > 0) return <span className="badge badge-paid">Credit {fmtMoney(value)}</span>
  return <span className="badge badge-pending">{zeroLabel}</span>
}

export function Payments() {
  const { isAdmin } = useAuth()
  const { showToast } = useToast()

  const [tenants, setTenants] = useState<Tenant[]>([])
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [utilityBills, setUtilityBills] = useState<UtilityBill[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [rateHistory, setRateHistory] = useState<RateChange[]>([])
  const [loading, setLoading] = useState(true)

  const [activeTab, setActiveTab] = useState<PaymentType>('rent')
  const [search, setSearch] = useState('')
  const [tenantStatusFilter, setTenantStatusFilter] = useState<'current' | 'pending' | 'active' | 'inactive' | 'all'>(
    'current',
  )
  const [apartmentFilter, setApartmentFilter] = useState('')
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'overdue' | 'credit'>('all')

  const [paymentModal, setPaymentModal] = useState<PaymentModalState>(null)
  const [historyModal, setHistoryModal] = useState<HistoryModalState>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [tenantsRes, apartmentsRes, roomsRes, paymentsRes, utilityBillsRes, settingsRes, rateHistoryRes] =
      await Promise.all([
        supabase.from('tenants').select('*'),
        supabase.from('apartments').select('*'),
        supabase.from('rooms').select('*'),
        supabase.from('payments').select('*'),
        supabase.from('utility_bills').select('*'),
        supabase.from('app_settings').select('*').single(),
        supabase.from('tenant_rate_changes').select('*'),
      ])
    if (tenantsRes.error) showToast(tenantsRes.error.message)
    if (apartmentsRes.error) showToast(apartmentsRes.error.message)
    if (roomsRes.error) showToast(roomsRes.error.message)
    if (paymentsRes.error) showToast(paymentsRes.error.message)
    if (utilityBillsRes.error) showToast(utilityBillsRes.error.message)
    if (settingsRes.error) showToast(settingsRes.error.message)
    if (rateHistoryRes.error) showToast(rateHistoryRes.error.message)

    setTenants(tenantsRes.data ?? [])
    setApartments([...(apartmentsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.name, b.name)))
    setRooms(roomsRes.data ?? [])
    setPayments(paymentsRes.data ?? [])
    setUtilityBills(utilityBillsRes.data ?? [])
    setSettings(settingsRes.data ?? null)
    setRateHistory(rateHistoryRes.data ?? [])
    setLoading(false)
  }, [showToast])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  async function deletePayment(payment: Payment) {
    if (!window.confirm('Delete this payment? This will reduce the tenant’s balance.')) return
    const { error } = await supabase.from('payments').delete().eq('id', payment.id)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Payment deleted.')
    loadAll()
  }

  if (loading) {
    return (
      <div className="empty-state">
        <h3>Loading payments…</h3>
      </div>
    )
  }

  const utilityContext = { rooms, tenants, utilityBills, settings }

  const rows = tenants
    .filter((t) => {
      if (tenantStatusFilter === 'all') return true
      if (tenantStatusFilter === 'current') return t.status !== 'inactive'
      return t.status === tenantStatusFilter
    })
    .filter((t) => {
      if (!apartmentFilter) return true
      const room = rooms.find((r) => r.id === t.room_id)
      return room?.apartment_id === apartmentFilter
    })
    .filter((t) => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      const room = rooms.find((r) => r.id === t.room_id)
      return `${t.first_name} ${t.last_name} ${room?.label ?? ''}`.toLowerCase().includes(q)
    })
    .map((t) => ({ tenant: t, balance: computeTenantBalance(t, payments, rateHistory, utilityContext) }))
    .filter(({ balance }) => {
      if (balanceFilter === 'overdue') return balance.balance < 0
      if (balanceFilter === 'credit') return balance.balance > 0
      return true
    })
    .sort((a, b) => a.balance.balance - b.balance.balance)

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Payments</h2>
          <div className="page-sub">Running balance per tenant — log a payment, the app applies it automatically</div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setPaymentModal({ tenantId: '', initial: null, defaultType: activeTab })}
        >
          + Log payment
        </button>
      </div>

      <div className="tab-bar-segmented">
        <button
          type="button"
          className={`tab-item${activeTab === 'rent' ? ' active' : ''}`}
          onClick={() => setActiveTab('rent')}
        >
          Rent
        </button>
        <button
          type="button"
          className={`tab-item${activeTab === 'utility' ? ' active' : ''}`}
          onClick={() => setActiveTab('utility')}
        >
          Utilities
        </button>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search tenant or room…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={tenantStatusFilter} onChange={(e) => setTenantStatusFilter(e.target.value as typeof tenantStatusFilter)}>
          <option value="current">Current residents</option>
          <option value="pending">Reserved</option>
          <option value="active">Active</option>
          <option value="inactive">Moved out</option>
          <option value="all">All tenants</option>
        </select>
        <select value={apartmentFilter} onChange={(e) => setApartmentFilter(e.target.value)}>
          <option value="">All apartments</option>
          {apartments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value as typeof balanceFilter)}>
          <option value="all">All balances</option>
          <option value="overdue">Overdue only</option>
          <option value="credit">Credit only</option>
        </select>
      </div>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty-state">
            <h3>No tenants to show</h3>
            <p>Log a payment once a tenant is added to start tracking their balance.</p>
          </div>
        ) : (
          <table>
            <thead>
              {activeTab === 'rent' ? (
                <tr>
                  <th>Tenant</th>
                  <th>Room</th>
                  <th>Monthly Rate</th>
                  <th>Months Billed</th>
                  <th>Rent Balance</th>
                  <th></th>
                </tr>
              ) : (
                <tr>
                  <th>Tenant</th>
                  <th>Room</th>
                  <th>Utility Due</th>
                  <th>Utility Paid</th>
                  <th>Utility Balance</th>
                  <th></th>
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map(({ tenant, balance }) => {
                const room = rooms.find((r) => r.id === tenant.room_id)
                return (
                  <tr key={tenant.id}>
                    <td>
                      <div className="name-cell">
                        {tenant.first_name} {tenant.last_name}
                      </div>
                      {activeTab === 'rent' && balance.nextDueDate && (
                        <div className="sub-cell">Next due {fmtDate(balance.nextDueDate)}</div>
                      )}
                    </td>
                    <td className="mono">{room ? room.label : '—'}</td>
                    {activeTab === 'rent' ? (
                      <>
                        <td>{fmtMoney(tenant.monthly_rate)}</td>
                        <td>{balance.cyclesBilled}</td>
                        <td>
                          <BalanceBadge value={balance.rentBalance} />
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{fmtMoney(balance.utilityDue)}</td>
                        <td>{fmtMoney(balance.utilityPaid)}</td>
                        <td>
                          {balance.utilityDue === 0 && balance.utilityPaid === 0 ? (
                            <span className="sub-cell">—</span>
                          ) : (
                            <BalanceBadge value={balance.utilityBalance} />
                          )}
                        </td>
                      </>
                    )}
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => setPaymentModal({ tenantId: tenant.id, initial: null, defaultType: activeTab })}
                        >
                          + Payment
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setHistoryModal({ tenant })}>
                          History
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {paymentModal && (
        <PaymentModal
          tenantId={paymentModal.tenantId}
          initial={paymentModal.initial}
          defaultType={paymentModal.defaultType}
          tenants={tenants}
          rooms={rooms}
          onClose={() => setPaymentModal(null)}
          onSaved={() => {
            setPaymentModal(null)
            loadAll()
          }}
        />
      )}

      {historyModal && (
        <HistoryModal
          tenant={historyModal.tenant}
          payments={payments.filter((p) => p.tenant_id === historyModal.tenant.id)}
          balance={computeTenantBalance(historyModal.tenant, payments, rateHistory, utilityContext)}
          isAdmin={isAdmin}
          onClose={() => setHistoryModal(null)}
          onLogPayment={() => setPaymentModal({ tenantId: historyModal.tenant.id, initial: null, defaultType: activeTab })}
          onEdit={(payment) =>
            setPaymentModal({ tenantId: historyModal.tenant.id, initial: payment, defaultType: payment.payment_type })
          }
          onDelete={deletePayment}
        />
      )}
    </>
  )
}

function HistoryModal({
  tenant,
  payments,
  balance,
  isAdmin,
  onClose,
  onLogPayment,
  onEdit,
  onDelete,
}: {
  tenant: Tenant
  payments: Payment[]
  balance: ReturnType<typeof computeTenantBalance>
  isAdmin: boolean
  onClose: () => void
  onLogPayment: () => void
  onEdit: (payment: Payment) => void
  onDelete: (payment: Payment) => void
}) {
  const sorted = [...payments].sort((a, b) => (a.date_paid < b.date_paid ? 1 : -1))

  return (
    <Modal
      title={`${tenant.first_name} ${tenant.last_name} — payment history`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" onClick={onLogPayment}>
            + Log payment
          </button>
        </>
      }
    >
      <div className="fieldset-title" style={{ marginTop: 0 }}>
        Rent
      </div>
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Rent Due</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            {fmtMoney(balance.rentDue)}
          </div>
          <div className="stat-note">{balance.cyclesBilled} month(s) billed</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Rent Paid</div>
          <div className="stat-value sage" style={{ fontSize: 20 }}>
            {fmtMoney(balance.rentPaid)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Rent Balance</div>
          <div className={`stat-value ${balance.rentBalance < 0 ? 'clay' : 'sage'}`} style={{ fontSize: 20 }}>
            {balance.rentBalance < 0 ? `-${fmtMoney(-balance.rentBalance)}` : fmtMoney(balance.rentBalance)}
          </div>
        </div>
      </div>

      <div className="fieldset-title">Utilities</div>
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Utility Due</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            {fmtMoney(balance.utilityDue)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Utility Paid</div>
          <div className="stat-value sage" style={{ fontSize: 20 }}>
            {fmtMoney(balance.utilityPaid)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Utility Balance</div>
          <div className={`stat-value ${balance.utilityBalance < 0 ? 'clay' : 'sage'}`} style={{ fontSize: 20 }}>
            {balance.utilityBalance < 0 ? `-${fmtMoney(-balance.utilityBalance)}` : fmtMoney(balance.utilityBalance)}
          </div>
        </div>
      </div>

      <div className="fieldset-title">Monthly rent breakdown</div>
      {balance.cycles.length === 0 ? (
        <div className="hint" style={{ marginBottom: 16 }}>
          No billing cycles yet — this starts once a move-in date is set.
        </div>
      ) : (
        <div className="table-wrap" style={{ marginBottom: 20 }}>
          <table>
            <thead>
              <tr>
                <th>Cycle starting</th>
                <th>Rate</th>
                <th>Applied</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {balance.cycles.map((cycle) => (
                <tr key={cycle.index}>
                  <td className="mono">{fmtDate(cycle.anchorDate)}</td>
                  <td>{fmtMoney(cycle.rate)}</td>
                  <td>{fmtMoney(cycle.appliedAmount)}</td>
                  <td>
                    <span
                      className={`badge ${
                        cycle.status === 'paid' ? 'badge-paid' : cycle.status === 'partial' ? 'badge-partial' : 'badge-overdue'
                      }`}
                    >
                      {cycle.status === 'paid' ? 'Paid' : cycle.status === 'partial' ? 'Partial' : 'Unpaid'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="fieldset-title">Payment transactions</div>
      {sorted.length === 0 ? (
        <div className="hint">No payments logged yet.</div>
      ) : (
        <div className="room-list">
          {sorted.map((p) => (
            <div className="room-row" key={p.id} style={{ cursor: 'default' }}>
              <div>
                <span className="room-id">{fmtMoney(p.amount)}</span>
                <span className="room-type">{fmtDate(p.date_paid)}</span>
                <span className={`badge ${p.payment_type === 'utility' ? 'badge-partial' : 'badge-active'}`} style={{ marginLeft: 8 }}>
                  {p.payment_type === 'utility' ? 'Utility' : 'Rent'}
                </span>
                {p.notes && <div className="sub-cell">{p.notes}</div>}
              </div>
              <div className="row-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => onEdit(p)}>
                  Edit
                </button>
                {isAdmin && (
                  <button className="btn btn-danger btn-sm" onClick={() => onDelete(p)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

function PaymentModal({
  tenantId,
  initial,
  defaultType,
  tenants,
  rooms,
  onClose,
  onSaved,
}: {
  tenantId: string
  initial: Payment | null
  defaultType: PaymentType
  tenants: Tenant[]
  rooms: Room[]
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()

  const [selectedTenantId, setSelectedTenantId] = useState(initial?.tenant_id ?? tenantId)
  const [paymentType, setPaymentType] = useState<PaymentType>(initial?.payment_type ?? defaultType)
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '')
  const [datePaid, setDatePaid] = useState(initial?.date_paid ?? todayStr())
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [saving, setSaving] = useState(false)

  const tenantLocked = !!initial || !!tenantId

  async function handleSave() {
    if (!selectedTenantId) {
      showToast('Please select a tenant.')
      return
    }
    const amountNum = Number(amount)
    if (!amountNum || amountNum <= 0) {
      showToast('Enter an amount greater than 0.')
      return
    }

    const payload = {
      tenant_id: selectedTenantId,
      payment_type: paymentType,
      amount: amountNum,
      date_paid: datePaid || todayStr(),
      notes: notes.trim() || null,
    }

    setSaving(true)
    const { error } = initial
      ? await supabase.from('payments').update(payload).eq('id', initial.id)
      : await supabase.from('payments').insert(payload)
    setSaving(false)
    if (error) {
      showToast(error.message)
      return
    }
    showToast(initial ? 'Payment updated.' : 'Payment logged.')
    onSaved()
  }

  return (
    <Modal
      title={initial ? 'Edit payment' : 'Log payment'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Log payment'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label>Tenant</label>
        <select
          value={selectedTenantId}
          onChange={(e) => setSelectedTenantId(e.target.value)}
          disabled={tenantLocked}
        >
          <option value="">— Select tenant —</option>
          {tenants.map((t) => {
            const room = rooms.find((r) => r.id === t.room_id)
            return (
              <option key={t.id} value={t.id}>
                {t.first_name} {t.last_name} — {room ? room.label : 'unassigned'}
              </option>
            )
          })}
        </select>
      </div>
      <div className="form-group">
        <label>What's this payment for?</label>
        <select value={paymentType} onChange={(e) => setPaymentType(e.target.value as PaymentType)}>
          <option value="rent">Rent</option>
          <option value="utility">Utilities</option>
        </select>
        <div className="hint">Rent and utility payments are tracked as separate balances.</div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Amount (₱)</label>
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <div className="form-group">
          <label>Date paid</label>
          <input type="date" value={datePaid} onChange={(e) => setDatePaid(e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Notes</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. covers 3 months in advance" />
      </div>
    </Modal>
  )
}

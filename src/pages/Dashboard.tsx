import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { effectiveCapacity, naturalSort } from '../lib/rooms'
import { computeTenantBalance } from '../lib/balance'
import { buildReminder, reminderMailto } from '../lib/reminder'
import { fmtMoney, todayStr } from '../lib/format'
import { Modal } from '../components/Modal'
import { SkeletonStatGrid } from '../components/Skeleton'
import { getCached, setCached, hasCached } from '../lib/cache'
import type { Database } from '../lib/database.types'

type Apartment = Database['public']['Tables']['apartments']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type Payment = Database['public']['Tables']['payments']['Row']
type UtilityBill = Database['public']['Tables']['utility_bills']['Row']
type AppSettings = Database['public']['Tables']['app_settings']['Row']
type RateChange = Database['public']['Tables']['tenant_rate_changes']['Row']

const CACHE_KEY = 'dashboard'
interface DashboardData {
  apartments: Apartment[]
  rooms: Room[]
  tenants: Tenant[]
  payments: Payment[]
  utilityBills: UtilityBill[]
  settings: AppSettings | null
  rateHistory: RateChange[]
}

// how many rent cycles a tenant hasn't fully covered — a plain-language sense of
// how far behind they are, counting partials as behind
function rentMonthsBehind(b: ReturnType<typeof computeTenantBalance>) {
  return b.cycles.filter((c) => c.status !== 'paid').length
}

export function Dashboard() {
  const { isAdmin } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const cached = getCached<DashboardData>(CACHE_KEY)
  const [apartments, setApartments] = useState<Apartment[]>(cached?.apartments ?? [])
  const [rooms, setRooms] = useState<Room[]>(cached?.rooms ?? [])
  const [tenants, setTenants] = useState<Tenant[]>(cached?.tenants ?? [])
  const [payments, setPayments] = useState<Payment[]>(cached?.payments ?? [])
  const [utilityBills, setUtilityBills] = useState<UtilityBill[]>(cached?.utilityBills ?? [])
  const [settings, setSettings] = useState<AppSettings | null>(cached?.settings ?? null)
  const [rateHistory, setRateHistory] = useState<RateChange[]>(cached?.rateHistory ?? [])
  const [loading, setLoading] = useState(!cached)
  const [reminderFor, setReminderFor] = useState<{ tenant: Tenant; balance: ReturnType<typeof computeTenantBalance> } | null>(null)

  const loadAll = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true)
      const [apartmentsRes, roomsRes, tenantsRes, paymentsRes, utilityBillsRes, settingsRes, rateHistoryRes] =
        await Promise.all([
          supabase.from('apartments').select('*'),
          supabase.from('rooms').select('*'),
          supabase.from('tenants').select('*').is('deleted_at', null),
          supabase.from('payments').select('*').is('deleted_at', null),
          supabase.from('utility_bills').select('*'),
          supabase.from('app_settings').select('*').single(),
          supabase.from('tenant_rate_changes').select('*'),
        ])
      if (apartmentsRes.error) showToast(apartmentsRes.error.message)
      if (roomsRes.error) showToast(roomsRes.error.message)
      if (tenantsRes.error) showToast(tenantsRes.error.message)
      if (paymentsRes.error) showToast(paymentsRes.error.message)
      if (utilityBillsRes.error) showToast(utilityBillsRes.error.message)
      if (settingsRes.error) showToast(settingsRes.error.message)
      if (rateHistoryRes.error) showToast(rateHistoryRes.error.message)

      const data: DashboardData = {
        apartments: [...(apartmentsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.name, b.name)),
        rooms: [...(roomsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.label, b.label)),
        tenants: tenantsRes.data ?? [],
        payments: paymentsRes.data ?? [],
        utilityBills: utilityBillsRes.data ?? [],
        settings: settingsRes.data ?? null,
        rateHistory: rateHistoryRes.data ?? [],
      }
      setCached(CACHE_KEY, data)
      setApartments(data.apartments)
      setRooms(data.rooms)
      setTenants(data.tenants)
      setPayments(data.payments)
      setUtilityBills(data.utilityBills)
      setSettings(data.settings)
      setRateHistory(data.rateHistory)
      setLoading(false)
    },
    [showToast],
  )

  useEffect(() => {
    loadAll(hasCached(CACHE_KEY))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAll])

  if (loading) {
    return (
      <>
        <div className="page-head">
          <div>
            <h2>Dashboard</h2>
          </div>
        </div>
        <SkeletonStatGrid count={5} />
      </>
    )
  }

  const occupyingTenants = tenants.filter((t) => t.status !== 'inactive')
  const activeTenants = tenants.filter((t) => t.status === 'active')
  const pendingTenants = tenants.filter((t) => t.status === 'pending')

  const totalBeds = rooms.reduce((s, r) => s + effectiveCapacity(r), 0)
  const occupiedBeds = occupyingTenants.length
  const occupancyRate = totalBeds ? Math.round((occupiedBeds / totalBeds) * 100) : 0

  const expectedMonthly = occupyingTenants.reduce((s, t) => s + Number(t.monthly_rate || 0), 0)

  const currentMonth = todayStr().slice(0, 7)
  const paymentsThisMonth = payments.filter((p) => p.date_paid.slice(0, 7) === currentMonth)
  const collectedThisMonth = paymentsThisMonth.reduce((s, p) => s + Number(p.amount || 0), 0)

  const utilityContext = { rooms, tenants, utilityBills, settings }
  const balancePairs = occupyingTenants.map((t) => ({ tenant: t, balance: computeTenantBalance(t, payments, rateHistory, utilityContext) }))
  const lowBalanceCount = balancePairs.filter((p) => p.balance.balance < 0).length
  const totalOwed = balancePairs.reduce((s, p) => (p.balance.balance < 0 ? s - p.balance.balance : s), 0)

  // tenants who owe money, most owed first — the daily "who to chase" worklist
  const arrears = balancePairs
    .filter((p) => p.balance.balance < 0)
    .sort((a, b) => a.balance.balance - b.balance.balance)

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Dashboard</h2>
          <div className="page-sub">
            Overview across {apartments.length} apartment{apartments.length === 1 ? '' : 's'} ·{' '}
            {new Date().toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Occupied Beds</div>
          <div className="stat-value">
            {occupiedBeds} <span style={{ fontSize: 16, color: 'var(--ink-soft)' }}>/ {totalBeds}</span>
          </div>
          <div className="stat-note">{occupancyRate}% occupancy</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Vacant Beds</div>
          <div className="stat-value sage">{totalBeds - occupiedBeds}</div>
          <div className="stat-note">across {rooms.length} room{rooms.length === 1 ? '' : 's'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Tenants</div>
          <div className="stat-value">{activeTenants.length}</div>
          <div className="stat-note">
            {pendingTenants.length} reserved · {tenants.length} total on record
          </div>
        </div>
        {isAdmin && (
          <div className="stat-card">
            <div className="stat-label">Expected Monthly Rent</div>
            <div className="stat-value brass">{fmtMoney(expectedMonthly)}</div>
            <div className="stat-note">from {occupyingTenants.length} current tenant(s)</div>
          </div>
        )}
        {isAdmin && (
          <div className="stat-card">
            <div className="stat-label">Collected This Month</div>
            <div className="stat-value sage">{fmtMoney(collectedThisMonth)}</div>
            <div className="stat-note">
              {paymentsThisMonth.length} payment{paymentsThisMonth.length === 1 ? '' : 's'} logged
            </div>
          </div>
        )}
        <div className="stat-card">
          <div className="stat-label">Low Balance Tenants</div>
          <div className={`stat-value ${lowBalanceCount ? 'clay' : ''}`}>{lowBalanceCount}</div>
          <div className="stat-note">{totalOwed > 0 ? `${fmtMoney(totalOwed)} total owed` : 'all caught up'}</div>
        </div>
      </div>

      {arrears.length > 0 && (
        <>
          <div className="section-title">
            Needs attention · {arrears.length} tenant{arrears.length === 1 ? '' : 's'} behind
          </div>
          <div className="table-wrap" style={{ marginBottom: 28 }}>
            <table>
              <thead>
                <tr>
                  <th>Tenant No.</th>
                  <th>Tenant</th>
                  <th>Room</th>
                  <th>Behind</th>
                  <th>Rent owed</th>
                  <th>Utility owed</th>
                  <th>Total owed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {arrears.map(({ tenant, balance }) => {
                  const room = rooms.find((r) => r.id === tenant.room_id)
                  const rentOwed = balance.rentBalance < 0 ? -balance.rentBalance : 0
                  const utilityOwed = balance.utilityBalance < 0 ? -balance.utilityBalance : 0
                  const behind = rentMonthsBehind(balance)
                  return (
                    <tr
                      key={tenant.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate('/payments')}
                      title="Open Payments to log a payment"
                    >
                      <td className="mono">{tenant.tenant_number}</td>
                      <td className="name-cell">
                        {tenant.first_name} {tenant.last_name}
                      </td>
                      <td className="mono">{room ? room.label : '—'}</td>
                      <td>
                        {behind > 0 ? (
                          <span className="badge badge-overdue">
                            {behind} mo{behind === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className="sub-cell">utilities only</span>
                        )}
                      </td>
                      <td>{rentOwed > 0 ? fmtMoney(rentOwed) : <span className="sub-cell">—</span>}</td>
                      <td>{utilityOwed > 0 ? fmtMoney(utilityOwed) : <span className="sub-cell">—</span>}</td>
                      <td>
                        <span className="badge badge-overdue">{fmtMoney(-balance.balance)}</span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setReminderFor({ tenant, balance })}>
                          Remind
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {reminderFor && (
        <ReminderModal
          tenant={reminderFor.tenant}
          balance={reminderFor.balance}
          settings={settings}
          onClose={() => setReminderFor(null)}
        />
      )}
    </>
  )
}

function ReminderModal({
  tenant,
  balance,
  settings,
  onClose,
}: {
  tenant: Tenant
  balance: ReturnType<typeof computeTenantBalance>
  settings: AppSettings | null
  onClose: () => void
}) {
  const { showToast } = useToast()
  const initial = buildReminder(tenant, balance, settings)
  // editable so the operator can tweak wording before sending
  const [body, setBody] = useState(initial.body)
  const mailto = reminderMailto(tenant.email, { subject: initial.subject, body })

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(body)
      showToast('Reminder copied to clipboard.')
    } catch {
      showToast('Could not copy — select the text and copy manually.')
    }
  }

  return (
    <Modal
      title={`Remind ${tenant.first_name} ${tenant.last_name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-ghost" onClick={copyMessage}>
            Copy message
          </button>
          {mailto ? (
            <a className="btn btn-primary" href={mailto}>
              Open in email
            </a>
          ) : (
            <button className="btn btn-primary" disabled title="No email on file for this tenant">
              Open in email
            </button>
          )}
        </>
      }
    >
      <div className="form-group">
        <label>To</label>
        <input value={tenant.email ?? ''} disabled placeholder="No email on file — use Copy message instead" />
      </div>
      <div className="form-group">
        <label>Subject</label>
        <input value={initial.subject} disabled />
      </div>
      <div className="form-group">
        <label>Message</label>
        <textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="hint">
          {mailto
            ? 'Opens your email app with this message ready to send — review and hit send there.'
            : 'This tenant has no email on file. Add one on the Tenants page, or use Copy message to paste it elsewhere.'}
        </div>
      </div>
    </Modal>
  )
}

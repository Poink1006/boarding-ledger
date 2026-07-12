import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Modal } from '../components/Modal'
import { ActionMenu } from '../components/ActionMenu'
import { effectiveCapacity, effectiveRate, naturalSort } from '../lib/rooms'
import { fmtMoney, fmtDate, fmtDateShort, addMonths, todayStr } from '../lib/format'
import { occupiesBed, TENANT_STATUS_LABEL, TENANT_STATUS_BADGE } from '../lib/tenantStatus'
import { DEPOSIT_STATUS_LABEL, DEPOSIT_STATUS_BADGE } from '../lib/depositStatus'
import { computeTenantBalance } from '../lib/balance'
import { SkeletonTable } from '../components/Skeleton'
import { getCached, setCached, hasCached } from '../lib/cache'
import type { Database } from '../lib/database.types'

type Apartment = Database['public']['Tables']['apartments']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type AppSettings = Database['public']['Tables']['app_settings']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type Payment = Database['public']['Tables']['payments']['Row']
type UtilityBill = Database['public']['Tables']['utility_bills']['Row']
type RoomPriceGroup = Database['public']['Tables']['room_price_groups']['Row']
type RateChange = Database['public']['Tables']['tenant_rate_changes']['Row']

type TenantModalState = { mode: 'add' } | { mode: 'edit'; tenant: Tenant } | null
type DepositModalState = { tenant: Tenant } | null
type MoveModalState = { tenant: Tenant } | null
type AddDepositModalState = { tenant: Tenant } | null

function occupiedBedIndexes(tenants: Tenant[], roomId: string, excludeId?: string) {
  const s = new Set<number>()
  for (const t of tenants) {
    if (occupiesBed(t.status) && t.room_id === roomId && t.id !== excludeId && t.bed_index != null) {
      s.add(t.bed_index)
    }
  }
  return s
}

function firstVacantBedIndex(effCap: number, occupied: Set<number>) {
  for (let i = 0; i < effCap; i++) {
    if (!occupied.has(i)) return i
  }
  return null
}

function previewTenantNumber(dateApplied: string, tenants: Tenant[]) {
  const d = dateApplied ? new Date(dateApplied + 'T00:00:00') : new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  const prefix = `${mm}${yy}`
  const count = tenants.filter((t) => t.tenant_number.startsWith(prefix + '-')).length
  return `${prefix}-${String(count + 1).padStart(3, '0')}`
}

async function insertTenantWithRetry(
  basePayload: Omit<Database['public']['Tables']['tenants']['Insert'], 'tenant_number'>,
  dateApplied: string,
  tenantsSnapshot: Tenant[],
) {
  const d = dateApplied ? new Date(dateApplied + 'T00:00:00') : new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  const prefix = `${mm}${yy}`
  const existingSeqs = new Set(
    tenantsSnapshot
      .filter((t) => t.tenant_number.startsWith(prefix + '-'))
      .map((t) => Number(t.tenant_number.split('-')[1])),
  )
  let seq = existingSeqs.size + 1
  for (let attempt = 0; attempt < 5; attempt++) {
    while (existingSeqs.has(seq)) seq++
    const tenantNumber = `${prefix}-${String(seq).padStart(3, '0')}`
    const { data, error } = await supabase
      .from('tenants')
      .insert({ ...basePayload, tenant_number: tenantNumber })
      .select()
      .single()
    if (!error) return { data, error: null }
    if (error.code !== '23505') return { data: null, error }
    existingSeqs.add(seq)
    seq++
  }
  return { data: null, error: { message: 'Could not generate a unique tenant number — please try saving again.' } }
}

const CACHE_KEY = 'tenants'
interface TenantsData {
  apartments: Apartment[]
  rooms: Room[]
  settings: AppSettings | null
  tenants: Tenant[]
  payments: Payment[]
  utilityBills: UtilityBill[]
  priceGroups: RoomPriceGroup[]
  rateHistory: RateChange[]
}

export function Tenants() {
  const { isAdmin } = useAuth()
  const { showToast } = useToast()

  const cached = getCached<TenantsData>(CACHE_KEY)
  const [apartments, setApartments] = useState<Apartment[]>(cached?.apartments ?? [])
  const [rooms, setRooms] = useState<Room[]>(cached?.rooms ?? [])
  const [settings, setSettings] = useState<AppSettings | null>(cached?.settings ?? null)
  const [tenants, setTenants] = useState<Tenant[]>(cached?.tenants ?? [])
  const [payments, setPayments] = useState<Payment[]>(cached?.payments ?? [])
  const [utilityBills, setUtilityBills] = useState<UtilityBill[]>(cached?.utilityBills ?? [])
  const [priceGroups, setPriceGroups] = useState<RoomPriceGroup[]>(cached?.priceGroups ?? [])
  const [rateHistory, setRateHistory] = useState<RateChange[]>(cached?.rateHistory ?? [])
  const [loading, setLoading] = useState(!cached)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'current' | 'pending' | 'active' | 'inactive' | 'all'>('current')
  const [apartmentFilter, setApartmentFilter] = useState('')
  const [tenantModal, setTenantModal] = useState<TenantModalState>(null)
  const [depositModal, setDepositModal] = useState<DepositModalState>(null)
  const [moveModal, setMoveModal] = useState<MoveModalState>(null)
  const [addDepositModal, setAddDepositModal] = useState<AddDepositModalState>(null)

  const loadAll = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      const [apartmentsRes, roomsRes, settingsRes, tenantsRes, paymentsRes, utilityBillsRes, priceGroupsRes, rateHistoryRes] =
        await Promise.all([
          supabase.from('apartments').select('*'),
          supabase.from('rooms').select('*'),
          supabase.from('app_settings').select('*').single(),
          supabase.from('tenants').select('*'),
          supabase.from('payments').select('*'),
          supabase.from('utility_bills').select('*'),
          supabase.from('room_price_groups').select('*'),
          supabase.from('tenant_rate_changes').select('*'),
        ])
      if (apartmentsRes.error) showToast(apartmentsRes.error.message)
      if (roomsRes.error) showToast(roomsRes.error.message)
      if (settingsRes.error) showToast(settingsRes.error.message)
      if (tenantsRes.error) showToast(tenantsRes.error.message)
      if (paymentsRes.error) showToast(paymentsRes.error.message)
      if (utilityBillsRes.error) showToast(utilityBillsRes.error.message)
      if (priceGroupsRes.error) showToast(priceGroupsRes.error.message)
      if (rateHistoryRes.error) showToast(rateHistoryRes.error.message)

      const data: TenantsData = {
        apartments: [...(apartmentsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.name, b.name)),
        rooms: [...(roomsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.label, b.label)),
        settings: settingsRes.data ?? null,
        tenants: [...(tenantsRes.data ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
        payments: paymentsRes.data ?? [],
        utilityBills: utilityBillsRes.data ?? [],
        priceGroups: priceGroupsRes.data ?? [],
        rateHistory: rateHistoryRes.data ?? [],
      }
      setCached(CACHE_KEY, data)
      setApartments(data.apartments)
      setRooms(data.rooms)
      setSettings(data.settings)
      setTenants(data.tenants)
      setPayments(data.payments)
      setUtilityBills(data.utilityBills)
      setPriceGroups(data.priceGroups)
      setRateHistory(data.rateHistory)
      setLoading(false)
    },
    [showToast],
  )

  useEffect(() => {
    loadAll(hasCached(CACHE_KEY))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAll])

  // reserved tenants auto-activate once they've paid at least one month's
  // rent — no manual "Activate" step needed. Runs after every reload; the
  // effect naturally settles once nobody left qualifies.
  useEffect(() => {
    if (loading) return
    const toActivate = tenants.filter((t) => {
      if (t.status !== 'pending' || !t.monthly_rate) return false
      const rentPaid = payments
        .filter((p) => p.tenant_id === t.id && p.payment_type === 'rent')
        .reduce((s, p) => s + Number(p.amount || 0), 0)
      return rentPaid >= t.monthly_rate
    })
    if (toActivate.length === 0) return
    ;(async () => {
      const { error } = await supabase
        .from('tenants')
        .update({ status: 'active' })
        .in('id', toActivate.map((t) => t.id))
      if (error) {
        showToast(error.message)
        return
      }
      showToast(
        toActivate.length === 1
          ? `${toActivate[0].first_name} ${toActivate[0].last_name} activated — a month's rent is paid.`
          : `${toActivate.length} reserved tenants activated — a month's rent is paid.`,
      )
      loadAll(true)
    })()
  }, [loading, tenants, payments, showToast, loadAll])

  async function moveOutTenant(tenant: Tenant) {
    const verb = tenant.status === 'pending' ? 'cancel this reservation' : 'mark them as moved out'
    if (!window.confirm(`${tenant.first_name} ${tenant.last_name} — ${verb}? This frees up their bed.`)) return
    const { error } = await supabase
      .from('tenants')
      .update({ status: 'inactive', move_out_date: todayStr() })
      .eq('id', tenant.id)
    if (error) {
      showToast(error.message)
      return
    }
    showToast(tenant.status === 'pending' ? 'Reservation cancelled.' : 'Tenant moved out.')
    loadAll(true)
  }

  async function deleteTenant(tenant: Tenant) {
    if (
      !window.confirm(
        `Permanently delete ${tenant.first_name} ${tenant.last_name} and their payment history? This cannot be undone.`,
      )
    )
      return
    const { error } = await supabase.from('tenants').delete().eq('id', tenant.id)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Tenant deleted.')
    loadAll(true)
  }

  if (loading) {
    return (
      <>
        <div className="page-head">
          <div>
            <h2>Tenants</h2>
          </div>
        </div>
        <SkeletonTable rows={8} cols={8} />
      </>
    )
  }

  const filtered = tenants.filter((t) => {
    if (statusFilter === 'current' && t.status === 'inactive') return false
    if (statusFilter === 'pending' && t.status !== 'pending') return false
    if (statusFilter === 'active' && t.status !== 'active') return false
    if (statusFilter === 'inactive' && t.status !== 'inactive') return false
    const room = rooms.find((r) => r.id === t.room_id)
    if (apartmentFilter && room?.apartment_id !== apartmentFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return `${t.tenant_number} ${t.first_name} ${t.last_name} ${t.school ?? ''} ${room?.label ?? ''}`
      .toLowerCase()
      .includes(q)
  })

  const activeCount = tenants.filter((t) => t.status === 'active').length
  const pendingCount = tenants.filter((t) => t.status === 'pending').length
  const utilityContext = { rooms, tenants, utilityBills, settings }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Tenants</h2>
          <div className="page-sub">
            {tenants.length} on record · {activeCount} active · {pendingCount} reserved
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setTenantModal({ mode: 'add' })}>
          + Add tenant
        </button>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search tenant no., name, school, or room…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="current">Current residents</option>
          <option value="pending">Reserved</option>
          <option value="active">Active</option>
          <option value="inactive">Moved out</option>
          <option value="all">All</option>
        </select>
        <select value={apartmentFilter} onChange={(e) => setApartmentFilter(e.target.value)}>
          <option value="">All apartments</option>
          {apartments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <h3>No tenants here yet</h3>
            <p>Add a tenant to assign them a bed and start tracking payments.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tenant No.</th>
                <th>Tenant</th>
                <th>School</th>
                <th>Room</th>
                <th>Booking</th>
                <th>Monthly Rate</th>
                <th>Status</th>
                <th>Security Deposit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const room = rooms.find((r) => r.id === t.room_id)
                const balance = computeTenantBalance(t, payments, rateHistory, utilityContext)
                const isLowBalance = balance.balance < 0
                // booking length reflects how many months of rent they've actually
                // paid for, not the fixed contract length set at signup — a tenant
                // who's paid 5 months ahead should show as booked 5 months out
                const monthsPaid = t.monthly_rate > 0 ? Math.floor(balance.rentPaid / t.monthly_rate) : 0
                const end = t.move_in_date && monthsPaid > 0 ? addMonths(t.move_in_date, monthsPaid) : null
                return (
                  <tr key={t.id}>
                    <td className="mono">{t.tenant_number}</td>
                    <td>
                      <div className="name-cell">
                        {t.first_name} {t.last_name}
                      </div>
                      <div className="sub-cell">{t.contact_number || '—'}</div>
                    </td>
                    <td>
                      <div>{t.school || '—'}</div>
                      <div className="sub-cell">{t.course || ''}</div>
                    </td>
                    <td>
                      <span className="mono">{room ? room.label : '—'}</span>
                    </td>
                    <td>
                      <div className="sub-cell">
                        {fmtDateShort(t.move_in_date)} → {end ? fmtDateShort(end) : '—'}
                      </div>
                      <div className="sub-cell">{monthsPaid > 0 ? `${monthsPaid} mo. paid` : '—'}</div>
                    </td>
                    <td>{fmtMoney(t.monthly_rate)}</td>
                    <td>
                      <span className={`badge ${TENANT_STATUS_BADGE[t.status]}`}>{TENANT_STATUS_LABEL[t.status]}</span>
                      {isLowBalance && (
                        <span className="badge badge-overdue" style={{ marginLeft: 6 }}>
                          Low Balance
                        </span>
                      )}
                    </td>
                    <td>
                      {t.deposit_amount > 0 ? (
                        <>
                          <span className={`badge ${DEPOSIT_STATUS_BADGE[t.deposit_status]}`}>
                            {DEPOSIT_STATUS_LABEL[t.deposit_status]}
                          </span>
                          <div className="sub-cell">
                            {t.deposit_status === 'refunded'
                              ? `${fmtMoney(t.deposit_returned_amount ?? 0)} returned`
                              : fmtMoney(t.deposit_amount)}
                          </div>
                        </>
                      ) : (
                        <span className="sub-cell">—</span>
                      )}
                    </td>
                    <td>
                      <ActionMenu
                        items={[
                          { label: 'Edit', onClick: () => setTenantModal({ mode: 'edit', tenant: t }) },
                          {
                            label: 'Security Deposit',
                            onClick: () => setDepositModal({ tenant: t }),
                            hidden: t.deposit_amount <= 0,
                          },
                          {
                            label: '+ Add Security Deposit',
                            onClick: () => setAddDepositModal({ tenant: t }),
                            hidden: t.deposit_amount > 0,
                          },
                          { label: 'Move', onClick: () => setMoveModal({ tenant: t }), hidden: t.status === 'inactive' },
                          {
                            label: t.status === 'pending' ? 'Cancel' : 'Move out',
                            onClick: () => moveOutTenant(t),
                            danger: true,
                            hidden: t.status === 'inactive',
                          },
                          {
                            label: 'Delete',
                            onClick: () => deleteTenant(t),
                            danger: true,
                            hidden: t.status !== 'inactive' || !isAdmin,
                          },
                        ]}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {tenantModal && (
        <TenantModal
          initial={tenantModal.mode === 'edit' ? tenantModal.tenant : null}
          apartments={apartments}
          rooms={rooms}
          settings={settings}
          priceGroups={priceGroups}
          tenants={tenants}
          onClose={() => setTenantModal(null)}
          onSaved={() => {
            setTenantModal(null)
            loadAll(true)
          }}
        />
      )}

      {depositModal && (
        <DepositModal
          tenant={depositModal.tenant}
          onClose={() => setDepositModal(null)}
          onSaved={() => {
            setDepositModal(null)
            loadAll(true)
          }}
        />
      )}

      {addDepositModal && (
        <AddDepositModal
          tenant={addDepositModal.tenant}
          onClose={() => setAddDepositModal(null)}
          onSaved={() => {
            setAddDepositModal(null)
            loadAll(true)
          }}
        />
      )}

      {moveModal && (
        <MoveModal
          tenant={moveModal.tenant}
          apartments={apartments}
          rooms={rooms}
          settings={settings}
          priceGroups={priceGroups}
          tenants={tenants}
          onClose={() => setMoveModal(null)}
          onSaved={() => {
            setMoveModal(null)
            loadAll(true)
          }}
        />
      )}
    </>
  )
}

function AddDepositModal({
  tenant,
  onClose,
  onSaved,
}: {
  tenant: Tenant
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [amount, setAmount] = useState(String(tenant.monthly_rate || ''))
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const amt = Number(amount)
    if (!amt || amt <= 0) {
      showToast('Enter a deposit amount greater than 0.')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('tenants')
      .update({ deposit_amount: amt, deposit_status: 'unpaid' })
      .eq('id', tenant.id)
    setSaving(false)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Security deposit added.')
    onSaved()
  }

  return (
    <Modal
      title={`${tenant.first_name} ${tenant.last_name} — add security deposit`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Add deposit'}
          </button>
        </>
      }
    >
      <div className="form-group" style={{ maxWidth: 260 }}>
        <label>Deposit amount (₱)</label>
        <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        <div className="hint">
          Commonly 1–2 months' rent, held against damage and returned at move-out. You'll mark it as
          collected and later returned from the Security Deposit action once it's added here.
        </div>
      </div>
    </Modal>
  )
}

function DepositModal({
  tenant,
  onClose,
  onSaved,
}: {
  tenant: Tenant
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [returnedAmount, setReturnedAmount] = useState(String(tenant.deposit_amount))
  const [returnNotes, setReturnNotes] = useState(tenant.deposit_notes ?? '')
  const [newNote, setNewNote] = useState('')

  async function collectDeposit() {
    setSaving(true)
    const { error } = await supabase
      .from('tenants')
      .update({ deposit_status: 'held', deposit_collected_date: todayStr() })
      .eq('id', tenant.id)
    setSaving(false)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Deposit marked as collected.')
    onSaved()
  }

  async function addDamageNote() {
    if (!newNote.trim()) return
    const entry = `[${fmtDate(todayStr())}] ${newNote.trim()}`
    const updatedNotes = tenant.deposit_notes ? `${tenant.deposit_notes}\n${entry}` : entry
    setSaving(true)
    const { error } = await supabase.from('tenants').update({ deposit_notes: updatedNotes }).eq('id', tenant.id)
    setSaving(false)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Note added.')
    onSaved()
  }

  async function submitReturn() {
    const amt = Number(returnedAmount)
    if (Number.isNaN(amt) || amt < 0) {
      showToast('Enter a valid returned amount.')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('tenants')
      .update({
        deposit_status: 'refunded',
        deposit_returned_amount: amt,
        deposit_returned_date: todayStr(),
        deposit_notes: returnNotes.trim() || null,
      })
      .eq('id', tenant.id)
    setSaving(false)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Deposit return recorded.')
    onSaved()
  }

  return (
    <Modal
      title={`${tenant.first_name} ${tenant.last_name} — security deposit`}
      onClose={onClose}
      footer={
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Deposit Amount</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            {fmtMoney(tenant.deposit_amount)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Status</div>
          <div style={{ marginTop: 4 }}>
            <span className={`badge ${DEPOSIT_STATUS_BADGE[tenant.deposit_status]}`}>
              {DEPOSIT_STATUS_LABEL[tenant.deposit_status]}
            </span>
          </div>
        </div>
      </div>

      {tenant.deposit_status !== 'refunded' && (
        <>
          <div className="fieldset-title" style={{ marginTop: 0 }}>Damage / incident notes</div>
          {tenant.deposit_notes && (
            <div className="hint" style={{ whiteSpace: 'pre-line', marginBottom: 12 }}>
              {tenant.deposit_notes}
            </div>
          )}
          <div className="form-group">
            <textarea
              rows={2}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Log anything noticed during the stay, e.g. cigarette burn on carpet — helps justify a deduction later"
            />
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 6 }}
              onClick={addDamageNote}
              disabled={saving || !newNote.trim()}
            >
              {saving ? 'Saving…' : '+ Add note'}
            </button>
          </div>
        </>
      )}

      {tenant.deposit_status === 'unpaid' && (
        <>
          <p className="hint" style={{ marginBottom: 12 }}>
            Mark this once you've physically received the deposit from the tenant.
          </p>
          <button className="btn btn-primary" onClick={collectDeposit} disabled={saving}>
            {saving ? 'Saving…' : 'Mark as collected'}
          </button>
        </>
      )}

      {tenant.deposit_status === 'held' && !showReturnForm && (
        <>
          <p className="hint" style={{ marginBottom: 12 }}>
            Collected {tenant.deposit_collected_date ? fmtDate(tenant.deposit_collected_date) : '—'}. Return it once
            the tenant moves out.
          </p>
          <button className="btn btn-primary" onClick={() => setShowReturnForm(true)}>
            Return deposit
          </button>
        </>
      )}

      {tenant.deposit_status === 'held' && showReturnForm && (
        <>
          <div className="form-group">
            <label>Amount returned (₱)</label>
            <input
              type="number"
              min={0}
              value={returnedAmount}
              onChange={(e) => setReturnedAmount(e.target.value)}
            />
            <div className="hint">Enter less than {fmtMoney(tenant.deposit_amount)} if deducting for damages.</div>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea
              rows={2}
              value={returnNotes}
              onChange={(e) => setReturnNotes(e.target.value)}
              placeholder="e.g. ₱1,500 deducted for wall damage"
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setShowReturnForm(false)}>
              Back
            </button>
            <button className="btn btn-primary" onClick={submitReturn} disabled={saving}>
              {saving ? 'Saving…' : 'Confirm return'}
            </button>
          </div>
        </>
      )}

      {tenant.deposit_status === 'refunded' && (
        <div className="room-list">
          <div className="room-row" style={{ cursor: 'default' }}>
            <div>
              <span className="room-id">Returned {fmtMoney(tenant.deposit_returned_amount ?? 0)}</span>
              <span className="room-type">{tenant.deposit_returned_date ? fmtDate(tenant.deposit_returned_date) : ''}</span>
            </div>
          </div>
          {tenant.deposit_notes && (
            <div className="hint" style={{ marginTop: 8 }}>
              {tenant.deposit_notes}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function MoveModal({
  tenant,
  apartments,
  rooms,
  settings,
  priceGroups,
  tenants,
  onClose,
  onSaved,
}: {
  tenant: Tenant
  apartments: Apartment[]
  rooms: Room[]
  settings: AppSettings | null
  priceGroups: RoomPriceGroup[]
  tenants: Tenant[]
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [roomId, setRoomId] = useState(tenant.room_id ?? '')
  const [saving, setSaving] = useState(false)

  const currentRoom = rooms.find((r) => r.id === tenant.room_id) ?? null
  const currentApartment = currentRoom ? apartments.find((a) => a.id === currentRoom.apartment_id) : null

  const selectedRoom = rooms.find((r) => r.id === roomId) ?? null
  const occupied = selectedRoom ? occupiedBedIndexes(tenants, selectedRoom.id, tenant.id) : new Set<number>()
  const effCap = selectedRoom ? effectiveCapacity(selectedRoom) : 0
  const isSameRoom = !!roomId && roomId === tenant.room_id
  const previewBedIndex = selectedRoom
    ? isSameRoom
      ? tenant.bed_index
      : firstVacantBedIndex(effCap, occupied)
    : null
  // a per-tenant custom rate follows the tenant across the move; otherwise the
  // rate re-syncs to the new room (this move is the explicit re-sync point
  // after grandfathering — see TenantModal)
  const newMonthlyRate =
    tenant.custom_rate_per_pax != null
      ? tenant.custom_rate_per_pax
      : selectedRoom
        ? effectiveRate(selectedRoom, settings, priceGroups)
        : tenant.monthly_rate

  async function handleMove() {
    if (!roomId || !selectedRoom) {
      showToast('Please select a room.')
      return
    }
    const bedIndex = previewBedIndex
    if (bedIndex == null) {
      showToast('That room is full — pick another room.')
      return
    }
    setSaving(true)
    const moveDate = todayStr()
    const { error } = await supabase
      .from('tenants')
      .update({ room_id: roomId, bed_index: bedIndex, monthly_rate: newMonthlyRate })
      .eq('id', tenant.id)
    if (error) {
      setSaving(false)
      showToast(error.message)
      return
    }
    const { error: historyError } = await supabase
      .from('tenant_rate_changes')
      .insert({ tenant_id: tenant.id, monthly_rate: newMonthlyRate, effective_date: moveDate })
    setSaving(false)
    if (historyError) {
      showToast(historyError.message)
      return
    }
    showToast(`Moved to ${selectedRoom.label}.`)
    onSaved()
  }

  return (
    <Modal
      title={`Move ${tenant.first_name} ${tenant.last_name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleMove} disabled={saving || !roomId || isSameRoom}>
            {saving ? 'Moving…' : 'Move tenant'}
          </button>
        </>
      }
    >
      <div className="hint" style={{ marginBottom: 16 }}>
        Currently in {currentApartment?.name ?? '—'} · {currentRoom?.label ?? '—'} at {fmtMoney(tenant.monthly_rate)}/mo.
      </div>
      <div className="form-group">
        <label>New room</label>
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">— Select a room —</option>
          {apartments.map((apartment) => {
            const apartmentRooms = rooms.filter((r) => r.apartment_id === apartment.id)
            if (apartmentRooms.length === 0) return null
            return (
              <optgroup key={apartment.id} label={apartment.name}>
                {apartmentRooms.map((room) => {
                  const cap = effectiveCapacity(room)
                  const occ = occupiedBedIndexes(tenants, room.id, tenant.id)
                  const vacant = cap - occ.size
                  const rate = effectiveRate(room, settings, priceGroups)
                  const modeLabel = room.mode === 'private' ? 'Private' : 'Shared'
                  const isCurrent = room.id === tenant.room_id
                  return (
                    <option key={room.id} value={room.id} disabled={vacant <= 0 && !isCurrent}>
                      {room.label} · {modeLabel} · {fmtMoney(rate)}/pax
                      {isCurrent
                        ? ' (current room)'
                        : vacant <= 0
                          ? ' (full)'
                          : ` (${vacant} bed${vacant === 1 ? '' : 's'} open)`}
                    </option>
                  )
                })}
              </optgroup>
            )
          })}
        </select>
        {selectedRoom && !isSameRoom && (
          <div className="hint">
            {previewBedIndex != null
              ? `Moving to ${selectedRoom.label} — monthly rate will change to ${fmtMoney(newMonthlyRate)}.`
              : 'This room is full.'}
          </div>
        )}
      </div>
    </Modal>
  )
}

function TenantModal({
  initial,
  apartments,
  rooms,
  settings,
  priceGroups,
  tenants,
  onClose,
  onSaved,
}: {
  initial: Tenant | null
  apartments: Apartment[]
  rooms: Room[]
  settings: AppSettings | null
  priceGroups: RoomPriceGroup[]
  tenants: Tenant[]
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const { isAdmin } = useAuth()
  // non-admins may still update a tenant's contact/emergency/school info, but
  // identity and the security deposit amount are locked once the tenant exists
  const fieldsLocked = !!initial && !isAdmin

  const [firstName, setFirstName] = useState(initial?.first_name ?? '')
  const [lastName, setLastName] = useState(initial?.last_name ?? '')
  const [birthdate, setBirthdate] = useState(initial?.birthdate ?? '')
  const [contactNumber, setContactNumber] = useState(initial?.contact_number ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [emergencyName, setEmergencyName] = useState(initial?.emergency_name ?? '')
  const [emergencyRelationship, setEmergencyRelationship] = useState(initial?.emergency_relationship ?? '')
  const [emergencyPhone, setEmergencyPhone] = useState(initial?.emergency_phone ?? '')
  const [school, setSchool] = useState(initial?.school ?? '')
  const [course, setCourse] = useState(initial?.course ?? '')
  const [yearLevel, setYearLevel] = useState(initial?.year_level ?? '')
  const [roomId, setRoomId] = useState(initial?.room_id ?? '')
  const [durationMonths, setDurationMonths] = useState(
    initial?.duration_months != null ? String(initial.duration_months) : '1',
  )
  const [moveInDate, setMoveInDate] = useState(initial?.move_in_date ?? todayStr())
  const [dateApplied, setDateApplied] = useState(initial?.date_applied ?? todayStr())
  const [depositAmount, setDepositAmount] = useState(
    initial?.deposit_amount != null ? String(initial.deposit_amount) : '',
  )
  // per-tenant custom rate override (admin only). Blank = follow the room's rate.
  const [customRate, setCustomRate] = useState(
    initial?.custom_rate_per_pax != null ? String(initial.custom_rate_per_pax) : '',
  )
  const [saving, setSaving] = useState(false)

  const apartmentById = useMemo(() => new Map(apartments.map((a) => [a.id, a])), [apartments])

  const selectedRoom = rooms.find((r) => r.id === roomId) ?? null
  const occupied = selectedRoom ? occupiedBedIndexes(tenants, selectedRoom.id, initial?.id) : new Set<number>()
  const effCap = selectedRoom ? effectiveCapacity(selectedRoom) : 0
  const previewBedIndex =
    initial && initial.room_id === roomId ? initial.bed_index : selectedRoom ? firstVacantBedIndex(effCap, occupied) : null
  const vacantCount = effCap - occupied.size

  // the room's standard rate (pricing group or global default)
  const roomBaseRate = selectedRoom ? effectiveRate(selectedRoom, settings, priceGroups) : 0
  const overrideNum = customRate.trim() ? Number(customRate) : null
  // Effective monthly rate:
  //  - override set → use it
  //  - new tenant, no override → follow the room's rate
  //  - existing tenant, no override → keep their grandfathered snapshot, unless
  //    they previously HAD an override that's now cleared → revert to room rate
  const monthlyRate =
    overrideNum != null
      ? overrideNum
      : initial
        ? initial.custom_rate_per_pax != null
          ? roomBaseRate
          : initial.monthly_rate
        : roomBaseRate

  function handleRoomChange(newRoomId: string) {
    setRoomId(newRoomId)
    if (!initial && !depositAmount) {
      const room = rooms.find((r) => r.id === newRoomId)
      if (room) setDepositAmount(String(effectiveRate(room, settings, priceGroups)))
    }
  }

  async function handleSave() {
    if (!firstName.trim() || !lastName.trim()) {
      showToast('First and last name are required.')
      return
    }
    if (!roomId || !selectedRoom) {
      showToast('Please select a room.')
      return
    }
    const bedIndex = previewBedIndex
    if (bedIndex == null) {
      showToast('That room is full — pick another room.')
      return
    }

    const payload = {
      // locked fields fall back to their existing saved value so a
      // non-admin can't slip a change through even by editing state directly
      first_name: fieldsLocked ? initial!.first_name : firstName.trim(),
      last_name: fieldsLocked ? initial!.last_name : lastName.trim(),
      birthdate: birthdate || null,
      contact_number: contactNumber.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      emergency_name: emergencyName.trim() || null,
      emergency_relationship: emergencyRelationship.trim() || null,
      emergency_phone: emergencyPhone.trim() || null,
      school: school.trim() || null,
      course: course.trim() || null,
      year_level: yearLevel.trim() || null,
      room_id: roomId,
      bed_index: bedIndex,
      // rate + override are pricing decisions — only admins may change them.
      // for a non-admin editing an existing tenant, keep the saved values.
      monthly_rate: !isAdmin && initial ? initial.monthly_rate : monthlyRate,
      custom_rate_per_pax: !isAdmin && initial ? initial.custom_rate_per_pax : overrideNum,
      duration_months: Number(durationMonths) || 1,
      move_in_date: moveInDate || null,
      deposit_amount: fieldsLocked ? initial!.deposit_amount : Number(depositAmount) || 0,
    }

    setSaving(true)
    if (initial) {
      // status is intentionally left untouched here — moving a tenant
      // in/out or activating them are separate explicit actions, not a
      // side effect of editing their details
      const { error } = await supabase.from('tenants').update(payload).eq('id', initial.id)
      if (error) {
        setSaving(false)
        showToast(error.message)
        return
      }
      // if an admin changed the rate, date-stamp it so past cycles keep the old
      // rate and only future cycles bill at the new one (point-in-time history)
      if (payload.monthly_rate !== initial.monthly_rate) {
        const { error: historyError } = await supabase.from('tenant_rate_changes').insert({
          tenant_id: initial.id,
          monthly_rate: payload.monthly_rate,
          effective_date: todayStr(),
        })
        if (historyError) showToast(historyError.message)
      }
      setSaving(false)
      showToast('Tenant updated.')
      onSaved()
    } else {
      const { data: newTenant, error } = await insertTenantWithRetry(
        { ...payload, status: 'pending', date_applied: dateApplied },
        dateApplied,
        tenants,
      )
      if (error) {
        setSaving(false)
        showToast(error.message)
        return
      }
      if (newTenant) {
        const { error: historyError } = await supabase.from('tenant_rate_changes').insert({
          tenant_id: newTenant.id,
          monthly_rate: monthlyRate,
          effective_date: moveInDate || todayStr(),
        })
        if (historyError) showToast(historyError.message)
      }
      setSaving(false)
      showToast('Tenant added.')
      onSaved()
    }
  }

  return (
    <Modal
      title={initial ? `Edit ${initial.first_name} ${initial.last_name}` : 'Add tenant'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Add tenant'}
          </button>
        </>
      }
    >
      <div className="fieldset-title">Personal details</div>
      <div className="form-row">
        <div className="form-group">
          <label>Tenant No.</label>
          <input
            value={initial ? initial.tenant_number : previewTenantNumber(dateApplied, tenants)}
            disabled
            className="mono"
          />
        </div>
        <div className="form-group">
          <label>Date applied</label>
          <input type="date" value={dateApplied} onChange={(e) => setDateApplied(e.target.value)} disabled={!!initial} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>First name</label>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoFocus={!fieldsLocked}
            disabled={fieldsLocked}
          />
        </div>
        <div className="form-group">
          <label>Last name</label>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={fieldsLocked} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Birthdate</label>
          <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Contact number</label>
          <input value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} placeholder="09xx xxx xxxx" />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Permanent address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
      </div>

      <div className="fieldset-title">Emergency contact</div>
      <div className="form-row">
        <div className="form-group">
          <label>Contact name</label>
          <input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Relationship</label>
          <input
            value={emergencyRelationship}
            onChange={(e) => setEmergencyRelationship(e.target.value)}
            placeholder="Parent, sibling, guardian…"
          />
        </div>
      </div>
      <div className="form-group">
        <label>Contact number</label>
        <input value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} placeholder="09xx xxx xxxx" />
      </div>

      <div className="fieldset-title">School</div>
      <div className="form-row">
        <div className="form-group">
          <label>School / university</label>
          <input value={school} onChange={(e) => setSchool(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Course / program</label>
          <input value={course} onChange={(e) => setCourse(e.target.value)} />
        </div>
      </div>
      <div className="form-group" style={{ maxWidth: 200 }}>
        <label>Year level</label>
        <input value={yearLevel} onChange={(e) => setYearLevel(e.target.value)} placeholder="e.g. 2nd Year" />
      </div>

      <div className="fieldset-title">Room &amp; booking</div>
      <div className="form-group">
        <label>Room</label>
        <select value={roomId} onChange={(e) => handleRoomChange(e.target.value)} disabled={!!initial}>
          <option value="">— Select a room —</option>
          {apartments.map((apartment) => {
            const apartmentRooms = rooms.filter((r) => r.apartment_id === apartment.id)
            if (apartmentRooms.length === 0) return null
            return (
              <optgroup key={apartment.id} label={apartment.name}>
                {apartmentRooms.map((room) => {
                  const cap = effectiveCapacity(room)
                  const occ = occupiedBedIndexes(tenants, room.id, initial?.id)
                  const vacant = cap - occ.size
                  const rate = effectiveRate(room, settings, priceGroups)
                  const modeLabel = room.mode === 'private' ? 'Private' : 'Shared'
                  return (
                    <option key={room.id} value={room.id} disabled={vacant <= 0}>
                      {room.label} · {modeLabel} · {fmtMoney(rate)}/pax
                      {vacant <= 0 ? ' (full)' : ` (${vacant} bed${vacant === 1 ? '' : 's'} open)`}
                    </option>
                  )
                })}
              </optgroup>
            )
          })}
        </select>
        {initial ? (
          <div className="hint">To change rooms, use the Move action instead — it keeps pricing in sync.</div>
        ) : (
          selectedRoom && (
            <div className="hint">
              {previewBedIndex != null
                ? `Assigning to ${apartmentById.get(selectedRoom.apartment_id)?.name ?? ''} · ${selectedRoom.label}.`
                : `This room is full (${vacantCount} beds open).`}
            </div>
          )
        )}
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Monthly rate (₱)</label>
          <input value={fmtMoney(monthlyRate)} disabled />
          <div className="hint">
            {overrideNum != null
              ? 'Custom rate set for this tenant.'
              : initial && initial.custom_rate_per_pax == null
                ? 'Locked to the rate set when this tenant was assigned.'
                : "Follows the selected room's rate."}
          </div>
        </div>
        <div className="form-group">
          <label>Duration (months)</label>
          <input type="number" min={1} value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} />
        </div>
      </div>
      {isAdmin && (
        <div className="form-group" style={{ maxWidth: 260 }}>
          <label>Custom rate override (₱/mo)</label>
          <input
            type="number"
            min={0}
            value={customRate}
            onChange={(e) => setCustomRate(e.target.value)}
            placeholder={`Room rate: ${fmtMoney(roomBaseRate)}`}
          />
          <div className="hint">
            Optional. A special monthly rate just for this tenant. Leave blank to follow the room's rate.
          </div>
        </div>
      )}
      <div className="form-group">
        <label>Move-in date</label>
        <input type="date" value={moveInDate} onChange={(e) => setMoveInDate(e.target.value)} />
      </div>

      <div className="fieldset-title">Security deposit</div>
      <div className="form-group" style={{ maxWidth: 260 }}>
        <label>Deposit amount (₱)</label>
        <input
          type="number"
          min={0}
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
          disabled={fieldsLocked}
        />
        <div className="hint">
          {fieldsLocked
            ? 'Only an admin can change the deposit amount.'
            : "Commonly 1–2 months' rent, held against damage and returned at move-out. Collecting and returning it are tracked separately via the Deposit action once this tenant is saved."}
        </div>
      </div>
    </Modal>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { effectiveCapacity, naturalSort } from '../lib/rooms'
import { computeTenantBalance } from '../lib/balance'
import { fmtMoney, todayStr } from '../lib/format'
import { TENANT_STATUS_LABEL, TENANT_STATUS_BADGE, occupiesBed } from '../lib/tenantStatus'
import { Modal } from '../components/Modal'
import { SkeletonStatGrid, SkeletonCardGrid } from '../components/Skeleton'
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

export function Dashboard() {
  const { isAdmin } = useAuth()
  const { showToast } = useToast()

  const cached = getCached<DashboardData>(CACHE_KEY)
  const [apartments, setApartments] = useState<Apartment[]>(cached?.apartments ?? [])
  const [rooms, setRooms] = useState<Room[]>(cached?.rooms ?? [])
  const [tenants, setTenants] = useState<Tenant[]>(cached?.tenants ?? [])
  const [payments, setPayments] = useState<Payment[]>(cached?.payments ?? [])
  const [utilityBills, setUtilityBills] = useState<UtilityBill[]>(cached?.utilityBills ?? [])
  const [settings, setSettings] = useState<AppSettings | null>(cached?.settings ?? null)
  const [rateHistory, setRateHistory] = useState<RateChange[]>(cached?.rateHistory ?? [])
  const [loading, setLoading] = useState(!cached)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)

  const loadAll = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true)
      const [apartmentsRes, roomsRes, tenantsRes, paymentsRes, utilityBillsRes, settingsRes, rateHistoryRes] =
        await Promise.all([
          supabase.from('apartments').select('*'),
          supabase.from('rooms').select('*'),
          supabase.from('tenants').select('*'),
          supabase.from('payments').select('*'),
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
        <div className="section-title">Occupancy by apartment</div>
        <SkeletonCardGrid count={4} />
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
  const balances = occupyingTenants.map((t) => computeTenantBalance(t, payments, rateHistory, utilityContext))
  const lowBalanceCount = balances.filter((b) => b.balance < 0).length
  const totalOwed = balances.reduce((s, b) => (b.balance < 0 ? s - b.balance : s), 0)

  const occupancyByRoom: Record<string, number> = {}
  for (const t of occupyingTenants) {
    if (t.room_id) occupancyByRoom[t.room_id] = (occupancyByRoom[t.room_id] ?? 0) + 1
  }

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

      <div className="section-title">Occupancy by apartment</div>
      {apartments.length === 0 ? (
        <div className="empty-state">
          <h3>No apartments yet</h3>
          <p>Set up apartments and rooms on the Units &amp; Rooms page to see occupancy here.</p>
        </div>
      ) : (
        <div className="units-grid">
          {apartments.map((apartment) => {
            const apartmentRooms = rooms.filter((r) => r.apartment_id === apartment.id)
            const cap = apartmentRooms.reduce((s, r) => s + effectiveCapacity(r), 0)
            const occ = apartmentRooms.reduce((s, r) => s + (occupancyByRoom[r.id] ?? 0), 0)
            return (
              <div className="unit-card" key={apartment.id}>
                <div className="unit-card-head">
                  <h4>{apartment.name}</h4>
                  <span className="unit-occ">
                    {occ}/{cap} pax
                  </span>
                </div>
                <div className="room-list">
                  {apartmentRooms.map((room) => {
                    const effCap = effectiveCapacity(room)
                    const roomOcc = occupancyByRoom[room.id] ?? 0
                    const dots = Array.from({ length: effCap }, (_, i) => i < roomOcc)
                    return (
                      <div
                        className="room-row"
                        key={room.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedRoom(room)}
                      >
                        <span className="room-id">{room.label}</span>
                        <div className="bed-dots">
                          {dots.map((filled, i) => (
                            <span key={i} className={`dot ${filled ? 'filled' : 'empty'}`} />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                  {apartmentRooms.length === 0 && <div className="hint">No rooms yet.</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selectedRoom && (
        <Modal title={selectedRoom.label} onClose={() => setSelectedRoom(null)}>
          <div className="status-legend">
            {(Object.keys(TENANT_STATUS_LABEL) as (keyof typeof TENANT_STATUS_LABEL)[])
              .filter((s) => s !== 'inactive')
              .map((status) => (
                <span className="legend-item" key={status}>
                  <span className={`badge ${TENANT_STATUS_BADGE[status]}`}>{TENANT_STATUS_LABEL[status]}</span>
                </span>
              ))}
          </div>
          {tenants.filter((t) => t.room_id === selectedRoom.id && occupiesBed(t.status)).length === 0 ? (
            <div className="hint">No tenants currently assigned to this room.</div>
          ) : (
            <div className="room-tenant-list">
              {tenants
                .filter((t) => t.room_id === selectedRoom.id && occupiesBed(t.status))
                .map((t) => (
                  <div className="room-tenant-row" key={t.id}>
                    <span>
                      {t.first_name} {t.last_name}
                    </span>
                    <span className={`badge ${TENANT_STATUS_BADGE[t.status]}`}>{TENANT_STATUS_LABEL[t.status]}</span>
                  </div>
                ))}
            </div>
          )}
        </Modal>
      )}
    </>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Modal } from '../components/Modal'
import { naturalSort } from '../lib/rooms'
import { fmtMoney, fmtDate } from '../lib/format'
import { getCached, setCached, hasCached } from '../lib/cache'
import { SkeletonBlock, SkeletonTable } from '../components/Skeleton'
import { exportAllData, daysSinceLastBackup, getLastBackupAt, BACKUP_STALE_DAYS } from '../lib/backup'
import type { Database, UserRole } from '../lib/database.types'

type AppSettings = Database['public']['Tables']['app_settings']['Row']
type Apartment = Database['public']['Tables']['apartments']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type Profile = Database['public']['Tables']['profiles']['Row']
type RoomPriceGroup = Database['public']['Tables']['room_price_groups']['Row']

type PriceGroupModalState = { mode: 'add' } | { mode: 'edit'; group: RoomPriceGroup } | null

const TABS = [
  { id: 'rates', label: 'Default rates' },
  { id: 'groups', label: 'Room pricing groups' },
  { id: 'utilities', label: 'Utility allowances' },
  { id: 'overrides', label: 'Custom overrides' },
  { id: 'organization', label: 'Organization' },
  { id: 'users', label: 'Users' },
  { id: 'backup', label: 'Backup' },
  { id: 'activity', label: 'Activity log' },
  { id: 'errors', label: 'Errors' },
] as const
type TabId = (typeof TABS)[number]['id']

type AuditRow = Database['public']['Tables']['audit_log']['Row']
type ErrorRow = Database['public']['Tables']['error_log']['Row']

// human-readable summary of an audit entry for the activity log
function describeAudit(row: AuditRow): { action: string; badge: string; entity: string } {
  const d = (row.action === 'DELETE' ? row.old_data : row.new_data) ?? {}
  const s = (k: string) => (d[k] == null ? '' : String(d[k]))
  const money = (k: string) => fmtMoney(Number(d[k] ?? 0))
  const cap = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v)

  let entity: string
  switch (row.table_name) {
    case 'tenants':
      entity = `Tenant ${s('first_name')} ${s('last_name')}`.trim()
      break
    case 'payments':
      entity = `${cap(s('payment_type') || 'rent')} payment ${money('amount')}`
      break
    case 'utility_bills':
      entity = `${cap(s('utility_type'))} bill ${money('total_cost')}`
      break
    case 'tenant_rate_changes':
      entity = `Rate change ${money('monthly_rate')}`
      break
    case 'rooms':
      entity = `Room ${s('label')}`.trim()
      break
    case 'apartments':
      entity = `Apartment ${s('name')}`.trim()
      break
    case 'room_price_groups':
      entity = `Pricing group ${s('name')}`.trim()
      break
    case 'app_settings':
      entity = 'App settings'
      break
    default:
      entity = row.table_name
  }

  const action = row.action === 'INSERT' ? 'Created' : row.action === 'UPDATE' ? 'Updated' : 'Deleted'
  const badge = row.action === 'INSERT' ? 'badge-active' : row.action === 'UPDATE' ? 'badge-partial' : 'badge-overdue'
  return { action, badge, entity }
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const CACHE_KEY = 'settings'
interface SettingsData {
  settings: AppSettings | null
  apartments: Apartment[]
  rooms: Room[]
  tenants: Tenant[]
  priceGroups: RoomPriceGroup[]
  updatedByProfile: Profile | null
}

export function Settings() {
  const { profile } = useAuth()
  const { showToast } = useToast()
  const [activeTab, setActiveTab] = useState<TabId>('rates')

  const cached = getCached<SettingsData>(CACHE_KEY)
  const [settings, setSettings] = useState<AppSettings | null>(cached?.settings ?? null)
  const [apartments, setApartments] = useState<Apartment[]>(cached?.apartments ?? [])
  const [rooms, setRooms] = useState<Room[]>(cached?.rooms ?? [])
  const [tenants, setTenants] = useState<Tenant[]>(cached?.tenants ?? [])
  const [priceGroups, setPriceGroups] = useState<RoomPriceGroup[]>(cached?.priceGroups ?? [])
  const [updatedByProfile, setUpdatedByProfile] = useState<Profile | null>(cached?.updatedByProfile ?? null)
  const [loading, setLoading] = useState(!cached)
  const [priceGroupModal, setPriceGroupModal] = useState<PriceGroupModalState>(null)

  const [sharedRate, setSharedRate] = useState(cached?.settings ? String(cached.settings.default_shared_rate_per_pax) : '')
  const [privateRate, setPrivateRate] = useState(cached?.settings ? String(cached.settings.default_private_rate_per_pax) : '')
  const [saving, setSaving] = useState(false)

  const [electricityAllowance, setElectricityAllowance] = useState(
    cached?.settings ? String(cached.settings.electricity_allowance_per_tenant) : '',
  )
  const [waterAllowance, setWaterAllowance] = useState(
    cached?.settings ? String(cached.settings.water_allowance_per_tenant) : '',
  )
  const [savingAllowances, setSavingAllowances] = useState(false)

  const [bizName, setBizName] = useState(cached?.settings?.business_name ?? '')
  const [bizAddress, setBizAddress] = useState(cached?.settings?.business_address ?? '')
  const [bizContact, setBizContact] = useState(cached?.settings?.business_contact ?? '')
  const [bizPayInstructions, setBizPayInstructions] = useState(cached?.settings?.payment_instructions ?? '')
  const [savingOrg, setSavingOrg] = useState(false)

  // audit log is fetched on demand when the Activity log tab is opened
  const [auditLog, setAuditLog] = useState<AuditRow[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  // error log, likewise fetched on demand
  const [errorLog, setErrorLog] = useState<ErrorRow[]>([])
  const [errorLoading, setErrorLoading] = useState(false)

  const loadErrors = useCallback(async () => {
    setErrorLoading(true)
    const { data, error } = await supabase
      .from('error_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) showToast(error.message)
    setErrorLog(data ?? [])
    setErrorLoading(false)
  }, [showToast])

  // user accounts, fetched on demand when the Users tab is opened
  const [users, setUsers] = useState<Profile[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [addUserOpen, setAddUserOpen] = useState(false)

  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    const { data, error } = await supabase.from('profiles').select('*').order('full_name')
    if (error) showToast(error.message)
    setUsers(data ?? [])
    setUsersLoading(false)
  }, [showToast])

  async function changeRole(u: Profile, role: UserRole) {
    if (u.id === profile?.id) {
      showToast("You can't change your own role.")
      return
    }
    const { error } = await supabase.from('profiles').update({ role }).eq('id', u.id)
    if (error) {
      showToast(error.message)
      return
    }
    showToast(`${u.full_name || 'User'} is now ${role === 'admin' ? 'an admin' : 'staff'}.`)
    loadUsers()
  }

  const [exporting, setExporting] = useState(false)
  // bump on each export so the "last backup" line refreshes without a reload
  const [backupTick, setBackupTick] = useState(0)

  async function handleExport() {
    setExporting(true)
    try {
      const { counts, filename } = await exportAllData()
      const total = Object.values(counts).reduce((s, n) => s + n, 0)
      showToast(`Backup saved: ${filename} (${total} records).`)
      setBackupTick((t) => t + 1)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Backup failed.')
    } finally {
      setExporting(false)
    }
  }

  const loadAudit = useCallback(async () => {
    setAuditLoading(true)
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) showToast(error.message)
    setAuditLog(data ?? [])
    setAuditLoading(false)
  }, [showToast])

  const loadAll = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      const [settingsRes, apartmentsRes, roomsRes, tenantsRes, priceGroupsRes] = await Promise.all([
        supabase.from('app_settings').select('*').single(),
        supabase.from('apartments').select('*'),
        supabase.from('rooms').select('*'),
        supabase.from('tenants').select('*').is('deleted_at', null),
        supabase.from('room_price_groups').select('*'),
      ])
      if (settingsRes.error) showToast(settingsRes.error.message)
      if (apartmentsRes.error) showToast(apartmentsRes.error.message)
      if (roomsRes.error) showToast(roomsRes.error.message)
      if (tenantsRes.error) showToast(tenantsRes.error.message)
      if (priceGroupsRes.error) showToast(priceGroupsRes.error.message)

      let updatedBy: Profile | null = null
      if (settingsRes.data?.updated_by) {
        const { data: p } = await supabase.from('profiles').select('*').eq('id', settingsRes.data.updated_by).single()
        updatedBy = p ?? null
      }

      const data: SettingsData = {
        settings: settingsRes.data ?? null,
        apartments: [...(apartmentsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.name, b.name)),
        rooms: [...(roomsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.label, b.label)),
        tenants: tenantsRes.data ?? [],
        priceGroups: [...(priceGroupsRes.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
        updatedByProfile: updatedBy,
      }
      setCached(CACHE_KEY, data)
      setSettings(data.settings)
      setSharedRate(data.settings ? String(data.settings.default_shared_rate_per_pax) : '')
      setPrivateRate(data.settings ? String(data.settings.default_private_rate_per_pax) : '')
      setElectricityAllowance(data.settings ? String(data.settings.electricity_allowance_per_tenant) : '')
      setWaterAllowance(data.settings ? String(data.settings.water_allowance_per_tenant) : '')
      setBizName(data.settings?.business_name ?? '')
      setBizAddress(data.settings?.business_address ?? '')
      setBizContact(data.settings?.business_contact ?? '')
      setBizPayInstructions(data.settings?.payment_instructions ?? '')
      setApartments(data.apartments)
      setRooms(data.rooms)
      setTenants(data.tenants)
      setPriceGroups(data.priceGroups)
      setUpdatedByProfile(data.updatedByProfile)
      setLoading(false)
    },
    [showToast],
  )

  useEffect(() => {
    loadAll(hasCached(CACHE_KEY))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAll])

  useEffect(() => {
    if (activeTab === 'activity') loadAudit()
    if (activeTab === 'errors') loadErrors()
    if (activeTab === 'users') loadUsers()
  }, [activeTab, loadAudit, loadErrors, loadUsers])

  async function handleSave() {
    const shared = Number(sharedRate)
    const priv = Number(privateRate)
    if (!shared || shared <= 0 || !priv || priv <= 0) {
      showToast('Enter valid rates greater than 0 for both shared and private.')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('app_settings')
      .update({
        default_shared_rate_per_pax: shared,
        default_private_rate_per_pax: priv,
        updated_by: profile?.id,
      })
      .eq('id', true)
    setSaving(false)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Default rates updated.')
    loadAll(true)
  }

  async function handleSaveAllowances() {
    const electricity = Number(electricityAllowance)
    const water = Number(waterAllowance)
    if (electricity < 0 || water < 0 || Number.isNaN(electricity) || Number.isNaN(water)) {
      showToast('Enter valid allowance amounts for both electricity and water.')
      return
    }
    setSavingAllowances(true)
    const { error } = await supabase
      .from('app_settings')
      .update({
        electricity_allowance_per_tenant: electricity,
        water_allowance_per_tenant: water,
        updated_by: profile?.id,
      })
      .eq('id', true)
    setSavingAllowances(false)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Utility allowances updated.')
    loadAll(true)
  }

  async function handleSaveOrg() {
    if (!bizName.trim()) {
      showToast('Business name is required.')
      return
    }
    setSavingOrg(true)
    const { error } = await supabase
      .from('app_settings')
      .update({
        business_name: bizName.trim(),
        business_address: bizAddress.trim() || null,
        business_contact: bizContact.trim() || null,
        payment_instructions: bizPayInstructions.trim() || null,
        updated_by: profile?.id,
      })
      .eq('id', true)
    setSavingOrg(false)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Organization details updated.')
    loadAll(true)
  }

  async function deletePriceGroup(group: RoomPriceGroup) {
    const roomCount = rooms.filter((r) => r.price_group_id === group.id).length
    const warn = roomCount > 0 ? ` ${roomCount} room(s) using it will revert to the global default rate.` : ''
    if (!window.confirm(`Delete pricing group "${group.name}"?${warn}`)) return
    const { error } = await supabase.from('room_price_groups').delete().eq('id', group.id)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Pricing group deleted.')
    loadAll(true)
  }

  if (loading) {
    return (
      <>
        <div className="page-head">
          <div>
            <h2>Settings</h2>
          </div>
        </div>
        <div className="tab-bar">
          <SkeletonBlock width={110} height={30} radius={8} style={{ marginRight: 12 }} />
          <SkeletonBlock width={150} height={30} radius={8} style={{ marginRight: 12 }} />
          <SkeletonBlock width={140} height={30} radius={8} />
        </div>
        <div className="table-wrap" style={{ padding: '20px 24px', maxWidth: 520 }}>
          <SkeletonBlock width="100%" height={12} style={{ marginBottom: 8 }} />
          <SkeletonBlock width="70%" height={12} style={{ marginBottom: 20 }} />
          <div className="form-row">
            <SkeletonBlock height={38} />
            <SkeletonBlock height={38} />
          </div>
        </div>
      </>
    )
  }

  // tenants with a per-tenant custom rate override (excluding moved-out ones)
  const overrides = tenants
    .filter((t) => t.custom_rate_per_pax != null && t.status !== 'inactive')
    .sort((a, b) => naturalSort.compare(a.tenant_number, b.tenant_number))
  const dirty = settings
    ? Number(sharedRate) !== settings.default_shared_rate_per_pax || Number(privateRate) !== settings.default_private_rate_per_pax
    : false
  const allowancesDirty = settings
    ? Number(electricityAllowance) !== settings.electricity_allowance_per_tenant ||
      Number(waterAllowance) !== settings.water_allowance_per_tenant
    : false

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <div className="page-sub">Admin-only — pricing defaults and per-tenant overrides</div>
        </div>
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

      {activeTab === 'rates' && (
        <>
          <div className="table-wrap" style={{ padding: '20px 24px', maxWidth: 520 }}>
            <p className="hint" style={{ marginBottom: 16 }}>
              These are the ₱-per-pax rates used for any room in Shared or Private mode that isn't in a
              pricing group. Changing them updates every room using the default immediately.
            </p>
            <div className="form-row">
              <div className="form-group">
                <label>Shared rate (₱/pax)</label>
                <input type="number" min={0} value={sharedRate} onChange={(e) => setSharedRate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Private rate (₱/pax)</label>
                <input type="number" min={0} value={privateRate} onChange={(e) => setPrivateRate(e.target.value)} />
              </div>
            </div>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save default rates'}
            </button>
            {settings && (
              <div className="hint" style={{ marginTop: 12 }}>
                Last updated {fmtDate(settings.updated_at.slice(0, 10))}
                {updatedByProfile ? ` by ${updatedByProfile.full_name || 'a team member'}` : ''}.
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'groups' && (
        <>
          <div className="page-head" style={{ marginBottom: 12 }}>
            <div className="section-title" style={{ margin: 0 }}>
              Room pricing groups
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setPriceGroupModal({ mode: 'add' })}>
              + Add pricing group
            </button>
          </div>
          <div className="table-wrap" style={{ marginBottom: 28 }}>
            <p className="hint" style={{ padding: '16px 24px 0' }}>
              Apply one shared/private rate pair to many rooms at once — e.g. "Apt 1-6 · Rooms A/B".
              A tenant can still be given their own custom rate on the Tenants page.
            </p>
            {priceGroups.length === 0 ? (
              <div className="empty-state">
                <h3>No pricing groups yet</h3>
                <p>Add one to price a set of identical rooms across apartments in one go.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Shared Rate</th>
                    <th>Private Rate</th>
                    <th>Rooms</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {priceGroups.map((group) => {
                    const roomCount = rooms.filter((r) => r.price_group_id === group.id).length
                    return (
                      <tr key={group.id}>
                        <td className="name-cell">{group.name}</td>
                        <td>{fmtMoney(group.shared_rate_per_pax)}/pax</td>
                        <td>{fmtMoney(group.private_rate_per_pax)}/pax</td>
                        <td>{roomCount}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setPriceGroupModal({ mode: 'edit', group })}
                            >
                              Edit
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => deletePriceGroup(group)}>
                              Delete
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
        </>
      )}

      {activeTab === 'utilities' && (
        <div className="table-wrap" style={{ padding: '20px 24px', maxWidth: 520 }}>
          <p className="hint" style={{ marginBottom: 16 }}>
            Each tenant's rent is assumed to cover this much electricity/water per head. If an
            apartment's actual utility bill for a month exceeds (allowance × current occupants), the
            excess is split evenly across that apartment's current tenants and added to what each
            owes.
          </p>
          <div className="form-row form-row-align">
            <div className="form-group">
              <label>Electricity allowance (₱/tenant)</label>
              <input
                type="number"
                min={0}
                value={electricityAllowance}
                onChange={(e) => setElectricityAllowance(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Water allowance (₱/tenant)</label>
              <input type="number" min={0} value={waterAllowance} onChange={(e) => setWaterAllowance(e.target.value)} />
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSaveAllowances}
            disabled={savingAllowances || !allowancesDirty}
          >
            {savingAllowances ? 'Saving…' : 'Save utility allowances'}
          </button>
        </div>
      )}

      {activeTab === 'overrides' && (
        <div className="table-wrap">
          {overrides.length === 0 ? (
            <div className="empty-state">
              <h3>No overrides set</h3>
              <p>Every tenant currently pays their room's standard rate.</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Tenant No.</th>
                  <th>Tenant</th>
                  <th>Room</th>
                  <th>Custom Rate</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((t) => {
                  const room = rooms.find((r) => r.id === t.room_id)
                  return (
                    <tr key={t.id}>
                      <td className="mono">{t.tenant_number}</td>
                      <td className="name-cell">
                        {t.first_name} {t.last_name}
                      </td>
                      <td className="mono">{room?.label ?? '—'}</td>
                      <td>{fmtMoney(t.custom_rate_per_pax ?? 0)}/mo</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div className="hint" style={{ padding: '12px 24px' }}>
            Set or clear a tenant's custom rate from their edit form on the Tenants page.
          </div>
        </div>
      )}

      {activeTab === 'organization' && (
        <div className="table-wrap" style={{ padding: '20px 24px', maxWidth: 520 }}>
          <p className="hint" style={{ marginBottom: 16 }}>
            These details print at the top of every receipt and statement of account you give a tenant.
          </p>
          <div className="form-group">
            <label>Business name</label>
            <input value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="Victoria Residence" />
          </div>
          <div className="form-group">
            <label>Address</label>
            <input
              value={bizAddress}
              onChange={(e) => setBizAddress(e.target.value)}
              placeholder="123 Sample St., Barangay, City"
            />
          </div>
          <div className="form-group">
            <label>Contact number / email</label>
            <input
              value={bizContact}
              onChange={(e) => setBizContact(e.target.value)}
              placeholder="0917 000 0000 · victoria@email.com"
            />
          </div>
          <div className="form-group">
            <label>Payment instructions</label>
            <textarea
              rows={3}
              value={bizPayInstructions}
              onChange={(e) => setBizPayInstructions(e.target.value)}
              placeholder="e.g. GCash: 0917 000 0000 (Juan D.) · or BPI 1234-5678-90"
            />
            <div className="hint">Included in the rent reminders you send tenants, so they know where to pay.</div>
          </div>
          <button className="btn btn-primary" onClick={handleSaveOrg} disabled={savingOrg}>
            {savingOrg ? 'Saving…' : 'Save organization details'}
          </button>
        </div>
      )}

      {activeTab === 'users' && (
        <>
          <div className="page-head" style={{ marginBottom: 12 }}>
            <p className="hint" style={{ margin: 0, maxWidth: 620 }}>
              People who can sign in. New accounts start as staff — promote to admin here. Staff can view and log
              data; admins can also manage pricing, expenses, users, and settings.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => setAddUserOpen(true)}>
              + Add user
            </button>
          </div>
          {usersLoading && users.length === 0 ? (
            <SkeletonTable rows={4} cols={3} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Username</th>
                    <th>Role</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="name-cell">
                        {u.full_name || '—'} {u.id === profile?.id && <span className="sub-cell">(you)</span>}
                      </td>
                      <td className="mono">{u.username || '—'}</td>
                      <td>
                        <span className={`badge ${u.role === 'admin' ? 'badge-active' : 'badge-pending'}`}>
                          {u.role === 'admin' ? 'Admin' : 'Staff'}
                        </span>
                      </td>
                      <td>
                        {u.id !== profile?.id && (
                          <div className="row-actions">
                            {u.role === 'user' ? (
                              <button className="btn btn-ghost btn-sm" onClick={() => changeRole(u, 'admin')}>
                                Make admin
                              </button>
                            ) : (
                              <button className="btn btn-ghost btn-sm" onClick={() => changeRole(u, 'user')}>
                                Make staff
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeTab === 'backup' && (
        <BackupPanel
          exporting={exporting}
          onExport={handleExport}
          // backupTick forces this to re-read the stored timestamp after an export
          key={backupTick}
        />
      )}

      {activeTab === 'activity' && (
        <>
          <div className="page-head" style={{ marginBottom: 12 }}>
            <p className="hint" style={{ margin: 0, maxWidth: 620 }}>
              Every change to tenants, payments, deposits, rates, rooms, and pricing is recorded here —
              who did it and when. Entries can't be edited or deleted. Showing the 200 most recent.
            </p>
            <button className="btn btn-ghost btn-sm" onClick={loadAudit} disabled={auditLoading}>
              {auditLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {auditLoading && auditLog.length === 0 ? (
            <SkeletonTable rows={6} cols={4} />
          ) : auditLog.length === 0 ? (
            <div className="table-wrap">
              <div className="empty-state">
                <h3>No activity yet</h3>
                <p>Changes made in the app will show up here.</p>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((row) => {
                    const { action, badge, entity } = describeAudit(row)
                    return (
                      <tr key={row.id}>
                        <td className="sub-cell" style={{ whiteSpace: 'nowrap' }}>
                          {fmtDateTime(row.created_at)}
                        </td>
                        <td>{row.actor_name || '—'}</td>
                        <td>
                          <span className={`badge ${badge}`}>{action}</span>
                        </td>
                        <td>{entity}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeTab === 'errors' && (
        <>
          <div className="page-head" style={{ marginBottom: 12 }}>
            <p className="hint" style={{ margin: 0, maxWidth: 620 }}>
              Problems the app ran into for anyone using it — so you can see when something broke, and for whom,
              without them having to describe it. Showing the 100 most recent.
            </p>
            <button className="btn btn-ghost btn-sm" onClick={loadErrors} disabled={errorLoading}>
              {errorLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {errorLoading && errorLog.length === 0 ? (
            <SkeletonTable rows={5} cols={3} />
          ) : errorLog.length === 0 ? (
            <div className="table-wrap">
              <div className="empty-state">
                <h3>No errors logged</h3>
                <p>If the app hits a problem for anyone, it'll be recorded here.</p>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {errorLog.map((row) => (
                    <tr key={row.id}>
                      <td className="sub-cell" style={{ whiteSpace: 'nowrap' }}>
                        {fmtDateTime(row.created_at)}
                      </td>
                      <td>{row.user_name || '—'}</td>
                      <td>
                        {row.message}
                        {row.context && <div className="sub-cell">{row.context.split('\n')[0]}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {addUserOpen && (
        <AddUserModal
          onClose={() => setAddUserOpen(false)}
          onSaved={() => {
            setAddUserOpen(false)
            loadUsers()
          }}
        />
      )}

      {priceGroupModal && (
        <PriceGroupModal
          initial={priceGroupModal.mode === 'edit' ? priceGroupModal.group : null}
          apartments={apartments}
          rooms={rooms}
          onClose={() => setPriceGroupModal(null)}
          onSaved={() => {
            setPriceGroupModal(null)
            loadAll(true)
          }}
        />
      )}
    </>
  )
}

function BackupPanel({ exporting, onExport }: { exporting: boolean; onExport: () => void }) {
  const lastAt = getLastBackupAt()
  const days = daysSinceLastBackup()
  const stale = days == null || days >= BACKUP_STALE_DAYS

  return (
    <div className="table-wrap" style={{ padding: '20px 24px', maxWidth: 560 }}>
      <p className="hint" style={{ marginBottom: 16 }}>
        Your tenant, payment, and billing records live in one online database. This saves a complete
        copy to a file on this computer — keep it somewhere safe (a USB drive or Google Drive) so you
        can recover everything if that database is ever lost or damaged.
      </p>

      {stale && (
        <div
          className="hint"
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 8,
            background: 'var(--hover-tint, rgba(0,0,0,0.04))',
            borderLeft: '3px solid var(--clay, #b5654a)',
          }}
        >
          {days == null
            ? "You haven't saved a backup from this computer yet. It's a good idea to do one now."
            : `It's been ${days} day(s) since your last backup on this computer. Consider saving a fresh one.`}
        </div>
      )}

      <button className="btn btn-primary" onClick={onExport} disabled={exporting}>
        {exporting ? 'Preparing backup…' : 'Export all data'}
      </button>

      <div className="hint" style={{ marginTop: 12 }}>
        {lastAt
          ? `Last backup from this computer: ${fmtDateTime(lastAt)}.`
          : 'No backup has been saved from this computer yet.'}
        <br />
        The file is a complete snapshot (including archived records) and can be used to restore the
        database. It contains tenant and payment details, so store it privately.
      </div>
    </div>
  )
}

function AddUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast()
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!fullName.trim()) {
      showToast('Enter the person’s name.')
      return
    }
    const uname = username.trim().toLowerCase()
    if (!/^[a-z0-9._-]{3,}$/.test(uname)) {
      showToast('Username must be 3+ characters: letters, numbers, dots, dashes, underscores.')
      return
    }
    if (password.length < 6) {
      showToast('Password must be at least 6 characters.')
      return
    }
    setSaving(true)
    // Create the account via the create-user Edge Function, which uses the
    // Admin API server-side (service_role) — so there's no confirmation email
    // and no email rate limit, and the admin's own session is untouched. The
    // function verifies the caller is an admin and builds the synthetic email.
    const { data, error } = await supabase.functions.invoke('create-user', {
      body: { fullName: fullName.trim(), username: uname, password },
    })
    setSaving(false)
    if (error) {
      // a 4xx from the function carries a friendly message in its body
      let msg = 'Could not create the user. Make sure the create-user function is deployed in Supabase.'
      try {
        const body = await error.context.json()
        if (body?.error) msg = body.error
      } catch {
        // keep the generic message
      }
      showToast(msg)
      return
    }
    if (data?.error) {
      showToast(data.error)
      return
    }
    showToast(`Account created for ${fullName.trim()} (username: ${uname}).`)
    onSaved()
  }

  return (
    <Modal
      title="Add user"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Creating…' : 'Create account'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label>Full name</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Juan Dela Cruz" autoFocus />
      </div>
      <div className="form-group">
        <label>Username (used to sign in)</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. juan"
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>
      <div className="form-group">
        <label>Temporary password</label>
        <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="at least 6 characters" />
        <div className="hint">
          Give the username and password to the new user so they can sign in. New accounts start as staff — promote to
          admin from the list if needed.
        </div>
      </div>
    </Modal>
  )
}

function PriceGroupModal({
  initial,
  apartments,
  rooms,
  onClose,
  onSaved,
}: {
  initial: RoomPriceGroup | null
  apartments: Apartment[]
  rooms: Room[]
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()

  const [name, setName] = useState(initial?.name ?? '')
  const [sharedRate, setSharedRate] = useState(initial ? String(initial.shared_rate_per_pax) : '')
  const [privateRate, setPrivateRate] = useState(initial ? String(initial.private_rate_per_pax) : '')
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(
    new Set(rooms.filter((r) => r.price_group_id === initial?.id).map((r) => r.id)),
  )
  const [saving, setSaving] = useState(false)

  function toggleRoom(roomId: string) {
    setSelectedRoomIds((prev) => {
      const next = new Set(prev)
      if (next.has(roomId)) next.delete(roomId)
      else next.add(roomId)
      return next
    })
  }

  async function handleSave() {
    if (!name.trim()) {
      showToast('Name is required.')
      return
    }
    const shared = Number(sharedRate)
    const priv = Number(privateRate)
    if (!shared || shared <= 0 || !priv || priv <= 0) {
      showToast('Enter valid rates greater than 0 for both shared and private.')
      return
    }

    setSaving(true)

    let groupId = initial?.id
    if (initial) {
      const { error } = await supabase
        .from('room_price_groups')
        .update({ name: name.trim(), shared_rate_per_pax: shared, private_rate_per_pax: priv })
        .eq('id', initial.id)
      if (error) {
        setSaving(false)
        showToast(error.message)
        return
      }
    } else {
      const { data, error } = await supabase
        .from('room_price_groups')
        .insert({ name: name.trim(), shared_rate_per_pax: shared, private_rate_per_pax: priv })
        .select()
        .single()
      if (error || !data) {
        setSaving(false)
        showToast(error?.message ?? 'Could not create pricing group.')
        return
      }
      groupId = data.id
    }

    const previouslyAssigned = new Set(rooms.filter((r) => r.price_group_id === groupId).map((r) => r.id))
    const toAdd = [...selectedRoomIds].filter((id) => !previouslyAssigned.has(id))
    const toRemove = [...previouslyAssigned].filter((id) => !selectedRoomIds.has(id))

    if (toAdd.length > 0) {
      const { error } = await supabase.from('rooms').update({ price_group_id: groupId }).in('id', toAdd)
      if (error) {
        setSaving(false)
        showToast(error.message)
        return
      }
    }
    if (toRemove.length > 0) {
      const { error } = await supabase.from('rooms').update({ price_group_id: null }).in('id', toRemove)
      if (error) {
        setSaving(false)
        showToast(error.message)
        return
      }
    }

    setSaving(false)
    showToast(initial ? 'Pricing group updated.' : 'Pricing group created.')
    onSaved()
  }

  return (
    <Modal
      title={initial ? `Edit ${initial.name}` : 'Add pricing group'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Create group'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Apt 1-6 · Rooms A/B" autoFocus />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Shared rate (₱/pax)</label>
          <input type="number" min={0} value={sharedRate} onChange={(e) => setSharedRate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Private rate (₱/pax)</label>
          <input type="number" min={0} value={privateRate} onChange={(e) => setPrivateRate(e.target.value)} />
        </div>
      </div>

      <div className="fieldset-title">Applies to these rooms</div>
      <div className="hint" style={{ marginBottom: 10 }}>
        Check every room this pricing should apply to. Rooms already in a different group will be moved into
        this one.
      </div>
      {apartments.map((apartment) => {
        const apartmentRooms = rooms.filter((r) => r.apartment_id === apartment.id)
        if (apartmentRooms.length === 0) return null
        return (
          <div key={apartment.id} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>{apartment.name}</div>
            <div className="room-list">
              {apartmentRooms.map((room) => {
                const inOtherGroup = room.price_group_id && room.price_group_id !== initial?.id
                return (
                  <label
                    key={room.id}
                    className="room-row"
                    style={{ cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={selectedRoomIds.has(room.id)}
                        onChange={() => toggleRoom(room.id)}
                        style={{ width: 'auto' }}
                      />
                      <span className="room-id">{room.label}</span>
                      <span className="room-type">{room.mode === 'private' ? 'Private' : 'Shared'}</span>
                    </div>
                    {inOtherGroup && <span className="hint">in another group</span>}
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </Modal>
  )
}

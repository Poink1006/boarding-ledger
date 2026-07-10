import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Modal } from '../components/Modal'
import { naturalSort } from '../lib/rooms'
import { fmtMoney, fmtDate } from '../lib/format'
import type { Database } from '../lib/database.types'

type AppSettings = Database['public']['Tables']['app_settings']['Row']
type Apartment = Database['public']['Tables']['apartments']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type Profile = Database['public']['Tables']['profiles']['Row']
type RoomPriceGroup = Database['public']['Tables']['room_price_groups']['Row']

type PriceGroupModalState = { mode: 'add' } | { mode: 'edit'; group: RoomPriceGroup } | null

const TABS = [
  { id: 'rates', label: 'Default rates' },
  { id: 'groups', label: 'Room pricing groups' },
  { id: 'utilities', label: 'Utility allowances' },
  { id: 'overrides', label: 'Custom overrides' },
] as const
type TabId = (typeof TABS)[number]['id']

export function Settings() {
  const { profile } = useAuth()
  const { showToast } = useToast()
  const [activeTab, setActiveTab] = useState<TabId>('rates')

  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [priceGroups, setPriceGroups] = useState<RoomPriceGroup[]>([])
  const [updatedByProfile, setUpdatedByProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [priceGroupModal, setPriceGroupModal] = useState<PriceGroupModalState>(null)

  const [sharedRate, setSharedRate] = useState('')
  const [privateRate, setPrivateRate] = useState('')
  const [saving, setSaving] = useState(false)

  const [electricityAllowance, setElectricityAllowance] = useState('')
  const [waterAllowance, setWaterAllowance] = useState('')
  const [savingAllowances, setSavingAllowances] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [settingsRes, apartmentsRes, roomsRes, priceGroupsRes] = await Promise.all([
      supabase.from('app_settings').select('*').single(),
      supabase.from('apartments').select('*'),
      supabase.from('rooms').select('*'),
      supabase.from('room_price_groups').select('*'),
    ])
    if (settingsRes.error) showToast(settingsRes.error.message)
    if (apartmentsRes.error) showToast(apartmentsRes.error.message)
    if (roomsRes.error) showToast(roomsRes.error.message)
    if (priceGroupsRes.error) showToast(priceGroupsRes.error.message)

    setSettings(settingsRes.data ?? null)
    setSharedRate(settingsRes.data ? String(settingsRes.data.default_shared_rate_per_pax) : '')
    setPrivateRate(settingsRes.data ? String(settingsRes.data.default_private_rate_per_pax) : '')
    setElectricityAllowance(settingsRes.data ? String(settingsRes.data.electricity_allowance_per_tenant) : '')
    setWaterAllowance(settingsRes.data ? String(settingsRes.data.water_allowance_per_tenant) : '')
    setApartments([...(apartmentsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.name, b.name)))
    setRooms([...(roomsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.label, b.label)))
    setPriceGroups([...(priceGroupsRes.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)))

    if (settingsRes.data?.updated_by) {
      const { data: p } = await supabase.from('profiles').select('*').eq('id', settingsRes.data.updated_by).single()
      setUpdatedByProfile(p ?? null)
    } else {
      setUpdatedByProfile(null)
    }
    setLoading(false)
  }, [showToast])

  useEffect(() => {
    loadAll()
  }, [loadAll])

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
    loadAll()
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
    loadAll()
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
    loadAll()
  }

  if (loading) {
    return (
      <div className="empty-state">
        <h3>Loading settings…</h3>
      </div>
    )
  }

  const overrides = rooms.filter((r) => r.custom_rate_per_pax != null)
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
          <div className="page-sub">Admin-only — pricing defaults and per-room overrides</div>
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
              These are the ₱-per-pax rates used for any room left in Shared or Private mode without a
              custom override. Changing them updates every room using the default immediately.
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
              Rooms with their own custom rate override still take priority over a group.
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
              <p>Every room currently uses the default shared/private rate above.</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Apartment</th>
                  <th>Room</th>
                  <th>Mode</th>
                  <th>Custom Rate</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((r) => {
                  const apartment = apartments.find((a) => a.id === r.apartment_id)
                  return (
                    <tr key={r.id}>
                      <td>{apartment?.name ?? '—'}</td>
                      <td className="mono">{r.label}</td>
                      <td>{r.mode === 'private' ? 'Private' : 'Shared'}</td>
                      <td>{fmtMoney(r.custom_rate_per_pax ?? 0)}/pax</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div className="hint" style={{ padding: '12px 24px' }}>
            Edit or clear an override from the room's edit form on the Units &amp; Rooms page.
          </div>
        </div>
      )}

      {priceGroupModal && (
        <PriceGroupModal
          initial={priceGroupModal.mode === 'edit' ? priceGroupModal.group : null}
          apartments={apartments}
          rooms={rooms}
          onClose={() => setPriceGroupModal(null)}
          onSaved={() => {
            setPriceGroupModal(null)
            loadAll()
          }}
        />
      )}
    </>
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

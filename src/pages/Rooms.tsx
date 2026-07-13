import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Modal } from '../components/Modal'
import { effectiveCapacity, effectiveRate, naturalSort } from '../lib/rooms'
import { fmtMoney } from '../lib/format'
import { occupiesBed, TENANT_STATUS_LABEL, TENANT_STATUS_BADGE } from '../lib/tenantStatus'
import { SkeletonCardGrid } from '../components/Skeleton'
import { getCached, setCached, hasCached } from '../lib/cache'
import type { Database, RoomMode } from '../lib/database.types'

type Apartment = Database['public']['Tables']['apartments']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type AppSettings = Database['public']['Tables']['app_settings']['Row']
type RoomPriceGroup = Database['public']['Tables']['room_price_groups']['Row']

type ApartmentModalState = { mode: 'add' } | { mode: 'edit'; apartment: Apartment } | null
type RoomModalState = { mode: 'add'; apartmentId: string } | { mode: 'edit'; room: Room } | null

const CACHE_KEY = 'rooms'
interface RoomsData {
  apartments: Apartment[]
  rooms: Room[]
  tenants: Tenant[]
  settings: AppSettings | null
  priceGroups: RoomPriceGroup[]
  occupancy: Record<string, number>
}

export function Rooms() {
  const { isAdmin } = useAuth()
  const { showToast } = useToast()

  const cached = getCached<RoomsData>(CACHE_KEY)
  const [apartments, setApartments] = useState<Apartment[]>(cached?.apartments ?? [])
  const [rooms, setRooms] = useState<Room[]>(cached?.rooms ?? [])
  const [tenants, setTenants] = useState<Tenant[]>(cached?.tenants ?? [])
  const [settings, setSettings] = useState<AppSettings | null>(cached?.settings ?? null)
  const [priceGroups, setPriceGroups] = useState<RoomPriceGroup[]>(cached?.priceGroups ?? [])
  const [occupancy, setOccupancy] = useState<Record<string, number>>(cached?.occupancy ?? {})
  const [loading, setLoading] = useState(!cached)

  const [apartmentModal, setApartmentModal] = useState<ApartmentModalState>(null)
  const [roomModal, setRoomModal] = useState<RoomModalState>(null)
  const [tenantsModalRoom, setTenantsModalRoom] = useState<Room | null>(null)

  const loadAll = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      const [apartmentsRes, roomsRes, settingsRes, tenantsRes, priceGroupsRes] = await Promise.all([
        supabase.from('apartments').select('*'),
        supabase.from('rooms').select('*'),
        supabase.from('app_settings').select('*').single(),
        supabase.from('tenants').select('*').is('deleted_at', null),
        supabase.from('room_price_groups').select('*'),
      ])
      if (apartmentsRes.error) showToast(apartmentsRes.error.message)
      if (roomsRes.error) showToast(roomsRes.error.message)
      if (settingsRes.error) showToast(settingsRes.error.message)
      if (tenantsRes.error) showToast(tenantsRes.error.message)
      if (priceGroupsRes.error) showToast(priceGroupsRes.error.message)

      const sortedApartments = [...(apartmentsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.name, b.name))
      const sortedRooms = [...(roomsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.label, b.label))
      const activeTenants = (tenantsRes.data ?? []).filter((t) => occupiesBed(t.status))
      const counts: Record<string, number> = {}
      for (const t of activeTenants) {
        if (t.room_id) counts[t.room_id] = (counts[t.room_id] ?? 0) + 1
      }

      const data: RoomsData = {
        apartments: sortedApartments,
        rooms: sortedRooms,
        tenants: activeTenants,
        settings: settingsRes.data ?? null,
        priceGroups: priceGroupsRes.data ?? [],
        occupancy: counts,
      }
      setCached(CACHE_KEY, data)
      setApartments(data.apartments)
      setRooms(data.rooms)
      setSettings(data.settings)
      setPriceGroups(data.priceGroups)
      setTenants(data.tenants)
      setOccupancy(data.occupancy)
      setLoading(false)
    },
    [showToast],
  )

  useEffect(() => {
    loadAll(hasCached(CACHE_KEY))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAll])

  async function deleteApartment(apartment: Apartment) {
    const apartmentRooms = rooms.filter((r) => r.apartment_id === apartment.id)
    const hasTenants = apartmentRooms.some((r) => (occupancy[r.id] ?? 0) > 0)
    const warn = hasTenants
      ? ' This apartment has tenants assigned — deleting it will unassign them from their rooms.'
      : ''
    if (!window.confirm(`Delete ${apartment.name} and its ${apartmentRooms.length} room(s)?${warn}`)) return
    const { error } = await supabase.from('apartments').delete().eq('id', apartment.id)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Apartment deleted.')
    loadAll(true)
  }

  async function deleteRoom(room: Room) {
    const occ = occupancy[room.id] ?? 0
    const warn = occ > 0 ? ` ${occ} tenant(s) will be unassigned.` : ''
    if (!window.confirm(`Delete room "${room.label}"?${warn}`)) return
    const { error } = await supabase.from('rooms').delete().eq('id', room.id)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Room deleted.')
    loadAll(true)
  }

  if (loading) {
    return (
      <>
        <div className="page-head">
          <div>
            <h2>Units &amp; Rooms</h2>
          </div>
        </div>
        <SkeletonCardGrid count={6} />
      </>
    )
  }

  const totalCapacity = rooms.reduce((s, r) => s + effectiveCapacity(r), 0)
  const totalOccupied = Object.values(occupancy).reduce((s, n) => s + n, 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Units &amp; Rooms</h2>
          <div className="page-sub">
            {apartments.length} apartment{apartments.length === 1 ? '' : 's'} · {rooms.length} room
            {rooms.length === 1 ? '' : 's'} · {totalOccupied}/{totalCapacity} beds occupied
          </div>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => setApartmentModal({ mode: 'add' })}>
            + Add apartment
          </button>
        )}
      </div>

      {apartments.length === 0 ? (
        <div className="empty-state">
          <h3>No apartments yet</h3>
          <p>
            {isAdmin
              ? 'Add your first apartment to start laying out rooms.'
              : 'Ask an admin to set up apartments and rooms.'}
          </p>
        </div>
      ) : (
        <div className="units-grid">
          {apartments.map((apartment) => {
            const apartmentRooms = rooms.filter((r) => r.apartment_id === apartment.id)
            const cap = apartmentRooms.reduce((s, r) => s + effectiveCapacity(r), 0)
            const occ = apartmentRooms.reduce((s, r) => s + (occupancy[r.id] ?? 0), 0)
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
                    const rate = effectiveRate(room, settings, priceGroups)
                    const roomOcc = occupancy[room.id] ?? 0
                    const dots = Array.from({ length: effCap }, (_, i) => i < roomOcc)
                    const modeLabel = room.mode === 'private' ? 'Private' : 'Shared'
                    return (
                      <div
                        className="room-row"
                        key={room.id}
                        onClick={() =>
                          isAdmin ? setRoomModal({ mode: 'edit', room }) : setTenantsModalRoom(room)
                        }
                        style={{ cursor: 'pointer' }}
                      >
                        <div>
                          <span className="room-id">{room.label}</span>
                          <span className="room-type">
                            {modeLabel} · {fmtMoney(rate)}/pax
                          </span>
                        </div>
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
                {isAdmin && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setRoomModal({ mode: 'add', apartmentId: apartment.id })}
                    >
                      + Room
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setApartmentModal({ mode: 'edit', apartment })}
                    >
                      Rename
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteApartment(apartment)}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {apartmentModal && (
        <ApartmentModal
          initial={apartmentModal.mode === 'edit' ? apartmentModal.apartment : null}
          onClose={() => setApartmentModal(null)}
          onSaved={() => {
            setApartmentModal(null)
            loadAll(true)
          }}
        />
      )}

      {roomModal && (
        <RoomModal
          initial={roomModal.mode === 'edit' ? roomModal.room : null}
          apartmentId={roomModal.mode === 'add' ? roomModal.apartmentId : roomModal.room.apartment_id}
          settings={settings}
          priceGroups={priceGroups}
          occupancy={occupancy}
          onClose={() => setRoomModal(null)}
          onSaved={() => {
            setRoomModal(null)
            loadAll(true)
          }}
          onDelete={
            roomModal.mode === 'edit'
              ? () => {
                  const room = roomModal.room
                  setRoomModal(null)
                  deleteRoom(room)
                }
              : undefined
          }
        />
      )}

      {tenantsModalRoom && (
        <Modal title={tenantsModalRoom.label} onClose={() => setTenantsModalRoom(null)}>
          <div className="status-legend">
            {(Object.keys(TENANT_STATUS_LABEL) as (keyof typeof TENANT_STATUS_LABEL)[])
              .filter((s) => s !== 'inactive')
              .map((status) => (
                <span className="legend-item" key={status}>
                  <span className={`badge ${TENANT_STATUS_BADGE[status]}`}>{TENANT_STATUS_LABEL[status]}</span>
                </span>
              ))}
          </div>
          {tenants.filter((t) => t.room_id === tenantsModalRoom.id).length === 0 ? (
            <div className="hint">No tenants currently assigned to this room.</div>
          ) : (
            <div className="room-tenant-list">
              {tenants
                .filter((t) => t.room_id === tenantsModalRoom.id)
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

function ApartmentModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Apartment | null
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [name, setName] = useState(initial?.name ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) {
      showToast('Apartment name is required.')
      return
    }
    setSaving(true)
    const { error } = initial
      ? await supabase.from('apartments').update({ name: name.trim() }).eq('id', initial.id)
      : await supabase.from('apartments').insert({ name: name.trim() })
    setSaving(false)
    if (error) {
      showToast(error.message)
      return
    }
    showToast(initial ? 'Apartment updated.' : 'Apartment added.')
    onSaved()
  }

  return (
    <Modal
      title={initial ? 'Rename apartment' : 'Add apartment'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label>Apartment name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Apartment 1" />
      </div>
    </Modal>
  )
}

function RoomModal({
  initial,
  apartmentId,
  settings,
  priceGroups,
  occupancy,
  onClose,
  onSaved,
  onDelete,
}: {
  initial: Room | null
  apartmentId: string
  settings: AppSettings | null
  priceGroups: RoomPriceGroup[]
  occupancy: Record<string, number>
  onClose: () => void
  onSaved: () => void
  onDelete?: () => void
}) {
  const { showToast } = useToast()
  const [label, setLabel] = useState(initial?.label ?? '')
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? 4))
  const [mode, setMode] = useState<RoomMode>(initial?.mode ?? 'shared')
  const [privateCapacity, setPrivateCapacity] = useState(
    initial?.private_capacity != null ? String(initial.private_capacity) : '',
  )
  const [saving, setSaving] = useState(false)

  const priceGroup = initial?.price_group_id ? priceGroups.find((g) => g.id === initial.price_group_id) : null
  const fallbackRate = priceGroup
    ? mode === 'private'
      ? priceGroup.private_rate_per_pax
      : priceGroup.shared_rate_per_pax
    : mode === 'private'
      ? settings?.default_private_rate_per_pax
      : settings?.default_shared_rate_per_pax
  const currentOccupancy = initial ? occupancy[initial.id] ?? 0 : 0

  async function handleSave() {
    const cap = Number(capacity)
    if (!label.trim() || !cap || cap < 1) {
      showToast('Room label and a valid capacity are required.')
      return
    }
    const privCap = privateCapacity.trim() ? Number(privateCapacity) : null
    if (mode === 'private' && privCap != null && privCap > cap) {
      showToast('Private capacity cannot exceed normal capacity.')
      return
    }
    const effCap = mode === 'private' ? privCap ?? cap : cap
    if (currentOccupancy > effCap) {
      showToast(`This room has ${currentOccupancy} tenant(s) assigned — move them out first or raise capacity.`)
      return
    }

    const payload = {
      apartment_id: apartmentId,
      label: label.trim(),
      capacity: cap,
      mode,
      private_capacity: privCap,
    }
    setSaving(true)
    const { error } = initial
      ? await supabase.from('rooms').update(payload).eq('id', initial.id)
      : await supabase.from('rooms').insert(payload)
    setSaving(false)
    if (error) {
      showToast(error.message)
      return
    }
    showToast(initial ? 'Room updated.' : 'Room added.')
    onSaved()
  }

  return (
    <Modal
      title={initial ? `Edit ${initial.label}` : 'Add room'}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete} style={{ marginRight: 'auto' }}>
              Delete
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <div className="form-group">
          <label>Room label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Room 1" autoFocus />
        </div>
        <div className="form-group">
          <label>Capacity (pax)</label>
          <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as RoomMode)}>
          <option value="shared">Shared</option>
          <option value="private">Private</option>
        </select>
      </div>
      {mode === 'private' && (
        <div className="form-group">
          <label>Private capacity (pax)</label>
          <input
            type="number"
            min={1}
            value={privateCapacity}
            onChange={(e) => setPrivateCapacity(e.target.value)}
            placeholder={`Default: same as capacity (${capacity})`}
          />
          <div className="hint">How many people this room actually holds while in Private mode.</div>
        </div>
      )}
      <div className="form-group">
        <label>Rate (₱/pax)</label>
        <input value={fallbackRate != null ? `₱${fallbackRate.toLocaleString()}/pax` : '—'} disabled />
        <div className="hint">
          {priceGroup
            ? `From the "${priceGroup.name}" pricing group's ${mode} rate. Manage groups in Settings.`
            : `The ${mode} default rate set in Settings. To give one tenant a special rate, use their edit form on the Tenants page.`}
        </div>
      </div>
    </Modal>
  )
}

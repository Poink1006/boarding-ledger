import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import { effectiveCapacity, naturalSort } from '../lib/rooms'
import { occupiesBed } from '../lib/tenantStatus'
import { SkeletonCardGrid } from '../components/Skeleton'
import { getCached, setCached, hasCached } from '../lib/cache'
import type { Database } from '../lib/database.types'

type Apartment = Database['public']['Tables']['apartments']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

const CACHE_KEY = 'vacancies'
interface VacanciesData {
  apartments: Apartment[]
  rooms: Room[]
  tenants: Tenant[]
}

export function Vacancies() {
  const { showToast } = useToast()

  const cached = getCached<VacanciesData>(CACHE_KEY)
  const [apartments, setApartments] = useState<Apartment[]>(cached?.apartments ?? [])
  const [rooms, setRooms] = useState<Room[]>(cached?.rooms ?? [])
  const [tenants, setTenants] = useState<Tenant[]>(cached?.tenants ?? [])
  const [loading, setLoading] = useState(!cached)
  const [showFull, setShowFull] = useState(false)

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true)
      const [apartmentsRes, roomsRes, tenantsRes] = await Promise.all([
        supabase.from('apartments').select('*'),
        supabase.from('rooms').select('*'),
        supabase.from('tenants').select('*').is('deleted_at', null),
      ])
      if (apartmentsRes.error) showToast(apartmentsRes.error.message)
      if (roomsRes.error) showToast(roomsRes.error.message)
      if (tenantsRes.error) showToast(tenantsRes.error.message)
      const data: VacanciesData = {
        apartments: [...(apartmentsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.name, b.name)),
        rooms: [...(roomsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.label, b.label)),
        tenants: tenantsRes.data ?? [],
      }
      setCached(CACHE_KEY, data)
      setApartments(data.apartments)
      setRooms(data.rooms)
      setTenants(data.tenants)
      setLoading(false)
    },
    [showToast],
  )

  useEffect(() => {
    load(hasCached(CACHE_KEY))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  if (loading) {
    return (
      <>
        <div className="page-head">
          <div>
            <h2>Vacancies</h2>
          </div>
        </div>
        <SkeletonCardGrid count={4} />
      </>
    )
  }

  // per-room free-bed count from the current roster (pending + active hold a bed)
  const occupied = (roomId: string) => tenants.filter((t) => t.room_id === roomId && occupiesBed(t.status)).length
  const roomsWithFree = rooms.map((r) => ({ room: r, cap: effectiveCapacity(r), occ: occupied(r.id) }))
  const totalVacant = roomsWithFree.reduce((s, r) => s + Math.max(0, r.cap - r.occ), 0)
  const roomsWithVacancy = roomsWithFree.filter((r) => r.cap - r.occ > 0).length

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Vacancies</h2>
          <div className="page-sub">
            {totalVacant} open bed{totalVacant === 1 ? '' : 's'} across {roomsWithVacancy} room
            {roomsWithVacancy === 1 ? '' : 's'}
          </div>
        </div>
        <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={showFull} onChange={(e) => setShowFull(e.target.checked)} style={{ width: 'auto' }} />
          Show full rooms too
        </label>
      </div>

      {totalVacant === 0 && !showFull ? (
        <div className="empty-state">
          <h3>No vacancies</h3>
          <p>Every bed is currently taken. Tick "Show full rooms too" to see the full layout.</p>
        </div>
      ) : (
        <div className="units-grid">
          {apartments.map((apartment) => {
            const aptRooms = roomsWithFree
              .filter((r) => r.room.apartment_id === apartment.id)
              .filter((r) => showFull || r.cap - r.occ > 0)
            if (aptRooms.length === 0) return null
            const aptVacant = aptRooms.reduce((s, r) => s + Math.max(0, r.cap - r.occ), 0)
            return (
              <div className="unit-card" key={apartment.id}>
                <div className="unit-card-head">
                  <h4>{apartment.name}</h4>
                  <span className="unit-occ">
                    {aptVacant} open
                  </span>
                </div>
                <div className="room-list">
                  {aptRooms.map(({ room, cap, occ }) => {
                    const free = cap - occ
                    const occupants = tenants.filter((t) => t.room_id === room.id && occupiesBed(t.status))
                    return (
                      <div className="room-row" key={room.id} style={{ cursor: 'default', alignItems: 'flex-start' }}>
                        <div>
                          <span className="room-id">{room.label}</span>
                          <span className="room-type">{room.mode === 'private' ? 'Private' : 'Shared'}</span>
                          {occupants.length > 0 && (
                            <div className="sub-cell">
                              {occupants.map((t, i) => (
                                <span key={t.id}>
                                  {i > 0 && ', '}
                                  <Link to={`/tenants/${t.id}`} style={{ color: 'inherit' }}>
                                    {t.first_name} {t.last_name}
                                  </Link>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className={`badge ${free > 0 ? 'badge-paid' : 'badge-pending'}`}>
                          {free > 0 ? `${free} of ${cap} free` : 'Full'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

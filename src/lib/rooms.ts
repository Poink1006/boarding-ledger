import type { Database } from './database.types'

type Room = Database['public']['Tables']['rooms']['Row']
type AppSettings = Database['public']['Tables']['app_settings']['Row']
type RoomPriceGroup = Database['public']['Tables']['room_price_groups']['Row']

export function effectiveCapacity(room: Room) {
  return room.mode === 'private' ? room.private_capacity ?? room.capacity : room.capacity
}

// A room's rate: price group > global default. Per-tenant custom overrides
// (tenants.custom_rate_per_pax) are applied on top of this at assignment time,
// see the Tenants page — rooms themselves no longer carry an override.
export function effectiveRate(room: Room, settings: AppSettings | null, priceGroups: RoomPriceGroup[] = []) {
  if (room.price_group_id) {
    const group = priceGroups.find((g) => g.id === room.price_group_id)
    if (group) return room.mode === 'private' ? group.private_rate_per_pax : group.shared_rate_per_pax
  }
  if (!settings) return 0
  return room.mode === 'private' ? settings.default_private_rate_per_pax : settings.default_shared_rate_per_pax
}

// numeric-aware sort so "Room 2" < "Room 10" (plain string sort would put "Room 10" first)
export const naturalSort = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

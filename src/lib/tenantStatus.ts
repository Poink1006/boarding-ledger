import type { TenantStatus } from './database.types'

// pending and active tenants both hold their assigned bed; only inactive
// (moved out) frees it up for reassignment
export function occupiesBed(status: TenantStatus) {
  return status !== 'inactive'
}

// "pending" used to be labeled "Pending Deposit," but that clashed with the
// unrelated security deposit feature — renamed to avoid confusing staff
export const TENANT_STATUS_LABEL: Record<TenantStatus, string> = {
  pending: 'Reserved',
  active: 'Active',
  inactive: 'Moved out',
}

export const TENANT_STATUS_BADGE: Record<TenantStatus, string> = {
  pending: 'badge-partial',
  active: 'badge-active',
  inactive: 'badge-inactive',
}

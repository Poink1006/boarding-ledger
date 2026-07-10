import type { DepositStatus } from './database.types'

export const DEPOSIT_STATUS_LABEL: Record<DepositStatus, string> = {
  unpaid: 'Unpaid',
  held: 'Held',
  refunded: 'Refunded',
}

export const DEPOSIT_STATUS_BADGE: Record<DepositStatus, string> = {
  unpaid: 'badge-inactive',
  held: 'badge-active',
  refunded: 'badge-pending',
}

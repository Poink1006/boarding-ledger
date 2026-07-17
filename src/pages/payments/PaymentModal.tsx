import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { updateGuarded } from '../../lib/db'
import { useToast } from '../../contexts/ToastContext'
import { Modal } from '../../components/Modal'
import { todayStr } from '../../lib/format'
import type { Database, PaymentType } from '../../lib/database.types'

type Tenant = Database['public']['Tables']['tenants']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type Payment = Database['public']['Tables']['payments']['Row']

export function PaymentModal({
  tenantId,
  initial,
  defaultType,
  tenants,
  rooms,
  onClose,
  onSaved,
}: {
  tenantId: string
  initial: Payment | null
  defaultType: PaymentType
  tenants: Tenant[]
  rooms: Room[]
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()

  const [selectedTenantId, setSelectedTenantId] = useState(initial?.tenant_id ?? tenantId)
  const [paymentType, setPaymentType] = useState<PaymentType>(initial?.payment_type ?? defaultType)
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '')
  const [datePaid, setDatePaid] = useState(initial?.date_paid ?? todayStr())
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [saving, setSaving] = useState(false)

  const tenantLocked = !!initial || !!tenantId

  async function handleSave() {
    if (!selectedTenantId) {
      showToast('Please select a tenant.')
      return
    }
    const amountNum = Number(amount)
    if (!amountNum || amountNum <= 0) {
      showToast('Enter an amount greater than 0.')
      return
    }

    const payload = {
      tenant_id: selectedTenantId,
      payment_type: paymentType,
      amount: amountNum,
      date_paid: datePaid || todayStr(),
      notes: notes.trim() || null,
    }

    setSaving(true)
    // edits use an optimistic-locking guard so two staff can't silently
    // overwrite each other; a fresh insert has nothing to conflict with
    const errorMsg = initial
      ? (await updateGuarded('payments', initial, payload)).error
      : (await supabase.from('payments').insert(payload)).error?.message ?? null
    setSaving(false)
    if (errorMsg) {
      showToast(errorMsg)
      return
    }
    showToast(initial ? 'Payment updated.' : 'Payment logged.')
    onSaved()
  }

  return (
    <Modal
      title={initial ? 'Edit payment' : 'Log payment'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Log payment'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label>Tenant</label>
        <select
          value={selectedTenantId}
          onChange={(e) => setSelectedTenantId(e.target.value)}
          disabled={tenantLocked}
        >
          <option value="">— Select tenant —</option>
          {tenants.map((t) => {
            const room = rooms.find((r) => r.id === t.room_id)
            return (
              <option key={t.id} value={t.id}>
                {t.first_name} {t.last_name} — {room ? room.label : 'unassigned'}
              </option>
            )
          })}
        </select>
      </div>
      <div className="form-group">
        <label>What's this payment for?</label>
        <select value={paymentType} onChange={(e) => setPaymentType(e.target.value as PaymentType)}>
          <option value="rent">Rent</option>
          <option value="utility">Utilities</option>
        </select>
        <div className="hint">Rent and utility payments are tracked as separate balances.</div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Amount (₱)</label>
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <div className="form-group">
          <label>Date paid</label>
          <input type="date" value={datePaid} onChange={(e) => setDatePaid(e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Notes</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. covers 3 months in advance" />
      </div>
    </Modal>
  )
}

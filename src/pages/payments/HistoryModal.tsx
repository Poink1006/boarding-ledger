import { Modal } from '../../components/Modal'
import { computeTenantBalance } from '../../lib/balance'
import { fmtMoney, fmtDate } from '../../lib/format'
import type { Database } from '../../lib/database.types'

type Tenant = Database['public']['Tables']['tenants']['Row']
type Payment = Database['public']['Tables']['payments']['Row']

export function HistoryModal({
  tenant,
  payments,
  balance,
  isAdmin,
  onClose,
  onLogPayment,
  onEdit,
  onDelete,
  onReceipt,
}: {
  tenant: Tenant
  payments: Payment[]
  balance: ReturnType<typeof computeTenantBalance>
  isAdmin: boolean
  onClose: () => void
  onLogPayment: () => void
  onEdit: (payment: Payment) => void
  onDelete: (payment: Payment) => void
  onReceipt: (payment: Payment) => void
}) {
  const sorted = [...payments].sort((a, b) => (a.date_paid < b.date_paid ? 1 : -1))

  return (
    <Modal
      title={`${tenant.first_name} ${tenant.last_name} — payment history`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" onClick={onLogPayment}>
            + Log payment
          </button>
        </>
      }
    >
      <div className="fieldset-title" style={{ marginTop: 0 }}>
        Rent
      </div>
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Rent Due</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            {fmtMoney(balance.rentDue)}
          </div>
          <div className="stat-note">{balance.cyclesBilled} month(s) billed</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Rent Paid</div>
          <div className="stat-value sage" style={{ fontSize: 20 }}>
            {fmtMoney(balance.rentPaid)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Rent Balance</div>
          <div className={`stat-value ${balance.rentBalance < 0 ? 'clay' : 'sage'}`} style={{ fontSize: 20 }}>
            {balance.rentBalance < 0 ? `-${fmtMoney(-balance.rentBalance)}` : fmtMoney(balance.rentBalance)}
          </div>
        </div>
      </div>

      <div className="fieldset-title">Utilities</div>
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Utility Due</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            {fmtMoney(balance.utilityDue)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Utility Paid</div>
          <div className="stat-value sage" style={{ fontSize: 20 }}>
            {fmtMoney(balance.utilityPaid)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Utility Balance</div>
          <div className={`stat-value ${balance.utilityBalance < 0 ? 'clay' : 'sage'}`} style={{ fontSize: 20 }}>
            {balance.utilityBalance < 0 ? `-${fmtMoney(-balance.utilityBalance)}` : fmtMoney(balance.utilityBalance)}
          </div>
        </div>
      </div>

      <div className="fieldset-title">Monthly rent breakdown</div>
      {balance.cycles.length === 0 ? (
        <div className="hint" style={{ marginBottom: 16 }}>
          No billing cycles yet — this starts once a move-in date is set.
        </div>
      ) : (
        <div className="table-wrap" style={{ marginBottom: 20 }}>
          <table>
            <thead>
              <tr>
                <th>Cycle starting</th>
                <th>Rate</th>
                <th>Applied</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {balance.cycles.map((cycle) => (
                <tr key={cycle.index}>
                  <td className="mono">{fmtDate(cycle.anchorDate)}</td>
                  <td>{fmtMoney(cycle.rate)}</td>
                  <td>{fmtMoney(cycle.appliedAmount)}</td>
                  <td>
                    <span
                      className={`badge ${
                        cycle.status === 'paid' ? 'badge-paid' : cycle.status === 'partial' ? 'badge-partial' : 'badge-overdue'
                      }`}
                    >
                      {cycle.status === 'paid' ? 'Paid' : cycle.status === 'partial' ? 'Partial' : 'Unpaid'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="fieldset-title">Payment transactions</div>
      {sorted.length === 0 ? (
        <div className="hint">No payments logged yet.</div>
      ) : (
        <div className="room-list">
          {sorted.map((p) => (
            <div className="room-row" key={p.id} style={{ cursor: 'default' }}>
              <div>
                <span className="room-id">{fmtMoney(p.amount)}</span>
                <span className="room-type">{fmtDate(p.date_paid)}</span>
                <span className={`badge ${p.payment_type === 'utility' ? 'badge-partial' : 'badge-active'}`} style={{ marginLeft: 8 }}>
                  {p.payment_type === 'utility' ? 'Utility' : 'Rent'}
                </span>
                {p.notes && <div className="sub-cell">{p.notes}</div>}
              </div>
              <div className="row-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => onReceipt(p)}>
                  Receipt
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => onEdit(p)}>
                  Edit
                </button>
                {isAdmin && (
                  <button className="btn btn-danger btn-sm" onClick={() => onDelete(p)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

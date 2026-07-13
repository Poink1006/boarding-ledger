import { fmtMoney, fmtDate, todayStr } from '../lib/format'
import type { computeTenantBalance } from '../lib/balance'
import type { Database } from '../lib/database.types'

type Tenant = Database['public']['Tables']['tenants']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type Payment = Database['public']['Tables']['payments']['Row']
type AppSettings = Database['public']['Tables']['app_settings']['Row']
type Balance = ReturnType<typeof computeTenantBalance>

export function formatReceiptNo(n: number | null) {
  return n == null ? '—' : `OR-${String(n).padStart(4, '0')}`
}

function DocHeader({ settings, right }: { settings: AppSettings | null; right: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div>
        <h1>{settings?.business_name || 'Victoria Residence'}</h1>
        {settings?.business_address && <div className="doc-muted" style={{ fontSize: 12 }}>{settings.business_address}</div>}
        {settings?.business_contact && <div className="doc-muted" style={{ fontSize: 12 }}>{settings.business_contact}</div>}
      </div>
      <div style={{ textAlign: 'right' }}>{right}</div>
    </div>
  )
}

function balanceLabel(v: number) {
  if (v < 0) return `Owes ${fmtMoney(-v)}`
  if (v > 0) return `Credit ${fmtMoney(v)}`
  return 'Paid up'
}

export function ReceiptDoc({
  settings,
  tenant,
  room,
  payment,
  balance,
  staffName,
}: {
  settings: AppSettings | null
  tenant: Tenant
  room: Room | undefined
  payment: Payment
  balance: Balance
  staffName: string
}) {
  const isUtility = payment.payment_type === 'utility'
  const typeBalance = isUtility ? balance.utilityBalance : balance.rentBalance
  return (
    <>
      <DocHeader
        settings={settings}
        right={
          <>
            <div className="doc-title">Official Receipt</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, marginTop: 2 }}>
              {formatReceiptNo(payment.receipt_no)}
            </div>
          </>
        }
      />
      <hr className="doc-hr" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 13 }}>
        <div>
          <div className="doc-muted">Received from</div>
          <div style={{ fontWeight: 600 }}>
            {tenant.first_name} {tenant.last_name}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="doc-muted">Date</div>
          <div>{fmtDate(payment.date_paid)}</div>
        </div>
        <div>
          <div className="doc-muted">Tenant no.</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{tenant.tenant_number}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="doc-muted">Room</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{room?.label ?? '—'}</div>
        </div>
      </div>

      <div
        style={{
          border: '1px solid #e2e2e2',
          borderRadius: 8,
          padding: '14px 16px',
          margin: '18px 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <span
            style={{
              display: 'inline-block',
              fontSize: 11,
              letterSpacing: '0.05em',
              background: isUtility ? '#eef6f2' : '#eef2f8',
              color: isUtility ? '#0f6e56' : '#185fa5',
              padding: '2px 8px',
              borderRadius: 6,
              marginBottom: 4,
            }}
          >
            {isUtility ? 'UTILITY PAYMENT' : 'RENT PAYMENT'}
          </span>
          <div className="doc-muted" style={{ fontSize: 12 }}>
            {payment.notes || (isUtility ? 'Utility payment' : 'Rent payment')}
          </div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 600 }}>{fmtMoney(payment.amount)}</div>
      </div>

      <hr className="doc-hr" />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <div>
          <div className="doc-muted">{isUtility ? 'Utility' : 'Rent'} balance (as of {fmtDate(todayStr())})</div>
          <div style={{ fontWeight: 600 }}>{balanceLabel(typeBalance)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="doc-muted">Received by</div>
          <div>{staffName || '—'}</div>
        </div>
      </div>
    </>
  )
}

export function StatementDoc({
  settings,
  tenant,
  room,
  balance,
  payments,
}: {
  settings: AppSettings | null
  tenant: Tenant
  room: Room | undefined
  balance: Balance
  payments: Payment[]
}) {
  const totalDue = -(balance.rentBalance < 0 ? balance.rentBalance : 0) - (balance.utilityBalance < 0 ? balance.utilityBalance : 0)
  const tenantPayments = [...payments].sort((a, b) => (a.date_paid < b.date_paid ? 1 : -1))
  return (
    <>
      <DocHeader
        settings={settings}
        right={
          <>
            <div className="doc-title">Statement of Account</div>
            <div className="doc-muted" style={{ fontSize: 12, marginTop: 2 }}>as of {fmtDate(todayStr())}</div>
          </>
        }
      />
      <div className="doc-muted" style={{ fontSize: 12, marginTop: 4 }}>
        {tenant.first_name} {tenant.last_name} · {tenant.tenant_number} · {room?.label ?? '—'}
      </div>
      <hr className="doc-hr" />

      <div style={{ fontSize: 11, letterSpacing: '0.05em', color: '#666', marginBottom: 4 }}>RENT</div>
      {balance.cycles.length === 0 ? (
        <div className="doc-muted" style={{ fontSize: 13, marginBottom: 10 }}>No rent billing cycles yet.</div>
      ) : (
        <table className="doc-table" style={{ marginBottom: 8 }}>
          <thead>
            <tr>
              <th>Month starting</th>
              <th style={{ textAlign: 'right' }}>Charge</th>
              <th style={{ textAlign: 'right' }}>Paid</th>
              <th style={{ textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {balance.cycles.map((c) => (
              <tr key={c.index}>
                <td>{fmtDate(c.anchorDate)}</td>
                <td style={{ textAlign: 'right' }}>{fmtMoney(c.rate)}</td>
                <td style={{ textAlign: 'right' }}>{fmtMoney(c.appliedAmount)}</td>
                <td style={{ textAlign: 'right' }}>
                  {c.status === 'paid' ? 'Paid' : c.status === 'partial' ? 'Partial' : 'Unpaid'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 13 }}>
        <span className="doc-muted">Rent charged {fmtMoney(balance.rentDue)}</span>
        <span className="doc-muted">Paid {fmtMoney(balance.rentPaid)}</span>
        <span style={{ fontWeight: 600 }}>{balanceLabel(balance.rentBalance)}</span>
      </div>

      <div style={{ fontSize: 11, letterSpacing: '0.05em', color: '#666', margin: '16px 0 4px' }}>UTILITIES</div>
      {balance.utilityDue === 0 && balance.utilityPaid === 0 ? (
        <div className="doc-muted" style={{ fontSize: 13 }}>No utility charges.</div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 13 }}>
          <span className="doc-muted">Charged {fmtMoney(balance.utilityDue)}</span>
          <span className="doc-muted">Paid {fmtMoney(balance.utilityPaid)}</span>
          <span style={{ fontWeight: 600 }}>{balanceLabel(balance.utilityBalance)}</span>
        </div>
      )}

      {tenantPayments.length > 0 && (
        <>
          <div style={{ fontSize: 11, letterSpacing: '0.05em', color: '#666', margin: '16px 0 4px' }}>
            PAYMENTS RECEIVED
          </div>
          <table className="doc-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Date</th>
                <th>For</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {tenantPayments.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{formatReceiptNo(p.receipt_no)}</td>
                  <td>{fmtDate(p.date_paid)}</td>
                  <td>{p.payment_type === 'utility' ? 'Utility' : 'Rent'}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMoney(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <hr className="doc-hr" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 600 }}>Total amount due</span>
        <span style={{ fontSize: 20, fontWeight: 600, color: totalDue > 0 ? '#a32d2d' : '#0f6e56' }}>
          {totalDue > 0 ? fmtMoney(totalDue) : 'Paid up'}
        </span>
      </div>
    </>
  )
}

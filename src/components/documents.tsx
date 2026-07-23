import { fmtMoney, fmtDate, fmtMonth, todayStr } from '../lib/format'
import type { computeTenantBalance } from '../lib/balance'
import type { Database, PaymentType } from '../lib/database.types'

type Tenant = Database['public']['Tables']['tenants']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type Payment = Database['public']['Tables']['payments']['Row']
type AppSettings = Database['public']['Tables']['app_settings']['Row']
type Balance = ReturnType<typeof computeTenantBalance>

export function formatReceiptNo(n: number | null) {
  return n == null ? '—' : `OR-${String(n).padStart(4, '0')}`
}

// currency for printed documents: always two decimals, business-statement style
function docMoney(n: number) {
  return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
  type,
}: {
  settings: AppSettings | null
  tenant: Tenant
  room: Room | undefined
  balance: Balance
  payments: Payment[]
  type: PaymentType
}) {
  const isUtility = type === 'utility'
  const charged = isUtility ? balance.utilityDue : balance.rentDue
  const paid = isUtility ? balance.utilityPaid : balance.rentPaid
  const amountDue = Math.max(0, charged - paid)
  const credit = Math.max(0, paid - charged)

  // one chronological ledger of charges and payments with a running balance —
  // the standard shape of a business statement of account
  type LedgerRow = { date: string; desc: string; charge: number; payment: number; ref: string }
  const raw: LedgerRow[] = []
  if (isUtility) {
    balance.utilityCharges.forEach((c) =>
      raw.push({
        date: c.month,
        desc: `${c.type === 'electricity' ? 'Electricity' : 'Water'} — ${fmtMonth(c.month)}`,
        charge: c.amount,
        payment: 0,
        ref: '',
      }),
    )
  } else {
    balance.cycles.forEach((c) =>
      raw.push({ date: c.anchorDate, desc: `Rent — ${fmtMonth(c.anchorDate)}`, charge: c.rate, payment: 0, ref: '' }),
    )
  }
  payments
    .filter((p) => p.payment_type === type)
    .forEach((p) =>
      raw.push({
        date: p.date_paid,
        desc: p.notes ? `Payment received — ${p.notes}` : 'Payment received',
        charge: 0,
        payment: Number(p.amount || 0),
        ref: formatReceiptNo(p.receipt_no),
      }),
    )
  // oldest first; on the same date, a charge is listed before its payment
  raw.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    return (a.payment > 0 ? 1 : 0) - (b.payment > 0 ? 1 : 0)
  })
  let running = 0
  const rows = raw.map((r) => {
    running += r.charge - r.payment
    return { ...r, balance: running }
  })

  const stmtNo = `SOA-${tenant.tenant_number}-${todayStr().replace(/-/g, '').slice(2)}`
  const ink = '#1a1a1a'
  const muted = '#666'

  return (
    <>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{settings?.business_name || 'Victoria Residence'}</h1>
          {settings?.business_address && <div className="doc-muted" style={{ fontSize: 12 }}>{settings.business_address}</div>}
          {settings?.business_contact && <div className="doc-muted" style={{ fontSize: 12 }}>{settings.business_contact}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, color: ink, lineHeight: 1 }}>
            STATEMENT
          </div>
          <div className="doc-muted" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            of account · {isUtility ? 'Utilities' : 'Rent'}
          </div>
          <div style={{ fontSize: 12, marginTop: 10, color: muted }}>
            <div>
              Statement no. <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: ink }}>{stmtNo}</span>
            </div>
            <div>Date: {fmtDate(todayStr())}</div>
          </div>
        </div>
      </div>
      <hr className="doc-hr" />

      {/* bill to + account summary */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ fontSize: 13 }}>
          <div className="doc-title" style={{ marginBottom: 4 }}>Bill to</div>
          <div style={{ fontWeight: 600, color: ink }}>
            {tenant.first_name} {tenant.last_name}
          </div>
          <div style={{ color: muted }}>
            Tenant <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{tenant.tenant_number}</span> · Room{' '}
            {room?.label ?? '—'}
          </div>
          {tenant.contact_number && <div style={{ color: muted }}>{tenant.contact_number}</div>}
        </div>
        <table style={{ fontSize: 13, minWidth: 240, borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ color: muted, padding: '3px 0' }}>Total charges</td>
              <td style={{ textAlign: 'right', padding: '3px 0' }}>{docMoney(charged)}</td>
            </tr>
            <tr>
              <td style={{ color: muted, padding: '3px 0' }}>Total payments</td>
              <td style={{ textAlign: 'right', padding: '3px 0' }}>− {docMoney(paid)}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, color: ink, padding: '6px 0 0', borderTop: '1px solid #e2e2e2' }}>
                Balance due
              </td>
              <td style={{ fontWeight: 600, color: ink, textAlign: 'right', padding: '6px 0 0', borderTop: '1px solid #e2e2e2' }}>
                {docMoney(amountDue)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ledger */}
      <div className="doc-title" style={{ margin: '18px 0 6px' }}>Account activity</div>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th style={{ textAlign: 'right' }}>Charges</th>
            <th style={{ textAlign: 'right' }}>Payments</th>
            <th style={{ textAlign: 'right' }}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="doc-muted" style={{ padding: '10px 0' }}>
                No activity on this account yet.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                <td>
                  {r.desc}
                  {r.ref && r.ref !== '—' && (
                    <span className="doc-muted" style={{ fontFamily: "'IBM Plex Mono', monospace", marginLeft: 6, fontSize: 11 }}>
                      {r.ref}
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>{r.charge ? docMoney(r.charge) : ''}</td>
                <td style={{ textAlign: 'right' }}>{r.payment ? docMoney(r.payment) : ''}</td>
                <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>{docMoney(r.balance)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* amount due callout */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <div
          style={{
            minWidth: 260,
            background: '#f7f4ec',
            border: '1px solid #e6dcc4',
            borderRadius: 8,
            padding: '12px 16px',
            textAlign: 'right',
          }}
        >
          <div className="doc-title" style={{ marginBottom: 2 }}>Amount due</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: amountDue > 0 ? '#a32d2d' : '#0f6e56' }}>
            {amountDue > 0 ? docMoney(amountDue) : 'PAID IN FULL'}
          </div>
          {credit > 0 && <div className="doc-muted" style={{ fontSize: 12 }}>Credit on account: {docMoney(credit)}</div>}
        </div>
      </div>

      {/* payment instructions */}
      {settings?.payment_instructions?.trim() && (
        <>
          <hr className="doc-hr" />
          <div className="doc-title" style={{ marginBottom: 4 }}>How to pay</div>
          <div style={{ fontSize: 12, color: ink, whiteSpace: 'pre-line' }}>{settings.payment_instructions.trim()}</div>
        </>
      )}

      <div className="doc-muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 20 }}>
        Generated {fmtDate(todayStr())} · Thank you for staying with {settings?.business_name || 'Victoria Residence'}.
      </div>
    </>
  )
}

export interface MonthlyApartmentRow {
  name: string
  rent: number
  utilityIn: number
  utilityCost: number
}

// A printable per-apartment income/expense summary for one month, so the owner
// can see which building made money and what the overhead was. Income is cash
// collected that month; per-apartment "net" is before shared overhead, which is
// listed separately below.
export function MonthlySummaryDoc({
  settings,
  monthLabel,
  rows,
  overhead,
}: {
  settings: AppSettings | null
  monthLabel: string
  rows: MonthlyApartmentRow[]
  overhead: { label: string; amount: number }[]
}) {
  const totIncome = rows.reduce((s, r) => s + r.rent + r.utilityIn, 0)
  const totUtilityCost = rows.reduce((s, r) => s + r.utilityCost, 0)
  const totOverhead = overhead.reduce((s, o) => s + o.amount, 0)
  const totExpenses = totUtilityCost + totOverhead
  const net = totIncome - totExpenses

  return (
    <>
      <DocHeader
        settings={settings}
        right={
          <>
            <div className="doc-title">Monthly Summary</div>
            <div className="doc-muted" style={{ fontSize: 12, marginTop: 2 }}>{monthLabel}</div>
          </>
        }
      />
      <hr className="doc-hr" />

      <div style={{ fontSize: 11, letterSpacing: '0.05em', color: '#666', margin: '4px 0 6px' }}>INCOME BY APARTMENT</div>
      <table className="doc-table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>Apartment</th>
            <th style={{ textAlign: 'right' }}>Rent</th>
            <th style={{ textAlign: 'right' }}>Utility collected</th>
            <th style={{ textAlign: 'right' }}>Utility bill</th>
            <th style={{ textAlign: 'right' }}>Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.name}</td>
              <td style={{ textAlign: 'right' }}>{fmtMoney(r.rent)}</td>
              <td style={{ textAlign: 'right' }}>{fmtMoney(r.utilityIn)}</td>
              <td style={{ textAlign: 'right' }}>{fmtMoney(r.utilityCost)}</td>
              <td style={{ textAlign: 'right' }}>{fmtMoney(r.rent + r.utilityIn - r.utilityCost)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ fontWeight: 600 }}>Total</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(rows.reduce((s, r) => s + r.rent, 0))}</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(rows.reduce((s, r) => s + r.utilityIn, 0))}</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(totUtilityCost)}</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(totIncome - totUtilityCost)}</td>
          </tr>
        </tfoot>
      </table>

      <div style={{ fontSize: 11, letterSpacing: '0.05em', color: '#666', margin: '4px 0 6px' }}>SHARED OVERHEAD</div>
      <table className="doc-table" style={{ marginBottom: 16 }}>
        <tbody>
          {overhead.map((o, i) => (
            <tr key={i}>
              <td>{o.label}</td>
              <td style={{ textAlign: 'right' }}>{fmtMoney(o.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ fontWeight: 600 }}>Total overhead</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(totOverhead)}</td>
          </tr>
        </tfoot>
      </table>

      <hr className="doc-hr" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 13, marginBottom: 4 }}>
        <span className="doc-muted">Total income {fmtMoney(totIncome)}</span>
        <span className="doc-muted">Total expenses {fmtMoney(totExpenses)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 600 }}>Net income</span>
        <span style={{ fontSize: 20, fontWeight: 600, color: net < 0 ? '#a32d2d' : '#0f6e56' }}>
          {net < 0 ? `-${fmtMoney(-net)}` : fmtMoney(net)}
        </span>
      </div>
    </>
  )
}

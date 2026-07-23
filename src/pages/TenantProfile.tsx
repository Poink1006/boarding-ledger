import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { PrintModal } from '../components/PrintModal'
import { ReceiptDoc, StatementDoc } from '../components/documents'
import { PaymentModal } from './payments/PaymentModal'
import { computeTenantBalance } from '../lib/balance'
import { fmtMoney, fmtDate } from '../lib/format'
import { TENANT_STATUS_LABEL, TENANT_STATUS_BADGE } from '../lib/tenantStatus'
import { DEPOSIT_STATUS_LABEL, DEPOSIT_STATUS_BADGE } from '../lib/depositStatus'
import { SkeletonBlock } from '../components/Skeleton'
import type { Database, PaymentType } from '../lib/database.types'

type Tenant = Database['public']['Tables']['tenants']['Row']
type Room = Database['public']['Tables']['rooms']['Row']
type Payment = Database['public']['Tables']['payments']['Row']
type UtilityBill = Database['public']['Tables']['utility_bills']['Row']
type AppSettings = Database['public']['Tables']['app_settings']['Row']
type RateChange = Database['public']['Tables']['tenant_rate_changes']['Row']

function balanceBadge(v: number) {
  if (v < 0) return <span className="badge badge-overdue">Owes {fmtMoney(-v)}</span>
  if (v > 0) return <span className="badge badge-paid">Credit {fmtMoney(v)}</span>
  return <span className="badge badge-pending">Settled</span>
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '5px 0' }}>
      <span className="sub-cell">{label}</span>
      <span style={{ textAlign: 'right' }}>{value || '—'}</span>
    </div>
  )
}

export function TenantProfile() {
  const { id } = useParams()
  const { profile } = useAuth()
  const { showToast } = useToast()

  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [utilityBills, setUtilityBills] = useState<UtilityBill[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [rateHistory, setRateHistory] = useState<RateChange[]>([])
  const [loading, setLoading] = useState(true)

  const [payModalOpen, setPayModalOpen] = useState(false)
  const [receiptFor, setReceiptFor] = useState<Payment | null>(null)
  const [statementType, setStatementType] = useState<PaymentType | null>(null)

  const load = useCallback(async () => {
    const [tenantsRes, roomsRes, paymentsRes, utilityBillsRes, settingsRes, rateHistoryRes] = await Promise.all([
      supabase.from('tenants').select('*').is('deleted_at', null),
      supabase.from('rooms').select('*'),
      supabase.from('payments').select('*').is('deleted_at', null),
      supabase.from('utility_bills').select('*'),
      supabase.from('app_settings').select('*').single(),
      supabase.from('tenant_rate_changes').select('*'),
    ])
    if (tenantsRes.error) showToast(tenantsRes.error.message)
    const all = tenantsRes.data ?? []
    setTenants(all)
    setTenant(all.find((t) => t.id === id) ?? null)
    setRooms(roomsRes.data ?? [])
    setPayments(paymentsRes.data ?? [])
    setUtilityBills(utilityBillsRes.data ?? [])
    setSettings(settingsRes.data ?? null)
    setRateHistory(rateHistoryRes.data ?? [])
    setLoading(false)
  }, [id, showToast])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <>
        <div className="page-head">
          <div>
            <Link to="/tenants" className="hint">
              ← Back to tenants
            </Link>
            <h2>Tenant profile</h2>
          </div>
        </div>
        <SkeletonBlock height={200} />
      </>
    )
  }

  if (!tenant) {
    return (
      <div className="empty-state">
        <h3>Tenant not found</h3>
        <p>
          They may have been archived. <Link to="/tenants">Back to tenants</Link>
        </p>
      </div>
    )
  }

  const room = rooms.find((r) => r.id === tenant.room_id)
  const balance = computeTenantBalance(tenant, payments, rateHistory, { rooms, tenants, utilityBills, settings })
  const tenantPayments = payments.filter((p) => p.tenant_id === tenant.id).sort((a, b) => (a.date_paid < b.date_paid ? 1 : -1))

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/tenants" className="hint">
            ← Back to tenants
          </Link>
          <h2 style={{ marginTop: 4 }}>
            {tenant.first_name} {tenant.last_name}
          </h2>
          <div className="page-sub">
            <span className="mono">{tenant.tenant_number}</span> · {room ? room.label : 'No room'} ·{' '}
            <span className={`badge ${TENANT_STATUS_BADGE[tenant.status]}`}>{TENANT_STATUS_LABEL[tenant.status]}</span>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setPayModalOpen(true)}>
          + Log payment
        </button>
      </div>

      {/* balance summary */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-label">Rent</div>
          <div style={{ marginTop: 6 }}>{balanceBadge(balance.rentBalance)}</div>
          <div className="stat-note">{balance.cyclesBilled} month(s) billed</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Utilities</div>
          <div style={{ marginTop: 6 }}>{balanceBadge(balance.utilityBalance)}</div>
          <div className="stat-note">{fmtMoney(balance.utilityPaid)} paid</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Security deposit</div>
          <div style={{ marginTop: 6 }}>
            {tenant.deposit_amount > 0 ? (
              <span className={`badge ${DEPOSIT_STATUS_BADGE[tenant.deposit_status]}`}>
                {DEPOSIT_STATUS_LABEL[tenant.deposit_status]}
              </span>
            ) : (
              <span className="sub-cell">None</span>
            )}
          </div>
          <div className="stat-note">{tenant.deposit_amount > 0 ? fmtMoney(tenant.deposit_amount) : '—'}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setStatementType('rent')}>
          Rent statement
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setStatementType('utility')}>
          Utility statement
        </button>
      </div>

      {/* details */}
      <div className="section-title">Details</div>
      <div className="table-wrap" style={{ padding: '14px 20px', marginBottom: 24, maxWidth: 560 }}>
        <InfoRow label="Contact number" value={tenant.contact_number} />
        <InfoRow label="Email" value={tenant.email} />
        <InfoRow label="Address" value={tenant.address} />
        <InfoRow label="Emergency contact" value={tenant.emergency_name} />
        <InfoRow label="Emergency phone" value={tenant.emergency_phone} />
        <InfoRow label="School" value={tenant.school} />
        <InfoRow label="Course · year" value={[tenant.course, tenant.year_level].filter(Boolean).join(' · ')} />
        <InfoRow label="Move-in date" value={fmtDate(tenant.move_in_date)} />
        {tenant.move_out_date && <InfoRow label="Move-out date" value={fmtDate(tenant.move_out_date)} />}
      </div>

      {/* rent cycles */}
      <div className="section-title">Monthly rent breakdown</div>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        {balance.cycles.length === 0 ? (
          <div className="hint" style={{ padding: '14px 20px' }}>No billing cycles yet.</div>
        ) : (
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
              {balance.cycles.map((c) => (
                <tr key={c.index}>
                  <td className="mono">{fmtDate(c.anchorDate)}</td>
                  <td>{fmtMoney(c.rate)}</td>
                  <td>{fmtMoney(c.appliedAmount)}</td>
                  <td>
                    <span className={`badge ${c.status === 'paid' ? 'badge-paid' : c.status === 'partial' ? 'badge-partial' : 'badge-overdue'}`}>
                      {c.status === 'paid' ? 'Paid' : c.status === 'partial' ? 'Partial' : 'Unpaid'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* payment transactions */}
      <div className="section-title">Payment history</div>
      <div className="table-wrap">
        {tenantPayments.length === 0 ? (
          <div className="hint" style={{ padding: '14px 20px' }}>No payments logged yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tenantPayments.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{fmtDate(p.date_paid)}</td>
                  <td>
                    <span className={`badge ${p.payment_type === 'utility' ? 'badge-partial' : 'badge-active'}`}>
                      {p.payment_type === 'utility' ? 'Utility' : 'Rent'}
                    </span>
                  </td>
                  <td>{fmtMoney(p.amount)}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => setReceiptFor(p)}>
                      Receipt
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {payModalOpen && (
        <PaymentModal
          tenantId={tenant.id}
          initial={null}
          defaultType="rent"
          tenants={tenants}
          rooms={rooms}
          onClose={() => setPayModalOpen(false)}
          onSaved={() => {
            setPayModalOpen(false)
            load()
          }}
        />
      )}

      {receiptFor && (
        <PrintModal onClose={() => setReceiptFor(null)} pdfName={`receipt-${tenant.tenant_number}.pdf`}>
          <ReceiptDoc
            settings={settings}
            tenant={tenant}
            room={room}
            payment={receiptFor}
            balance={balance}
            staffName={profile?.full_name ?? ''}
          />
        </PrintModal>
      )}

      {statementType && (
        <PrintModal onClose={() => setStatementType(null)} pdfName={`${statementType}-statement-${tenant.tenant_number}.pdf`}>
          <StatementDoc
            settings={settings}
            tenant={tenant}
            room={room}
            balance={balance}
            payments={tenantPayments}
            type={statementType}
          />
        </PrintModal>
      )}
    </>
  )
}

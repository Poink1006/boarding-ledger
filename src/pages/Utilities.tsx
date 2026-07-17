import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { updateGuarded } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { naturalSort } from '../lib/rooms'
import { fmtMoney, fmtRate, dateToMonthInput, monthInputToDate, todayStr } from '../lib/format'
import { SkeletonStatGrid, SkeletonTable } from '../components/Skeleton'
import { getCached, setCached, hasCached } from '../lib/cache'
import type { Database, UtilityType } from '../lib/database.types'

type Apartment = Database['public']['Tables']['apartments']['Row']
type UtilityBill = Database['public']['Tables']['utility_bills']['Row']

const UTILITY_LABEL: Record<UtilityType, string> = {
  electricity: 'Electricity',
  water: 'Water',
}
const UTILITY_UNIT: Record<UtilityType, string> = {
  electricity: 'kWh',
  water: 'm³',
}

function billRate(bill: UtilityBill) {
  return bill.usage > 0 ? bill.total_cost / bill.usage : 0
}

const CACHE_KEY = 'utilities'
interface UtilitiesData {
  apartments: Apartment[]
  bills: UtilityBill[]
}

export function Utilities() {
  const { isAdmin } = useAuth()
  const { showToast } = useToast()

  const cached = getCached<UtilitiesData>(CACHE_KEY)
  const [apartments, setApartments] = useState<Apartment[]>(cached?.apartments ?? [])
  const [bills, setBills] = useState<UtilityBill[]>(cached?.bills ?? [])
  const [loading, setLoading] = useState(!cached)
  const [month, setMonth] = useState(dateToMonthInput(todayStr()))
  const [activeTab, setActiveTab] = useState<UtilityType>('electricity')

  const loadAll = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      const [apartmentsRes, billsRes] = await Promise.all([
        supabase.from('apartments').select('*'),
        supabase.from('utility_bills').select('*'),
      ])
      if (apartmentsRes.error) showToast(apartmentsRes.error.message)
      if (billsRes.error) showToast(billsRes.error.message)

      const data: UtilitiesData = {
        apartments: [...(apartmentsRes.data ?? [])].sort((a, b) => naturalSort.compare(a.name, b.name)),
        bills: billsRes.data ?? [],
      }
      setCached(CACHE_KEY, data)
      setApartments(data.apartments)
      setBills(data.bills)
      setLoading(false)
    },
    [showToast],
  )

  useEffect(() => {
    loadAll(hasCached(CACHE_KEY))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAll])

  if (loading) {
    return (
      <>
        <div className="page-head">
          <div>
            <h2>Utilities</h2>
          </div>
        </div>
        <SkeletonStatGrid count={3} />
        <SkeletonTable rows={6} cols={5} />
      </>
    )
  }

  const billsForMonth = bills.filter((b) => dateToMonthInput(b.billing_month) === month)

  function totalsFor(type: UtilityType) {
    const list = billsForMonth.filter((b) => b.utility_type === type)
    return {
      usage: list.reduce((s, b) => s + Number(b.usage || 0), 0),
      cost: list.reduce((s, b) => s + Number(b.total_cost || 0), 0),
      count: list.length,
    }
  }
  const elecTotals = totalsFor('electricity')
  const waterTotals = totalsFor('water')

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Utilities</h2>
          <div className="page-sub">Water and electricity billing per apartment</div>
        </div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>

      <div className="stat-grid" style={{ marginBottom: 28 }}>
        <div className="stat-card">
          <div className="stat-label">Electricity</div>
          <div className="stat-value brass">{fmtMoney(elecTotals.cost)}</div>
          <div className="stat-note">
            {elecTotals.usage.toLocaleString('en-PH')} kWh · {elecTotals.count} apartment{elecTotals.count === 1 ? '' : 's'}{' '}
            logged
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Water</div>
          <div className="stat-value sage">{fmtMoney(waterTotals.cost)}</div>
          <div className="stat-note">
            {waterTotals.usage.toLocaleString('en-PH')} m³ · {waterTotals.count} apartment{waterTotals.count === 1 ? '' : 's'}{' '}
            logged
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Combined Total</div>
          <div className="stat-value">{fmtMoney(elecTotals.cost + waterTotals.cost)}</div>
          <div className="stat-note">water + electricity this month</div>
        </div>
      </div>

      <div className="tab-bar-segmented">
        <button
          type="button"
          className={`tab-item${activeTab === 'electricity' ? ' active' : ''}`}
          onClick={() => setActiveTab('electricity')}
        >
          Electricity
        </button>
        <button
          type="button"
          className={`tab-item${activeTab === 'water' ? ' active' : ''}`}
          onClick={() => setActiveTab('water')}
        >
          Water
        </button>
      </div>

      {apartments.length === 0 ? (
        <div className="empty-state">
          <h3>No apartments yet</h3>
          <p>Set up apartments on the Units &amp; Rooms page first.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Apartment</th>
                <th>Usage</th>
                <th>Cost</th>
                <th>Rate</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {apartments.map((apartment) => {
                const bill =
                  billsForMonth.find((b) => b.apartment_id === apartment.id && b.utility_type === activeTab) ?? null
                return (
                  <UtilityRow
                    key={apartment.id}
                    apartmentId={apartment.id}
                    apartmentName={apartment.name}
                    utilityType={activeTab}
                    month={month}
                    bill={bill}
                    isAdmin={isAdmin}
                    onSaved={() => loadAll(true)}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function UtilityRow({
  apartmentId,
  apartmentName,
  utilityType,
  month,
  bill,
  isAdmin,
  onSaved,
}: {
  apartmentId: string
  apartmentName: string
  utilityType: UtilityType
  month: string
  bill: UtilityBill | null
  isAdmin: boolean
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [editing, setEditing] = useState(false)
  const [usage, setUsage] = useState(bill ? String(bill.usage) : '')
  const [cost, setCost] = useState(bill ? String(bill.total_cost) : '')
  const [saving, setSaving] = useState(false)

  // the bill for this apartment/utility changes whenever the selected month
  // changes (or after a save) — resync the inputs so July's numbers don't
  // linger when switching to a month with no bill logged yet
  useEffect(() => {
    setUsage(bill ? String(bill.usage) : '')
    setCost(bill ? String(bill.total_cost) : '')
    setEditing(false)
  }, [bill, month])

  const unit = UTILITY_UNIT[utilityType]
  const usageNum = Number(usage)
  const costNum = Number(cost)
  const liveRate = usageNum > 0 && !Number.isNaN(costNum) ? costNum / usageNum : null
  const isEditing = editing || !bill

  async function handleSave() {
    if (!usageNum || usageNum <= 0) {
      showToast(`Enter ${UTILITY_LABEL[utilityType].toLowerCase()} usage greater than 0.`)
      return
    }
    if (Number.isNaN(costNum) || costNum < 0) {
      showToast('Enter a valid total cost.')
      return
    }
    const payload = {
      apartment_id: apartmentId,
      utility_type: utilityType,
      billing_month: monthInputToDate(month),
      usage: usageNum,
      total_cost: costNum,
    }
    setSaving(true)
    // edits use an optimistic-locking guard so two staff can't silently
    // overwrite each other; a fresh insert has nothing to conflict with
    const errorMsg = bill
      ? (await updateGuarded('utility_bills', bill, payload)).error
      : (await supabase.from('utility_bills').insert(payload)).error?.message ?? null
    setSaving(false)
    if (errorMsg) {
      showToast(errorMsg)
      return
    }
    showToast(bill ? 'Bill updated.' : 'Bill logged.')
    setEditing(false)
    onSaved()
  }

  async function handleDelete() {
    if (!bill) return
    if (!window.confirm(`Delete this ${UTILITY_LABEL[utilityType].toLowerCase()} bill?`)) return
    const { error } = await supabase.from('utility_bills').delete().eq('id', bill.id)
    if (error) {
      showToast(error.message)
      return
    }
    showToast('Bill deleted.')
    onSaved()
  }

  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{apartmentName}</td>
      {isEditing ? (
        <>
          <td>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder={unit}
              value={usage}
              onChange={(e) => setUsage(e.target.value)}
              style={{ width: 90 }}
            />
          </td>
          <td>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="₱"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              style={{ width: 90 }}
            />
          </td>
          <td className="sub-cell">{liveRate != null ? `${fmtRate(liveRate)}/${unit}` : '—'}</td>
          <td>
            <div className="row-actions">
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? '…' : 'Save'}
              </button>
              {bill && (
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              )}
            </div>
          </td>
        </>
      ) : (
        <>
          <td className="mono">
            {bill!.usage.toLocaleString('en-PH')} {unit}
          </td>
          <td>{fmtMoney(bill!.total_cost)}</td>
          <td className="sub-cell">{fmtRate(billRate(bill!))}/{unit}</td>
          <td>
            <div className="row-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                Edit
              </button>
              {isAdmin && (
                <button className="btn btn-danger btn-sm" onClick={handleDelete}>
                  Delete
                </button>
              )}
            </div>
          </td>
        </>
      )}
    </tr>
  )
}

export function fmtMoney(n: number) {
  return '₱' + Number(n || 0).toLocaleString('en-PH')
}

export function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s + 'T00:00:00').toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// numeric m/d/yyyy form, e.g. 7/9/2026
export function fmtDateShort(s: string | null) {
  if (!s) return '—'
  return new Date(s + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

// Formats a Date using its LOCAL year/month/day — never toISOString(), which
// converts to UTC and silently shifts the date backward a day for any
// timezone ahead of UTC (e.g. Philippines, UTC+8).
function toDateStr(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addMonths(dateStr: string, months: number) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setMonth(d.getMonth() + months)
  return toDateStr(d)
}

export function todayStr() {
  return toDateStr(new Date())
}

// a first-of-month `date` column vs. <input type="month">'s "YYYY-MM" value
export function dateToMonthInput(dateStr: string) {
  return dateStr.slice(0, 7)
}

export function monthInputToDate(monthStr: string) {
  return `${monthStr}-01`
}

export function fmtRate(n: number) {
  return '₱' + (Number.isFinite(n) ? n.toFixed(2) : '0.00')
}

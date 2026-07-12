import type { CSSProperties } from 'react'

export function SkeletonBlock({
  width = '100%',
  height = 14,
  radius = 6,
  style,
}: {
  width?: string | number
  height?: string | number
  radius?: number
  style?: CSSProperties
}) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} />
}

export function SkeletonStatGrid({ count = 3 }: { count?: number }) {
  return (
    <div className="stat-grid" style={{ marginBottom: 28 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div className="stat-card" key={i}>
          <SkeletonBlock width="55%" height={11} style={{ marginBottom: 12 }} />
          <SkeletonBlock width="40%" height={26} style={{ marginBottom: 8 }} />
          <SkeletonBlock width="70%" height={11} />
        </div>
      ))}
    </div>
  )
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap">
      <table>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <SkeletonBlock width={c === 0 ? '80%' : '55%'} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SkeletonCardGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="units-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div className="unit-card" key={i}>
          <SkeletonBlock width="50%" height={16} style={{ marginBottom: 14 }} />
          <SkeletonBlock width="100%" height={34} style={{ marginBottom: 8 }} />
          <SkeletonBlock width="100%" height={34} />
        </div>
      ))}
    </div>
  )
}

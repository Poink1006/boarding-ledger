import type { ReactNode } from 'react'

// A print-friendly overlay: shows a white "sheet" the user can review, with a
// toolbar to print (or Save as PDF via the OS print dialog) or close. The
// `@media print` rules in global.css hide everything except `.doc-sheet`.
export function PrintModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="modal-overlay doc-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="doc-shell">
        <div className="doc-print-toolbar">
          <button className="btn btn-ghost btn-sm" onClick={onClose} type="button">
            Close
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => window.print()} type="button">
            🖨 Print / Save PDF
          </button>
        </div>
        <div className="doc-sheet">{children}</div>
      </div>
    </div>
  )
}

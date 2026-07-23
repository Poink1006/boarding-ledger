import type { ReactNode } from 'react'

type ElectronDocAPI = { savePDF?: (filename?: string) => Promise<{ saved: boolean }> }

// A print-friendly overlay: shows a white "sheet" the user can review, with a
// toolbar to print it, save it as a PDF, or close. The `@media print` rules in
// global.css hide everything except `.doc-sheet`.
export function PrintModal({
  onClose,
  children,
  pdfName = 'document.pdf',
}: {
  onClose: () => void
  children: ReactNode
  pdfName?: string
}) {
  // In the packaged app, Save PDF writes a real PDF via a native Save dialog.
  // In a plain browser (dev) there's no such bridge, so fall back to the OS
  // print dialog, which also offers "Save as PDF".
  async function handleSavePDF() {
    const api = (window as unknown as { electronAPI?: ElectronDocAPI }).electronAPI
    if (api?.savePDF) {
      await api.savePDF(pdfName)
    } else {
      window.print()
    }
  }

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
            🖨 Print
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSavePDF} type="button">
            ⭳ Save PDF
          </button>
        </div>
        <div className="doc-sheet">{children}</div>
      </div>
    </div>
  )
}

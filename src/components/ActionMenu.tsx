import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ActionMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  primary?: boolean
  hidden?: boolean
}

export function ActionMenu({ items }: { items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function place() {
      const btn = triggerRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      const menuWidth = 180
      const margin = 8
      const left = Math.min(Math.max(margin, rect.right - menuWidth), window.innerWidth - menuWidth - margin)
      setPos({ top: rect.bottom + 4, left })
    }
    place()

    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  const visibleItems = items.filter((item) => !item.hidden)

  return (
    <>
      <button
        ref={triggerRef}
        className="btn btn-ghost btn-sm action-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        Actions
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ display: 'block' }}>
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div className="action-menu-list" ref={menuRef} style={{ top: pos.top, left: pos.left }}>
            {visibleItems.map((item) => (
              <button
                key={item.label}
                type="button"
                className={`action-menu-item${item.danger ? ' danger' : ''}${item.primary ? ' primary' : ''}`}
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

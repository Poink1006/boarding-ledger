import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ToastContextValue {
  showToast: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const timeoutRef = useRef<number>()

  const showToast = useCallback((msg: string) => {
    setMessage(msg)
    window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => setMessage(null), 2200)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className={`toast${message ? ' show' : ''}`}>{message}</div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

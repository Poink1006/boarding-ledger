import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { clearAllCached } from '../lib/cache'
import type { UserRole } from '../lib/database.types'

interface Profile {
  id: string
  full_name: string
  role: UserRole
}

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  isAdmin: boolean
  isRealAdmin: boolean
  viewingAsUser: boolean
  toggleViewAsUser: () => void
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  // UI-only simulation so an admin can preview the regular-user experience.
  // Does not touch the real role or RLS — backend permissions are unchanged.
  const [viewingAsUser, setViewingAsUser] = useState(false)

  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', userId)
      .single()
    if (error) {
      setProfile(null)
      return
    }
    setProfile(data)
  }

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      setSession(data.session)
      if (data.session) await loadProfile(data.session.user.id)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)
      if (newSession) {
        await loadProfile(newSession.user.id)
      } else {
        setProfile(null)
        setViewingAsUser(false)
        // don't leave cached tenant/payment data on a shared machine
        clearAllCached()
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  // auto-logout after 30 minutes of inactivity — a shared front-desk computer
  // left unattended shouldn't stay signed in forever. Any mouse/keyboard/touch
  // activity resets the clock; a once-a-minute check signs out when it lapses.
  useEffect(() => {
    if (!session) return
    const INACTIVITY_LIMIT_MS = 30 * 60 * 1000
    let lastActivity = Date.now()
    const bump = () => {
      lastActivity = Date.now()
    }
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel']
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const interval = setInterval(() => {
      if (Date.now() - lastActivity >= INACTIVITY_LIMIT_MS) {
        supabase.auth.signOut()
      }
    }, 60 * 1000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      clearInterval(interval)
    }
  }, [session])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const isRealAdmin = profile?.role === 'admin'

  const value: AuthContextValue = {
    session,
    profile,
    loading,
    isAdmin: isRealAdmin && !viewingAsUser,
    isRealAdmin,
    viewingAsUser: isRealAdmin && viewingAsUser,
    toggleViewAsUser: () => setViewingAsUser((v) => !v),
    signIn,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

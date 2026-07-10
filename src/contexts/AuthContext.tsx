import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
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
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

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

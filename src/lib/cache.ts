// Two-layer client cache: an in-memory Map for instant reads within a session,
// backed by localStorage so the data ALSO survives a full reload or app restart
// — which is what lets the app still show the last-known tenants, payments, etc.
// when it starts up (or the network drops) OFFLINE. Pages hydrate from here
// while a background fetch refreshes; if that fetch fails offline, the saved
// data stays on screen instead of a blank page.
//
// Same tiny API the pages already use — persistence is transparent. Cleared on
// sign-out (clearAllCached) so cached data doesn't linger on a shared machine.
const PREFIX = 'vr_cache_'
const store = new Map<string, unknown>()

export function getCached<T>(key: string): T | undefined {
  if (store.has(key)) return store.get(key) as T
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw == null) return undefined
    const parsed = JSON.parse(raw) as T
    store.set(key, parsed)
    return parsed
  } catch {
    return undefined
  }
}

export function setCached<T>(key: string, data: T) {
  store.set(key, data)
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(data))
  } catch {
    // storage full or unavailable — the in-memory layer still works
  }
}

export function hasCached(key: string) {
  if (store.has(key)) return true
  try {
    return localStorage.getItem(PREFIX + key) != null
  } catch {
    return false
  }
}

export function clearAllCached() {
  store.clear()
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith(PREFIX)) localStorage.removeItem(k)
    }
  } catch {
    // ignore — nothing we can do if storage is unavailable
  }
}

// Module-level in-memory cache — survives navigation within the SPA session
// (lost on full reload). Lets a page hydrate instantly with the data it
// showed last time while a silent background fetch brings it up to date,
// instead of flashing a loading state on every visit.
const store = new Map<string, unknown>()

export function getCached<T>(key: string): T | undefined {
  return store.get(key) as T | undefined
}

export function setCached<T>(key: string, data: T) {
  store.set(key, data)
}

export function hasCached(key: string) {
  return store.has(key)
}

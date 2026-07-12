/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  electronAPI?: {
    platform: NodeJS.Platform
    onUpdateAvailable: (cb: (info: { version: string }) => void) => () => void
    onUpdateDownloaded: (cb: (info: { version: string }) => void) => () => void
    restartToUpdate: () => void
  }
}

import { contextBridge } from 'electron'

// Supabase auth + data calls run directly in the renderer (same as a normal
// web app), so this bridge only exposes small, non-sensitive host info.
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
})

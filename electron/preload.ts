import { contextBridge, ipcRenderer } from 'electron'

type UpdateInfo = { version: string }

// Supabase auth + data calls run directly in the renderer (same as a normal
// web app), so this bridge only exposes small, non-sensitive host info plus
// the auto-update hooks the in-app update banner needs.
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => {
    const handler = (_e: unknown, info: UpdateInfo) => cb(info)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
  onUpdateDownloaded: (cb: (info: UpdateInfo) => void) => {
    const handler = (_e: unknown, info: UpdateInfo) => cb(info)
    ipcRenderer.on('update:downloaded', handler)
    return () => ipcRenderer.removeListener('update:downloaded', handler)
  },
  restartToUpdate: () => ipcRenderer.send('update:restart'),
})

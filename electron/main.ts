import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    fullscreen: true,
    title: 'Victoria Residence',
    backgroundColor: '#F5F1E8',
    icon: path.join(process.env.VITE_PUBLIC!, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(process.env.DIST!, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

function setupAutoUpdater() {
  // let the renderer trigger the install-and-restart from its in-app banner
  ipcMain.on('update:restart', () => autoUpdater.quitAndInstall())

  // only real installed builds have anything to update against — running
  // via `npm run dev` / an unpacked build has no update feed
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true

  // notify the renderer as soon as a newer version is found, so it can show
  // "downloading…", then again once it's ready to install
  autoUpdater.on('update-available', (info) => {
    win?.webContents.send('update:available', { version: info.version })
  })

  autoUpdater.on('update-downloaded', (info) => {
    win?.webContents.send('update:downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err)
  })

  autoUpdater.checkForUpdates()
}

app.whenReady().then(() => {
  createWindow()
  setupAutoUpdater()
})

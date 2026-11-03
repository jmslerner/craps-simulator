const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow } = require('electron')

const distDir = path.join(__dirname, '..', 'dist')
const indexPath = path.join(distDir, 'index.html')

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#111827',
    autoHideMenuBar: true,
    title: 'Bubble Craps Trainer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  const startUrl = process.env.ELECTRON_START_URL
  const targetUrl = startUrl ?? pathToFileURL(indexPath).toString()

  mainWindow.loadURL(targetUrl)
}

app.whenReady().then(() => {
  if (!process.env.ELECTRON_START_URL && !fs.existsSync(indexPath)) {
    console.error('Missing built app assets. Run "npm run build" before launching the desktop app.')
    app.quit()
    return
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

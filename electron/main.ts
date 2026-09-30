import { app, BrowserWindow, ipcMain, shell, net } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import log from 'electron-log'
import { registerIpcHandlers } from './ipc'
import { initDatabase, closeDatabase } from './db'
import { initConfig } from './config'
import { initUpdater } from './updater'
import { BrowserManager } from './browser/browser-manager'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 日志文件路径配置
log.transports.file.level = 'info'
log.transports.console.level = 'debug'
log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'main.log')

let mainWindow: BrowserWindow | null = null

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1200,
    minHeight: 720,
    show: false,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#f5f7fa',
    icon: join(__dirname, '../public/icon.png'),
    title: '全自动商品上架工具',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(async () => {
  log.info('应用启动，初始化中...')

  // 初始化配置
  initConfig()
  // 初始化数据库
  initDatabase()

  // 注册 IPC 处理器
  registerIpcHandlers(ipcMain)

  // GitHub 代理：electron-updater 使用 Electron 的 net.request 发起请求，
  // 国内直连 GitHub 经常超时，通过 gh-proxy.com 中转解决
  if (app.isPackaged) {
    const GITHUB_PROXY = 'https://gh-proxy.com/'
    const originalNetRequest = net.request
    const isGitHubUrl = (url: string) =>
      url.includes('github.com') || url.includes('githubusercontent.com')

    // monkey-patch net.request 以拦截 GitHub 请求
    net.request = function (options: any) {
      const url = typeof options === 'string' ? options : options?.url
      if (typeof url === 'string' && isGitHubUrl(url)) {
        const proxiedUrl = GITHUB_PROXY + url
        const newOptions = typeof options === 'string'
          ? proxiedUrl
          : { ...options, url: proxiedUrl }
        log.info('[proxy] 中转 GitHub 请求:', url.substring(0, 80))
        return originalNetRequest.call(net, newOptions)
      }
      return originalNetRequest.call(net, options)
    }
    log.info('[proxy] 已配置 GitHub 代理 (gh-proxy.com)')
  }

  // 初始化自动更新
  initUpdater()

  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeDatabase()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  await BrowserManager.getInstance().destroy().catch(() => {})
})

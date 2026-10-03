import { app, BrowserWindow, ipcMain, shell, net } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import log from 'electron-log'
import { registerIpcHandlers } from './ipc'
import { initDatabase, closeDatabase } from './db'
import { initConfig } from './config'
import { applyLogDir } from './utils/log-transport'
import { initUpdater, isInstallingUpdate, installPendingUpdateOnQuit } from './updater'
import { BrowserManager } from './browser/browser-manager'
import { ScriptManager } from './script/script-manager'
import { hideHud } from './script/hud-overlay'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Windows 上系统通知要归属到本应用，需与安装包快捷方式的 AUMID（electron-builder 用 appId）一致
if (process.platform === 'win32') app.setAppUserModelId('com.autoshoping.automation')

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
    title: '影随 TraceFlow',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
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
  // 日志目录跟随设置项 storage.logDir
  applyLogDir()
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
  if (process.platform === 'darwin') return
  // 执行浮窗也是 BrowserWindow：脚本还在跑（尤其无限循环）时它会压住 window-all-closed，
  // 表现为关掉主窗口后应用静默驻留、进程不退出。先收掉浮窗，收尾统一交给 before-quit
  hideHud()
  app.quit()
})

app.on('before-quit', (e) => {
  // 正在安装更新时必须放行：否则 preventDefault 会拦截 autoUpdater.quitAndInstall()
  // 触发的退出，表现为「点重启并安装只是把应用关了，更新永远装不上」
  if (isInstallingUpdate()) return

  // before-quit 是同步事件，async 不会被 Electron 等待
  // 用 preventDefault 暂停退出，destroy 完成后立即 exit
  e.preventDefault()
  // 先停掉所有脚本（同步标记 + 终止当前 executor），避免退出过程中执行循环又重启浏览器
  try {
    ScriptManager.getInstance().stopAll()
  } catch {
    // 退出阶段不阻断
  }
  hideHud()
  BrowserManager.getInstance().destroy()
    .catch(() => {})
    .finally(() => {
      closeDatabase()
      // 有已下载完成的更新：交给 electron-updater 顺带装上（会再次触发 before-quit，
      // 此时 isInstallingUpdate() 为 true 直接放行），否则维持常规硬退出
      if (!installPendingUpdateOnQuit()) {
        app.exit(0)
      }
    })
})

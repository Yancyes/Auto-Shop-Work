/**
 * 执行浮窗（HUD）
 *
 * 脚本在 Playwright 启动的真实浏览器里执行，主窗口被遮挡时用户看不到进度，
 * 容易误判为卡死。这里用一个置顶、透明、鼠标穿透的小窗覆盖在执行浏览器上，
 * 实时显示当前步骤与耗时。
 */
import { BrowserWindow, screen } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSettings } from '../config'
import type { HudState } from '../../shared/types'

const __dirname = dirname(fileURLToPath(import.meta.url))

const WIDTH = 520
const HEIGHT = 88

let win: BrowserWindow | null = null
let pageReady = false
/** 页面加载完成前收到的最新状态，加载后补发一次；同时作为 updateHud 的合并基准 */
let currentState: HudState | null = null

/** 浮窗仅在「有界面浏览器 + 用户开启该功能」时出现 */
function isEnabled(): boolean {
  const settings = getSettings()
  return settings.script.hudEnabled && !settings.browser.headless
}

function bounds() {
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(WIDTH, workArea.width - 32)
  return {
    width,
    height: HEIGHT,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    // 底部居中：浏览器窗口底部是页面内容区，不会挡住地址栏和标签栏
    y: workArea.y + workArea.height - HEIGHT - 24
  }
}

function sendState(state: HudState) {
  currentState = state
  if (!win || win.isDestroyed()) return
  // 页面尚未加载完成：状态已记录在 currentState，did-finish-load 时补发
  if (!pageReady) return
  win.webContents
    .executeJavaScript(`window.__hudSetState(${JSON.stringify(state)})`)
    .catch(() => {
      // 浮窗已被关闭/销毁：忽略，不影响脚本执行
    })
}

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    ...bounds(),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    title: '执行状态',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  win = created
  pageReady = false

  // 'screen-saver' 层级才能稳定压住 Chromium 窗口
  created.setAlwaysOnTop(true, 'screen-saver')
  created.setIgnoreMouseEvents(true)
  created.once('closed', () => {
    if (win === created) {
      win = null
      pageReady = false
    }
  })

  created.webContents.on('did-finish-load', () => {
    pageReady = true
    if (currentState) sendState(currentState)
    if (!created.isDestroyed()) created.showInactive()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    created.loadURL(`${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/hud.html`)
  } else {
    created.loadFile(join(__dirname, '../dist/hud.html'))
  }

  return created
}

/** 显示浮窗（已存在则只更新内容） */
export function showHud(state: HudState) {
  if (!isEnabled()) return
  const target = win && !win.isDestroyed() ? win : createWindow()
  sendState(state)
  if (pageReady && !target.isVisible()) target.showInactive()
}

/** 更新浮窗内容（浮窗未显示时忽略） */
export function updateHud(patch: Partial<HudState>) {
  if (!win || win.isDestroyed() || !currentState) return
  sendState({ ...currentState, ...patch })
}

/** 关闭并销毁浮窗 */
export function hideHud() {
  if (win && !win.isDestroyed()) {
    win.destroy()
  }
  win = null
  pageReady = false
  currentState = null
}

/**
 * 执行浮窗（HUD）
 *
 * 脚本在 Playwright 启动的真实浏览器里执行，主窗口被遮挡时用户看不到进度，
 * 容易误判为卡死。这里用置顶、透明、鼠标穿透的小窗覆盖在执行浏览器上，
 * 实时显示当前步骤与耗时。并发执行时每个脚本一个浮窗，自下往上堆叠。
 */
import { BrowserWindow, screen } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSettings } from '../config'
import type { HudState } from '../../shared/types'

const __dirname = dirname(fileURLToPath(import.meta.url))

const WIDTH = 520
const HEIGHT = 88
const GAP = 12

interface HudEntry {
  win: BrowserWindow
  pageReady: boolean
  /** 页面加载完成前收到的最新状态，加载后补发一次；同时作为 updateHud 的合并基准 */
  state: HudState | null
}

const entries = new Map<number, HudEntry>()
/** 堆叠顺序：靠前的贴在屏幕底部，后面的依次往上排 */
const order: number[] = []

/** 浮窗仅在「有界面浏览器 + 用户开启该功能」时出现 */
function isEnabled(): boolean {
  const settings = getSettings()
  return settings.script.hudEnabled && !settings.browser.headless
}

function bounds(stackIndex: number) {
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(WIDTH, workArea.width - 32)
  return {
    width,
    height: HEIGHT,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    // 底部居中：浏览器窗口底部是页面内容区，不会挡住地址栏和标签栏
    y: workArea.y + workArea.height - (stackIndex + 1) * (HEIGHT + GAP) - 24
  }
}

/** 并发时按当前顺序重新排一遍，保证多张浮窗不会叠在同一个位置 */
function relayout() {
  order.forEach((scriptId, stackIndex) => {
    const entry = entries.get(scriptId)
    if (entry && !entry.win.isDestroyed()) entry.win.setBounds(bounds(stackIndex))
  })
}

function sendState(entry: HudEntry, state: HudState) {
  entry.state = state
  if (entry.win.isDestroyed() || !entry.pageReady) return
  entry.win.webContents
    .executeJavaScript(`window.__hudSetState(${JSON.stringify(state)})`)
    .catch(() => {
      // 浮窗已被关闭/销毁：忽略，不影响脚本执行
    })
}

function createWindow(scriptId: number): HudEntry {
  const created = new BrowserWindow({
    ...bounds(Math.max(order.indexOf(scriptId), 0)),
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

  const entry: HudEntry = { win: created, pageReady: false, state: entries.get(scriptId)?.state ?? null }
  entries.set(scriptId, entry)

  // 'screen-saver' 层级才能稳定压住 Chromium 窗口
  created.setAlwaysOnTop(true, 'screen-saver')
  created.setIgnoreMouseEvents(true)
  created.once('closed', () => {
    if (entries.get(scriptId) === entry) entries.delete(scriptId)
    const idx = order.indexOf(scriptId)
    if (idx !== -1) {
      order.splice(idx, 1)
      relayout()
    }
  })

  created.webContents.on('did-finish-load', () => {
    entry.pageReady = true
    if (entry.state) sendState(entry, entry.state)
    if (!created.isDestroyed()) created.showInactive()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    created.loadURL(`${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/hud.html`)
  } else {
    created.loadFile(join(__dirname, '../dist/hud.html'))
  }

  return entry
}

/** 显示某个脚本的浮窗（已存在则只更新内容） */
export function showHud(state: HudState) {
  if (!isEnabled()) return
  const scriptId = state.scriptId
  let entry = entries.get(scriptId)
  if (!entry || entry.win.isDestroyed()) {
    if (!order.includes(scriptId)) order.push(scriptId)
    entry = createWindow(scriptId)
  } else if (!order.includes(scriptId)) {
    order.push(scriptId)
    relayout()
  }
  sendState(entry, state)
  if (entry.pageReady && !entry.win.isDestroyed() && !entry.win.isVisible()) {
    entry.win.showInactive()
  }
}

/** 更新浮窗内容（该脚本的浮窗未显示时忽略） */
export function updateHud(patch: Partial<HudState> & { scriptId: number }) {
  const entry = entries.get(patch.scriptId)
  if (!entry || entry.win.isDestroyed() || !entry.state) return
  sendState(entry, { ...entry.state, ...patch })
}

/** 关闭浮窗：传 scriptId 只关该脚本，不传则全部关闭（退出清理用） */
export function hideHud(scriptId?: number) {
  if (scriptId === undefined) {
    for (const entry of entries.values()) {
      if (!entry.win.isDestroyed()) entry.win.destroy()
    }
    entries.clear()
    order.length = 0
    return
  }
  const entry = entries.get(scriptId)
  if (entry) {
    entries.delete(scriptId)
    if (!entry.win.isDestroyed()) entry.win.destroy()
  }
  const idx = order.indexOf(scriptId)
  if (idx !== -1) {
    order.splice(idx, 1)
    relayout()
  }
}

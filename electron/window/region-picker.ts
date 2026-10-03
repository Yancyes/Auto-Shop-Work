/**
 * 全屏框选遮罩
 *
 * 用户点「框选监控区域」后，在每台显示器上盖一层无边框透明窗：
 * 窗口本身除选区边框外完全透明，所以用户是在「实时桌面」上框选，
 * 不会看到一张过期的截屏，也不会被主界面挡住要选的内容。
 * 拖出一个矩形即完成选区，Esc 或点「取消」返回 null。
 * 基准图是遮罩关掉之后才抓的，选区边框不会进图。
 *
 * 坐标全程用 DIP：抓帧时把物理截图缩放到显示器的 DIP 尺寸，所以图上的一个像素
 * 就是一个 DIP，鼠标坐标可以直接当区域坐标用；跨屏时再叠加该显示器的原点。
 */
import { BrowserWindow } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import log from 'electron-log'
import type { DisplayInfo, ScreenRect } from '../../shared/types'
import { listDisplays } from '../vision/capture'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface PickSession {
  displays: DisplayInfo[]
  windows: BrowserWindow[]
  settled: boolean
  resolve: (rect: ScreenRect | null) => void
}

let session: PickSession | null = null

function createOverlayWindow(displayIndex: number, bounds: ScreenRect): BrowserWindow {
  const win = new BrowserWindow({
    x: Math.round(bounds.x),
    // 用 display.bounds 原点对齐：多屏上下排列时 y 可能为负或大于主屏高度
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: '框选监控区域',
    webPreferences: {
      // preload 与构建后的主进程同目录（dist-electron/），写错一层就没有 window.api，
      // 遮罩页的拖框与 Esc/取消会全部失灵，用户只能看着一层盖满屏幕的窗无从关闭
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  loadOverlayPage(win, displayIndex)
  return win
}

/** 遮罩页在 public/ 下，构建后进 dist/：dev 走 dev server，打包后按文件路径加载 */
function loadOverlayPage(win: BrowserWindow, displayIndex: number): void {
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/region-picker.html?display=${displayIndex}`)
    return
  }
  win.loadFile(join(__dirname, '../dist/region-picker.html'), { query: { display: String(displayIndex) } })
}

function closeWindows() {
  const windows = session?.windows ?? []
  for (const win of windows) {
    if (!win.isDestroyed()) win.destroy()
  }
}

/** 结算一次选区：所有分支都要收窗并只 resolve 一次 */
function settle(result: ScreenRect | null) {
  const current = session
  if (!current || current.settled) return
  current.settled = true
  closeWindows()
  session = null
  current.resolve(result)
}

/**
 * 打开框选遮罩并等待用户拖框。
 * 已有一层遮罩时直接返回 null：叠两层会让用户分不清在选哪一块，抓图也白做一次。
 */
export async function pickRegion(): Promise<ScreenRect | null> {
  if (session) return null
  const displays = listDisplays()
  if (displays.length === 0) return null

  return new Promise<ScreenRect | null>(resolve => {
    const windows = displays.map((d, i) => createOverlayWindow(i, d.bounds))
    session = { displays, windows, settled: false, resolve }

    for (const win of windows) {
      win.webContents.once('did-finish-load', () => {
        if (!win.isDestroyed()) win.show()
      })
      // 页面加载失败（打包漏文件）也要收场，否则 Promise 永远挂着
      win.webContents.once('did-fail-load', () => {
        log.error('[region-picker] 遮罩页加载失败')
        settle(null)
      })
      win.once('closed', () => {
        // 用户用系统方式关掉最后一层遮罩（任务管理/Alt+F4）等同于取消
        const current = session
        if (!current || current.settled) return
        if (current.windows.every(w => w.isDestroyed())) settle(null)
      })
    }
    log.info(`[region-picker] 已打开 ${windows.length} 层框选遮罩`)
  })
}

/** 遮罩页把本机上的矩形（相对该显示器左上角）交回来，这里换算成虚拟桌面坐标 */
export function submitSelect(displayIndex: number, local: ScreenRect): boolean {
  const current = session
  if (!current || current.settled) return false
  const display = current.displays[displayIndex]
  if (!display) return false
  const rect: ScreenRect = {
    x: display.bounds.x + Math.round(local.x),
    y: display.bounds.y + Math.round(local.y),
    width: Math.round(local.width),
    height: Math.round(local.height)
  }
  if (rect.width < 4 || rect.height < 4) {
    // 拖出的点太小通常是误触，让用户重选而不是存一个 1px 区域
    log.info('[region-picker] 选区过小，忽略')
    return false
  }
  settle(rect)
  return true
}

export function cancelSelect(): boolean {
  if (!session) return false
  settle(null)
  return true
}

export function isPicking(): boolean {
  return session !== null
}

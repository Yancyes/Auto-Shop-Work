/**
 * 迷你控制窗 + 主窗口形态切换
 *
 * 录制/执行期间把 1280x800 的主窗口收起来，只留一个置顶小窗：
 * 结束录制、恢复窗口、暂停继续、跳过本步、终止。小窗无边框、可拖动，
 * 用户能把它拖到屏幕任意位置，不会挡住要盯的网页区域。
 *
 * 窗口形态与「当前操作对象是哪个脚本」都记在这里：页面上的按钮只上报
 * 「按了哪个钮」，主进程按记住的 scriptId 下命令，界面拿不到也不该拿到脚本 ID。
 */
import { BrowserWindow, screen } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import log from 'electron-log'
import type { MiniControlState, WindowMode } from '../../shared/types'
import { getMainWindow } from './registry'

const __dirname = dirname(fileURLToPath(import.meta.url))

const WIDTH = 420
const HEIGHT = 132
const MARGIN = 24

interface MiniEntry {
  win: BrowserWindow
  pageReady: boolean
}

let mini: MiniEntry | null = null
let mode: WindowMode = 'normal'
/** 收起前的主窗口位置尺寸，恢复时按它回原样（含最大化状态） */
let restoreBounds: { x: number; y: number; width: number; height: number } | null = null
let wasMaximized = false
/** 迷你窗按钮作用到哪个脚本；录制阶段为 null */
let targetScriptId: number | null = null
let state: MiniControlState = {
  mode: 'normal',
  phase: 'idle',
  title: '',
  stepIndex: -1,
  totalSteps: 0,
  paused: false,
  takeover: false,
  monitors: []
}

function defaultPosition() {
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(WIDTH, workArea.width - 2 * MARGIN)
  // 右上角：底部是任务栏与执行浮窗的位置，右边留出网页主体
  return { width, height: HEIGHT, x: workArea.x + workArea.width - width - MARGIN, y: workArea.y + MARGIN }
}

function loadMiniPage(win: BrowserWindow): void {
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/mini-control.html`)
    return
  }
  win.loadFile(join(__dirname, '../dist/mini-control.html'))
}

function sendState() {
  if (!mini || mini.win.isDestroyed() || !mini.pageReady) return
  mini.win.webContents
    .executeJavaScript(`window.__miniSetState(${JSON.stringify(state)})`)
    .catch(() => {
      // 窗口刚被关掉：状态已存在模块里，下次打开会补发
    })
}

function createMini(): MiniEntry {
  if (mini && !mini.win.isDestroyed()) return mini

  const created = new BrowserWindow({
    ...defaultPosition(),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'TraceFlow 控制',
    webPreferences: {
      // 与构建后的主进程同目录；写错一层就没 window.api，迷你窗按钮会全部点不动
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  // 'screen-saver' 层级才压得住 Chromium 的执行浏览器窗口
  created.setAlwaysOnTop(true, 'screen-saver')
  created.once('closed', () => {
    if (mini?.win === created) mini = null
  })
  created.webContents.once('did-finish-load', () => {
    if (created.isDestroyed()) return
    mini = { win: created, pageReady: true }
    sendState()
    // showInactive 不抢焦点：正在被操作的网页不该因为小窗冒出来就失焦
    created.showInactive()
  })
  loadMiniPage(created)
  mini = { win: created, pageReady: false }
  return mini
}

function hideMini() {
  if (!mini || mini.win.isDestroyed()) {
    mini = null
    return
  }
  mini.win.destroy()
  mini = null
}

/**
 * 切换主窗口形态。
 * 收起时必须先记下位置和最大化状态，否则恢复回来是个小窗口或者叠在错误位置。
 */
export function setWindowMode(next: WindowMode): WindowMode {
  const main = getMainWindow()
  if (next === mode) {
    // 已经在这个形态：仍在 mini 时确保小窗存在（例如脚本刚开始又调了一次）
    if (mode === 'mini') createMini()
    return mode
  }

  if (next === 'mini') {
    if (main) {
      wasMaximized = main.isMaximized()
      const b = main.getBounds()
      restoreBounds = { x: b.x, y: b.y, width: b.width, height: b.height }
      main.hide()
    }
    mode = 'mini'
    state = { ...state, mode }
    createMini()
    log.info('[mini] 主窗口已收起为迷你控制窗')
  } else {
    mode = 'normal'
    state = { ...state, mode }
    hideMini()
    if (main) {
      if (restoreBounds) main.setBounds(restoreBounds)
      if (wasMaximized) main.maximize()
      main.show()
      main.focus()
    }
    log.info('[mini] 主窗口已恢复原本大小')
  }
  return mode
}

export function getWindowMode(): WindowMode {
  return mode
}

/** 迷你窗按钮命令的目标脚本 */
export function setMiniTarget(scriptId: number | null): void {
  targetScriptId = scriptId
}

export function getMiniTarget(): number | null {
  return targetScriptId
}

/** 局部更新小窗状态；页面还没加载完时先攒着，加载完补发 */
export function pushMiniState(patch: Partial<MiniControlState>): void {
  state = { ...state, ...patch, mode }
  sendState()
}

/**
 * 执行中的进度更新：只有「小窗当前盯着的那个脚本」才有权改显示。
 * 并发跑多个脚本时，不拦这一层的话小窗会被最后一个上报的脚本刷屏，
 * 用户按「暂停」就打到别的脚本上去了。
 */
export function pushRunState(scriptId: number, patch: Partial<MiniControlState>): void {
  if (targetScriptId !== scriptId) return
  pushMiniState(patch)
}

/**
 * 脚本开始执行时的绑定：记下目标，但只在用户已经收起主窗口时才显示小窗。
 * 不这么做的话每次点「执行」应用都会自己缩成一条，多数人只是想正常跑脚本。
 */
export function bindRunFocus(scriptId: number, title: string): void {
  setMiniTarget(scriptId)
  if (mode !== 'mini') return
  createMini()
  pushMiniState({ phase: 'running', title })
}

/** 录制会话绑定：小窗上只留「结束录制」可用，按钮命令走 stopRecord 分支 */
export function bindRecordFocus(title: string): void {
  if (mode === 'mini') createMini()
  pushMiniState({ phase: 'recording', title })
}

/** 录制结束：清掉录制态，避免小窗继续显示「结束录制」按钮 */
export function endRecordFocus(): void {
  pushMiniState({ phase: 'idle', title: '', stepText: undefined, monitors: [] })
}

/** 执行结束/被终止：目标清空并把小窗收回空闲态，避免按钮打到已结束的脚本 */
export function clearMiniTarget(scriptId: number): void {
  if (targetScriptId !== scriptId) return
  targetScriptId = null
  pushMiniState({
    phase: 'idle',
    title: '',
    stepText: undefined,
    stepIndex: -1,
    totalSteps: 0,
    paused: false,
    takeover: false,
    monitors: []
  })
}

/** 彻底收起小窗（退出应用时用，否则会压住 window-all-closed） */
export function closeMini(): void {
  hideMini()
}

export function isMiniVisible(): boolean {
  return mini !== null && !mini.win.isDestroyed()
}

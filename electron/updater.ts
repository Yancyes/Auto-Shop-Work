/**
 * 自动更新模块
 * 基于 electron-updater（electron-builder 官方生态），配合 NSIS 目标使用。
 * - 生产环境（app.isPackaged）下生效，开发模式自动禁用
 * - 启动时静默检查一次更新；用户可手动触发检查
 * - 发现新版本后不自动下载，由用户在界面确认后下载、安装
 */
import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'
import { pushEvent } from './ipc'
import type { UpdaterState, UpdaterEvent } from '../shared/types'

let state: UpdaterState = {
  status: 'idle',
  currentVersion: app.getVersion()
}

/** 更新状态并推送给渲染进程 */
function updateState(patch: Partial<UpdaterState>, silent = false) {
  state = { ...state, ...patch }
  if (!silent) {
    const event: UpdaterEvent = { type: 'state-change', state }
    pushEvent('updater:event', event)
  }
}

function getState(): UpdaterState {
  return state
}

/** 安全提取 releaseNotes */
function extractReleaseNotes(info: { releaseNotes?: string | Array<{ note?: string | null }> | null }): string | undefined {
  if (!info.releaseNotes) return undefined
  if (typeof info.releaseNotes === 'string') return info.releaseNotes
  if (Array.isArray(info.releaseNotes)) {
    return info.releaseNotes.map(n => n?.note ?? '').filter(Boolean).join('\n')
  }
  return undefined
}

/** 检查更新（manual=true 时错误会反馈给界面，自动检查的错误仅记录日志） */
async function checkForUpdates(manual = false): Promise<UpdaterState> {
  if (!app.isPackaged) {
    if (manual) {
      updateState({ status: 'not-available', error: '开发模式下不支持自动更新，请使用打包后的应用' })
    } else {
      updateState({ status: 'idle', error: undefined }, true)
    }
    return getState()
  }

  updateState({ status: 'checking', error: undefined })
  try {
    await autoUpdater.checkForUpdates()
    return getState()
  } catch (e) {
    const msg = (e as Error).message || String(e)
    log.error('[updater] 检查更新失败:', msg)
    if (manual) {
      updateState({ status: 'error', error: msg })
    } else {
      updateState({ status: 'idle', error: undefined }, true)
    }
    return getState()
  }
}

/** 下载新版本（需先检查到可用更新） */
async function downloadUpdate(): Promise<boolean> {
  if (!app.isPackaged) return false
  if (state.status !== 'available') {
    updateState({ status: 'error', error: '当前没有可下载的更新' })
    return false
  }
  updateState({ status: 'downloading', error: undefined })
  try {
    autoUpdater.downloadUpdate()
    return true
  } catch (e) {
    const msg = (e as Error).message || String(e)
    log.error('[updater] 下载失败:', msg)
    updateState({ status: 'error', error: msg })
    return false
  }
}

/** 退出并安装（下载完成后调用） */
function quitAndInstall(): boolean {
  if (!app.isPackaged) return false
  if (state.status !== 'downloaded') {
    updateState({ status: 'error', error: '更新尚未下载完成' })
    return false
  }
  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true)
  })
  return true
}

/** 初始化：配置 autoUpdater 并注册 IPC */
export function initUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = log

  // 事件 → 状态机
  autoUpdater.on('checking-for-update', () => {
    log.info('[updater] 正在检查更新...')
  })
  autoUpdater.on('update-available', (info) => {
    log.info('[updater] 发现新版本:', info.version)
    updateState({
      status: 'available',
      availableVersion: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: extractReleaseNotes(info),
      error: undefined
    })
  })
  autoUpdater.on('update-not-available', () => {
    log.info('[updater] 当前已是最新版本')
    updateState({ status: 'not-available', error: undefined })
  })
  autoUpdater.on('download-progress', (progress) => {
    updateState({
      status: 'downloading',
      progress: {
        percent: Math.round(progress.percent * 10) / 10,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond
      }
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] 更新下载完成:', info.version)
    updateState({
      status: 'downloaded',
      availableVersion: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: extractReleaseNotes(info),
      error: undefined
    })
  })
  autoUpdater.on('error', (err) => {
    const msg = err?.message || String(err)
    log.error('[updater] 更新错误:', msg)
    updateState({ status: 'error', error: msg })
  })

  // IPC 注册（放本模块，避免与 ipc.ts 循环依赖）
  ipcMain.handle('updater:state', () => ({ success: true, data: getState() }))
  ipcMain.handle('updater:check', async () => {
    try {
      return { success: true, data: await checkForUpdates(true) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('updater:download', async () => {
    try {
      return { success: true, data: await downloadUpdate() }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('updater:install', () => {
    try {
      return { success: true, data: quitAndInstall() }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  if (!app.isPackaged) {
    log.info('[updater] 开发模式下自动更新已禁用')
    return
  }

  // 启动后立即静默检查更新（错误不打扰用户）
  checkForUpdates(false).catch(() => {})
}

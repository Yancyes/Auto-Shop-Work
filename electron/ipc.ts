import { ipcMain, dialog, BrowserWindow } from 'electron'
import log from 'electron-log'
import type { IpcEventChannels } from '../shared/types'
import { getScripts, saveScript, deleteScript, getLogs, deleteLog, clearLogs } from './db/repository'
import { getSettings, saveSettings } from './config'
import { applyLogDir } from './utils/log-transport'
import { ScriptManager } from './script/script-manager'
import { BrowserManager } from './browser/browser-manager'
import { detectBrowser } from './browser/browser-detect'
import { sendFeedback } from './services/feedback'
import { getChangelog } from './services/changelog'
import type { IpcResponse } from '../shared/types'

export function pushEvent<K extends keyof IpcEventChannels>(
  channel: K,
  ...args: Parameters<IpcEventChannels[K]>
) {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  })
}

function ok<T>(data: T): IpcResponse<T> {
  return { success: true, data }
}

function fail(error: unknown): IpcResponse<never> {
  return { success: false, error: error instanceof Error ? error.message : String(error) }
}

function handle(channel: string, fn: (...args: any[]) => any) {
  ipcMain.handle(channel, async (_e: any, ...args: any[]) => {
    try {
      return ok(await fn(...args))
    } catch (e) {
      return fail(e)
    }
  })
}

export function registerIpcHandlers(_ipcMain: typeof ipcMain) {
  const sm = () => ScriptManager.getInstance()

  // ========== 脚本管理 ==========
  handle('script:list', () => getScripts())
  handle('script:save', (script: any) => saveScript(script))
  handle('script:delete', (id: number) => {
    // 执行/排队中的脚本不允许删除：记录被删后收尾阶段找不到行，界面会卡在「正在执行」
    if (sm().isBusy(id)) throw new Error('该脚本正在执行或排队中，请先终止后再删除')
    return deleteScript(id)
  })
  // 非阻塞：入队后立即返回，不等待队列执行完（无限循环模式下 await 会让 IPC 永不返回）
  handle('script:run', (id: number, count: number) => {
    sm().runScript(id, count)
    return true
  })
  handle('script:pause', (id: number) => {
    sm().pauseCurrent(id)
    return true
  })
  handle('script:resume', (id: number) => {
    sm().resumeCurrent(id)
    return true
  })
  handle('script:terminate', (id: number) => {
    sm().terminateCurrent(id)
    return true
  })
  handle('script:stopAll', () => {
    sm().stopAll()
    return true
  })

  // ========== 日志 ==========
  handle('log:list', (filter?: any) => getLogs(filter))
  handle('log:delete', (id: number) => deleteLog(id))
  handle('log:clear', () => clearLogs())

  // ========== 设置 ==========
  handle('settings:get', () => getSettings())
  handle('settings:save', async (settings: any) => {
    const before = getSettings()
    const merged = saveSettings(settings)
    // 日志目录改了立即切换落盘位置，无需重启
    if (before.storage.logDir !== merged.storage.logDir) applyLogDir()
    // 换了浏览器程序或无头模式，缓存的浏览器实例还是旧配置：不重建的话要等 5 分钟空闲休眠才生效
    const needsRelaunch =
      before.browser.executablePath !== merged.browser.executablePath ||
      before.browser.headless !== merged.browser.headless
    if (!needsRelaunch) return merged
    if (sm().isBusy()) {
      log.warn('[IPC] 有脚本正在执行，新的浏览器配置将在本轮执行结束后生效')
    } else {
      await BrowserManager.getInstance().destroy()
    }
    return merged
  })

  // ========== 执行浏览器 ==========
  handle('browser:detect', (executablePath?: string) => detectBrowser(executablePath))
  // 选择浏览器程序文件；取消返回 null
  handle('dialog:pickBrowser', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择浏览器程序',
      properties: ['openFile'],
      defaultPath: process.env.ProgramFiles,
      filters: [{ name: '浏览器程序', extensions: ['exe'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ========== 功能反馈 ==========
  handle('feedback:send', async (payload: { content: string; contact?: string }) => { await sendFeedback(payload); return true })

  // ========== 历史更新记录 ==========
  handle('changelog:list', () => getChangelog())
}

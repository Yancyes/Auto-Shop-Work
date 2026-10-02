import { ipcMain, BrowserWindow } from 'electron'
import type { IpcEventChannels } from '../shared/types'
import { getScripts, getScript, saveScript, deleteScript, getLogs, deleteLog, clearLogs } from './db/repository'
import { getSettings, saveSettings } from './config'
import { ScriptManager } from './script/script-manager'
import { sendFeedback } from './services/feedback'
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
  handle('script:get', (id: number) => getScript(id))
  handle('script:save', (script: any) => saveScript(script))
  handle('script:delete', (id: number) => deleteScript(id))
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
  handle('settings:save', (settings: any) => saveSettings(settings))

  // ========== 功能反馈 ==========
  handle('feedback:send', async (payload: { content: string; contact?: string }) => { await sendFeedback(payload); return true })
}

import { ipcMain, BrowserWindow } from 'electron'
import type { IpcEventChannels, TaskRecord } from '../shared/types'
import { getTemplates, getTemplate, saveTemplate, deleteTemplate, getTasks, getTask, getLogs, deleteLog, clearLogs, getDashboardStats, createTask, deleteTask, deleteTasks } from './db/repository'
import { getSettings, saveSettings } from './config'
import { TaskManager } from './task/task-manager'
import { BrowserManager } from './browser/browser-manager'
import { sendFeedback } from './services/feedback'
import type { IpcResponse } from '../shared/types'

export function pushEvent<K extends keyof IpcEventChannels>(
  channel: K,
  ...args: Parameters<IpcEventChannels[K]>
) {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send(channel, ...args)
  })
}

function ok<T>(data: T): IpcResponse<T> {
  return { success: true, data }
}

function fail(error: unknown): IpcResponse<never> {
  return { success: false, error: (error as Error).message }
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

function handleBatch(channel: string, fn: (id: number) => any) {
  handle(channel, (ids: number[]) => {
    ids.forEach(id => fn(id))
    return true
  })
}

export function registerIpcHandlers(_ipcMain: typeof ipcMain) {
  const tm = () => TaskManager.getInstance()
  const bm = () => BrowserManager.getInstance()

  // ========== 模板管理 ==========
  handle('template:list', () => getTemplates())
  handle('template:get', (id: number) => getTemplate(id))
  handle('template:save', (template: any) => saveTemplate(template))
  handle('template:delete', (id: number) => deleteTemplate(id))

  // ========== 任务管理 ==========
  handle('task:create', (templateId: number, count: number) => {
    const template = getTemplate(templateId)
    if (!template) throw new Error('模板不存在')
    const tasks = createTask(templateId, count, template)
    tasks.forEach((t: TaskRecord) => tm().enqueue(t))
    return tasks
  })

  handle('task:list', (filter?: any) => getTasks(filter))
  handle('task:start', (id: number) => { tm().start(id); return true })
  handle('task:pause', (id: number) => { tm().pause(id); return true })
  handle('task:terminate', (id: number) => { tm().terminate(id); return true })
  handle('task:retry', (id: number) => { tm().retry(id); return true })

  handleBatch('task:startBatch', (id) => tm().start(id))
  handleBatch('task:pauseBatch', (id) => tm().pause(id))
  handleBatch('task:terminateBatch', (id) => tm().terminate(id))

  handle('task:stopAll', () => { tm().stopAll(); return true })
  handle('task:detail', (id: number) => getTask(id))

  handle('task:delete', (id: number) => {
    tm().delete(id)
    return deleteTask(id)
  })

  handle('task:deleteBatch', (ids: number[]) => {
    ids.forEach(id => tm().delete(id))
    return deleteTasks(ids) > 0
  })

  // ========== 日志 ==========
  handle('log:list', (filter?: any) => getLogs(filter))
  handle('log:delete', (id: number) => deleteLog(id))
  handle('log:clear', () => clearLogs())

  // ========== 设置 ==========
  handle('settings:get', () => getSettings())
  handle('settings:save', (settings: any) => saveSettings(settings))

  // ========== 仪表盘 ==========
  handle('dashboard:stats', () => getDashboardStats())

  // ========== 浏览器登录检查 ==========
  ipcMain.handle('browser:ensureLogin', async () => {
    let context: import('playwright').BrowserContext | null = null
    try {
      context = await bm().createContext()
      const page = await context.newPage()
      await page.goto('https://www.dd373.com/')
      const loggedIn = await page.locator('.login-status, .user-name, .header-user, .user-info').count() > 0
      return ok(loggedIn)
    } catch (e) {
      return fail(e)
    } finally {
      if (context) await context.close().catch(() => {})
    }
  })

  // ========== 浏览器监控 ==========
  handle('browser:getPages', () => bm().getActivePages())
  handle('browser:screenshot', (pageIndex: number) => bm().captureScreenshot(pageIndex))
  handle('browser:execute', (pageIndex: number, action: string, params: any) => bm().executeOnPage(pageIndex, action, params))

  // ========== 元素拾取 ==========
  handle('browser:pickElements', (pageIndex: number) => bm().pickElements(pageIndex))
  handle('browser:pickClick', (pageIndex: number, index: number) => bm().pickClick(pageIndex, index))
  handle('browser:pickExit', async (pageIndex: number) => { await bm().pickExit(pageIndex); return true })

  // ========== 功能反馈 ==========
  handle('feedback:send', async (payload: { content: string; contact?: string }) => { await sendFeedback(payload); return true })
}

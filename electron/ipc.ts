import { ipcMain, BrowserWindow } from 'electron'
import type { IpcChannels, IpcEventChannels, TaskRecord } from '../shared/types'
import { getTemplates, getTemplate, saveTemplate, deleteTemplate, getTasks, getTask, getLogs, deleteLog, clearLogs, getDashboardStats, createTask, deleteTask, deleteTasks } from './db/repository'
import { getSettings, saveSettings } from './config'
import { TaskManager } from './task/task-manager'
import { BrowserManager } from './browser/browser-manager'
import { sendFeedback } from './services/feedback'

/** 向所有渲染窗口推送事件 */
export function pushEvent<K extends keyof IpcEventChannels>(
  channel: K,
  ...args: Parameters<IpcEventChannels[K]>
) {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send(channel, ...args)
  })
}

export function registerIpcHandlers(_ipcMain: typeof ipcMain) {
  // ========== 模板管理 ==========
  ipcMain.handle('template:list', () => {
    try {
      return { success: true, data: getTemplates() }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('template:get', (_e, id: number) => {
    try {
      return { success: true, data: getTemplate(id) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('template:save', (_e, template) => {
    try {
      return { success: true, data: saveTemplate(template) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('template:delete', (_e, id: number) => {
    try {
      return { success: true, data: deleteTemplate(id) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ========== 任务管理 ==========
  ipcMain.handle('task:create', (_e, templateId: number, count: number) => {
    try {
      const template = getTemplate(templateId)
      if (!template) return { success: false, error: '模板不存在' }
      const tasks = createTask(templateId, count, template)
      tasks.forEach((t: TaskRecord) => TaskManager.getInstance().enqueue(t))
      return { success: true, data: tasks }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('task:list', (_e, filter?) => {
    try {
      return { success: true, data: getTasks(filter) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('task:start', (_e, id: number) => {
    try {
      TaskManager.getInstance().start(id)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('task:pause', (_e, id: number) => {
    try {
      TaskManager.getInstance().pause(id)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('task:terminate', (_e, id: number) => {
    try {
      TaskManager.getInstance().terminate(id)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('task:retry', (_e, id: number) => {
    try {
      TaskManager.getInstance().retry(id)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('task:startBatch', (_e, ids: number[]) => {
    try {
      ids.forEach(id => TaskManager.getInstance().start(id))
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('task:pauseBatch', (_e, ids: number[]) => {
    try {
      ids.forEach(id => TaskManager.getInstance().pause(id))
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('task:terminateBatch', (_e, ids: number[]) => {
    try {
      ids.forEach(id => TaskManager.getInstance().terminate(id))
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('task:stopAll', () => {
    try {
      TaskManager.getInstance().stopAll()
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('task:detail', (_e, id: number) => {
    try {
      return { success: true, data: getTask(id) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('task:delete', (_e, id: number) => {
    try {
      TaskManager.getInstance().delete(id)
      const result = deleteTask(id)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('task:deleteBatch', (_e, ids: number[]) => {
    try {
      const manager = TaskManager.getInstance()
      ids.forEach(id => manager.delete(id))
      const count = deleteTasks(ids)
      return { success: true, data: count > 0 }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ========== 日志 ==========
  ipcMain.handle('log:list', (_e, filter?) => {
    try {
      return { success: true, data: getLogs(filter) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('log:delete', (_e, id: number) => {
    try {
      return { success: true, data: deleteLog(id) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('log:clear', () => {
    try {
      return { success: true, data: clearLogs() }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ========== 设置 ==========
  ipcMain.handle('settings:get', () => {
    try {
      return { success: true, data: getSettings() }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('settings:save', (_e, settings) => {
    try {
      return { success: true, data: saveSettings(settings) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ========== 仪表盘 ==========
  ipcMain.handle('dashboard:stats', () => {
    try {
      return { success: true, data: getDashboardStats() }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ========== 浏览器登录检查 ==========
  ipcMain.handle('browser:ensureLogin', async () => {
    let context: import('playwright').BrowserContext | null = null
    try {
      context = await BrowserManager.getInstance().createContext()
      const page = await context.newPage()
      await page.goto('https://www.dd373.com/')
      const loggedIn = await page.locator('.login-status, .user-name, .header-user, .user-info').count() > 0
      return { success: true, data: loggedIn }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    } finally {
      // 确保无论成功或异常都关闭上下文，防止资源泄漏
      if (context) await context.close().catch(() => {})
    }
  })

  // ========== 浏览器监控 ==========
  ipcMain.handle('browser:getPages', async () => {
    try {
      const pages = await BrowserManager.getInstance().getActivePages()
      return { success: true, data: pages }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('browser:screenshot', async (_e, pageIndex: number) => {
    try {
      const screenshot = await BrowserManager.getInstance().captureScreenshot(pageIndex)
      return { success: true, data: screenshot }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('browser:execute', async (_e, pageIndex: number, action: string, params: any) => {
    try {
      const result = await BrowserManager.getInstance().executeOnPage(pageIndex, action, params)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ========== 元素拾取 ==========
  ipcMain.handle('browser:pickElements', async (_e, pageIndex: number) => {
    try {
      const result = await BrowserManager.getInstance().pickElements(pageIndex)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('browser:pickClick', async (_e, pageIndex: number, index: number) => {
    try {
      const result = await BrowserManager.getInstance().pickClick(pageIndex, index)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('browser:pickExit', async (_e, pageIndex: number) => {
    try {
      await BrowserManager.getInstance().pickExit(pageIndex)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ========== 功能反馈 ==========
  ipcMain.handle('feedback:send', async (_e, payload: { content: string; contact?: string }) => {
    try {
      await sendFeedback(payload)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}

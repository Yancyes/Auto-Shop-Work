import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ipc } from '@/api'
import type { RunLog, LogLevel, SystemSettings, DashboardStats } from '../../shared/types'

export const useLogStore = defineStore('log', () => {
  const logs = ref<RunLog[]>([])
  const currentScreenshot = ref<string | null>(null)
  const settings = ref<SystemSettings | null>(null)

  /** 加载日志 */
  async function loadLogs(filter?: { level?: LogLevel; taskId?: number; startTime?: string; endTime?: string }) {
    const res = await ipc.invoke('log:list', filter)
    if (res.success && res.data) {
      logs.value = res.data
    }
  }

  /** 加载设置 */
  async function loadSettings() {
    const res = await ipc.invoke('settings:get')
    if (res.success && res.data) {
      settings.value = res.data
    }
  }

  /** 保存设置 */
  async function saveSettings(partial: Partial<SystemSettings>) {
    const res = await ipc.invoke('settings:save', partial)
    if (res.success && res.data) {
      settings.value = res.data
    }
    return res
  }

  /** 删除单条日志 */
  async function deleteLog(id: number) {
    const res = await ipc.invoke('log:delete', id)
    if (res.success) {
      logs.value = logs.value.filter(l => l.id !== id)
    }
    return res
  }

  /** 清空所有日志 */
  async function clearLogs() {
    const res = await ipc.invoke('log:clear')
    if (res.success) {
      logs.value = []
    }
    return res
  }

  /** 事件监听是否已注册（防止重复注册） */
  let listenersRegistered = false

  /** 监听日志事件，全局只注册一次 */
  function setupEventListeners() {
    if (listenersRegistered) return
    listenersRegistered = true

    ipc.on('task:log', (data) => {
      // 在列表头部插入新日志
      logs.value.unshift({
        id: Date.now(),
        taskId: data.taskId,
        level: data.level,
        message: data.message,
        screenshotPath: data.screenshotPath,
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
      })
      // 限制最多 500 条
      if (logs.value.length > 500) {
        logs.value = logs.value.slice(0, 500)
      }
    })
  }

  return {
    logs, currentScreenshot, settings,
    loadLogs, loadSettings, saveSettings, deleteLog, clearLogs, setupEventListeners
  }
})

export const useDashboardStore = defineStore('dashboard', () => {
  const stats = ref<DashboardStats>({
    todaySuccess: 0,
    todayFailed: 0,
    totalToday: 0,
    successRate: 0,
    estimatedRevenue: 0,
    runningCount: 0
  })

  async function loadStats() {
    const res = await ipc.invoke('dashboard:stats')
    if (res.success && res.data) {
      stats.value = res.data
    }
  }

  return { stats, loadStats }
})

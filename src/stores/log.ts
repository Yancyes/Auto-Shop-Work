import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ipc } from '@/api'
import type { RunLog, LogLevel, SystemSettings } from '../../shared/types'

export const useLogStore = defineStore('log', () => {
  const logs = ref<RunLog[]>([])
  const currentScreenshot = ref<string | null>(null)
  const settings = ref<SystemSettings | null>(null)

  async function loadLogs(filter?: { level?: LogLevel; scriptId?: number; startTime?: string; endTime?: string }) {
    const res = await ipc.invoke('log:list', filter)
    if (res.success && res.data) {
      logs.value = res.data
    }
  }

  async function loadSettings() {
    const res = await ipc.invoke('settings:get')
    if (res.success && res.data) {
      settings.value = res.data
    }
  }

  async function saveSettings(partial: Partial<SystemSettings>) {
    const res = await ipc.invoke('settings:save', partial)
    if (res.success && res.data) {
      settings.value = res.data
    }
    return res
  }

  async function deleteLog(id: number) {
    const res = await ipc.invoke('log:delete', id)
    if (res.success) {
      logs.value = logs.value.filter(l => l.id !== id)
    }
    return res
  }

  async function clearLogs() {
    const res = await ipc.invoke('log:clear')
    if (res.success) {
      logs.value = []
    }
    return res
  }

  let listenersRegistered = false
  // 本地即时日志的 id：用负数自增序列，避免用 Date.now() 时同毫秒两条日志 key 重复，
  // 也避免与数据库自增 id（正数）冲突
  let localLogId = 0

  function pushLocalLog(entry: Omit<RunLog, 'id' | 'createdAt'>) {
    logs.value.unshift({
      ...entry,
      id: --localLogId,
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
    })
    if (logs.value.length > 500) {
      logs.value = logs.value.slice(0, 500)
    }
  }

  function setupEventListeners() {
    if (listenersRegistered) return
    listenersRegistered = true

    ipc.on('script:complete', (data) => {
      pushLocalLog({
        scriptId: data.scriptId,
        level: data.success ? 'info' : 'warn',
        message: data.message
      })
    })

    ipc.on('script:stepError', (data) => {
      pushLocalLog({
        scriptId: data.scriptId,
        level: 'error',
        message: `步骤 ${data.stepIndex + 1} 执行失败: ${data.error}`
      })
    })
  }

  return {
    logs, currentScreenshot, settings,
    loadLogs, loadSettings, saveSettings, deleteLog, clearLogs, setupEventListeners
  }
})

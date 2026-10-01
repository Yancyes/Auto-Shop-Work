import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElNotification } from 'element-plus'
import { ipc } from '@/api'
import type { TaskRecord, TaskStatus, IpcChannels } from '../../shared/types'

export const useTaskStore = defineStore('task', () => {
  const tasks = ref<TaskRecord[]>([])
  const currentTask = ref<TaskRecord | null>(null)
  const detailDrawerVisible = ref(false)
  const latestScreenshot = ref<string | null>(null)
  const currentStep = ref<string | null>(null)

  const runningCount = computed(() =>
    tasks.value.filter(t => t.status === 'running' || t.status === 'pending').length
  )

  async function loadTasks(filter?: { status?: TaskStatus; keyword?: string }) {
    const res = await ipc.invoke('task:list', filter)
    if (res.success && res.data) {
      tasks.value = res.data
    }
  }

  async function invokeAndReload(channel: keyof IpcChannels, ...args: any[]) {
    const res = await (ipc.invoke as Function)(channel, ...args)
    await loadTasks()
    return res
  }

  async function createTasks(templateId: number, count: number) {
    const res = await ipc.invoke('task:create', templateId, count)
    if (res.success && res.data) {
      tasks.value.unshift(...res.data)
    }
    return res
  }

  const startTask = (id: number) => invokeAndReload('task:start', id)
  const pauseTask = (id: number) => invokeAndReload('task:pause', id)
  const terminateTask = (id: number) => invokeAndReload('task:terminate', id)
  const retryTask = (id: number) => invokeAndReload('task:retry', id)
  const startBatch = (ids: number[]) => invokeAndReload('task:startBatch', ids)
  const pauseBatch = (ids: number[]) => invokeAndReload('task:pauseBatch', ids)
  const terminateBatch = (ids: number[]) => invokeAndReload('task:terminateBatch', ids)
  const stopAll = () => invokeAndReload('task:stopAll')
  const deleteTask = (id: number) => invokeAndReload('task:delete', id)
  const deleteBatch = (ids: number[]) => invokeAndReload('task:deleteBatch', ids)

  async function showDetail(id: number) {
    const res = await ipc.invoke('task:detail', id)
    if (res.success && res.data) {
      currentTask.value = res.data
      detailDrawerVisible.value = true
    }
  }

  let listenersRegistered = false

  function setupEventListeners() {
    if (listenersRegistered) return
    listenersRegistered = true

    ipc.on('task:progress', (data) => {
      const task = tasks.value.find(t => t.id === data.taskId)
      if (task) {
        task.progress = data.progress
        task.currentStep = data.step
      }
      currentStep.value = data.step
    })

    ipc.on('task:screenshot', (data) => {
      latestScreenshot.value = data.screenshotPath
    })

    ipc.on('task:statusChange', (data) => {
      const task = tasks.value.find(t => t.id === data.taskId)
      if (task) {
        task.status = data.status
        task.failReason = data.failReason
      }
    })

    ipc.on('task:manualRequired', (data) => {
      ElNotification({
        title: '需要人工介入',
        message: `任务 #${data.taskId}: ${data.reason}`,
        type: 'warning',
        duration: 0
      })
    })

    ipc.on('task:batchComplete', () => {
      loadTasks()
    })
  }

  return {
    tasks, currentTask, detailDrawerVisible,
    latestScreenshot, currentStep,
    runningCount,
    loadTasks, createTasks, startTask, pauseTask, terminateTask, retryTask,
    startBatch, pauseBatch, terminateBatch, stopAll, deleteTask, deleteBatch, showDetail,
    setupEventListeners
  }
})

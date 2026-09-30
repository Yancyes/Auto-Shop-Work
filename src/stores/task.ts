import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElNotification } from 'element-plus'
import { ipc } from '@/api'
import type { TaskRecord, TaskStatus } from '../../shared/types'

export const useTaskStore = defineStore('task', () => {
  const tasks = ref<TaskRecord[]>([])
  const currentTask = ref<TaskRecord | null>(null)
  const detailDrawerVisible = ref(false)

  const runningCount = computed(() =>
    tasks.value.filter(t => t.status === 'running' || t.status === 'pending').length
  )

  /** 加载任务列表 */
  async function loadTasks(filter?: { status?: TaskStatus; keyword?: string }) {
    const res = await ipc.invoke('task:list', filter)
    if (res.success && res.data) {
      tasks.value = res.data
    }
  }

  /** 创建任务 */
  async function createTasks(templateId: number, count: number) {
    const res = await ipc.invoke('task:create', templateId, count)
    if (res.success && res.data) {
      tasks.value.unshift(...res.data)
    }
    return res
  }

  /** 启动任务 */
  async function startTask(id: number) {
    const res = await ipc.invoke('task:start', id)
    await loadTasks()
    return res
  }

  /** 暂停任务 */
  async function pauseTask(id: number) {
    const res = await ipc.invoke('task:pause', id)
    await loadTasks()
    return res
  }

  /** 终止任务 */
  async function terminateTask(id: number) {
    const res = await ipc.invoke('task:terminate', id)
    await loadTasks()
    return res
  }

  /** 重试任务 */
  async function retryTask(id: number) {
    const res = await ipc.invoke('task:retry', id)
    await loadTasks()
    return res
  }

  /** 批量启动 */
  async function startBatch(ids: number[]) {
    const res = await ipc.invoke('task:startBatch', ids)
    await loadTasks()
    return res
  }

  /** 批量暂停 */
  async function pauseBatch(ids: number[]) {
    const res = await ipc.invoke('task:pauseBatch', ids)
    await loadTasks()
    return res
  }

  /** 批量终止 */
  async function terminateBatch(ids: number[]) {
    const res = await ipc.invoke('task:terminateBatch', ids)
    await loadTasks()
    return res
  }

  /** 停止所有 */
  async function stopAll() {
    const res = await ipc.invoke('task:stopAll')
    await loadTasks()
    return res
  }

  /** 删除任务 */
  async function deleteTask(id: number) {
    const res = await ipc.invoke('task:delete', id)
    await loadTasks()
    return res
  }

  /** 批量删除 */
  async function deleteBatch(ids: number[]) {
    const res = await ipc.invoke('task:deleteBatch', ids)
    await loadTasks()
    return res
  }

  /** 查看详情 */
  async function showDetail(id: number) {
    const res = await ipc.invoke('task:detail', id)
    if (res.success && res.data) {
      currentTask.value = res.data
      detailDrawerVisible.value = true
    }
  }

  /** 事件监听是否已注册（防止重复注册） */
  let listenersRegistered = false

  /** 监听进度更新（实时更新本地任务状态），全局只注册一次 */
  function setupEventListeners() {
    if (listenersRegistered) return
    listenersRegistered = true

    ipc.on('task:progress', (data) => {
      const task = tasks.value.find(t => t.id === data.taskId)
      if (task) {
        task.progress = data.progress
        task.currentStep = data.step
      }
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
        duration: 0 // 不自动关闭
      })
    })

    ipc.on('task:batchComplete', () => {
      loadTasks()
    })
  }

  return {
    tasks, currentTask, detailDrawerVisible,
    runningCount,
    loadTasks, createTasks, startTask, pauseTask, terminateTask, retryTask,
    startBatch, pauseBatch, terminateBatch, stopAll, deleteTask, deleteBatch, showDetail,
    setupEventListeners
  }
})

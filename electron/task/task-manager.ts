import { TaskExecutor } from './task-executor'
import { getTask, updateTaskStatus, getDashboardStats } from '../db/repository'
import { getSettings } from '../config'
import { pushEvent } from '../ipc'
import { taskLog } from '../utils/logger'
import { BrowserManager } from '../browser/browser-manager'
import type { TaskRecord } from '../../shared/types'
import log from 'electron-log'

/**
 * 任务管理器 - 单例
 * 维护等待/运行/完成/失败队列，控制并发，管理生命周期
 */
export class TaskManager {
  private static instance: TaskManager
  private executors = new Map<number, TaskExecutor>()
  private runningCount = 0
  private queue: number[] = [] // 等待中的任务 ID

  private constructor() {}

  static getInstance(): TaskManager {
    if (!TaskManager.instance) {
      TaskManager.instance = new TaskManager()
    }
    return TaskManager.instance
  }

  /** 任务入队 */
  enqueue(task: TaskRecord): void {
    this.queue.push(task.id)
    taskLog(task.id, 'info', `任务已入队，当前队列长度: ${this.queue.length}`)
    this.scheduleNext()
  }

  /** 启动单个任务 */
  start(taskId: number): void {
    const task = getTask(taskId)
    if (!task) return

    // 已在运行或已在队列中，不重复入队
    if (this.executors.has(taskId) || this.queue.includes(taskId)) {
      taskLog(taskId, 'warn', '任务已在运行或等待中，忽略重复启动')
      return
    }

    if (task.status === 'paused' || task.status === 'waiting_manual') {
      // 恢复已暂停任务
      const executor = this.executors.get(taskId)
      if (executor) {
        executor.resume()
        taskLog(taskId, 'info', '任务已恢复执行')
        return
      }
    }

    // 新任务入队
    if (task.status === 'pending' || task.status === 'failed') {
      updateTaskStatus(taskId, 'pending')
      this.queue.push(taskId)
      this.scheduleNext()
    }
  }

  /** 暂停任务 */
  pause(taskId: number): void {
    const executor = this.executors.get(taskId)
    if (executor) {
      executor.pause()
    } else {
      // 从队列移除
      this.queue = this.queue.filter(id => id !== taskId)
      updateTaskStatus(taskId, 'paused')
    }
  }

  /** 终止任务 */
  terminate(taskId: number): void {
    const executor = this.executors.get(taskId)
    if (executor) {
      executor.terminate()
    } else {
      this.queue = this.queue.filter(id => id !== taskId)
      updateTaskStatus(taskId, 'failed', '已手动终止')
    }
  }

  /** 删除任务 */
  delete(taskId: number): void {
    const executor = this.executors.get(taskId)
    if (executor) {
      executor.terminate()
      this.executors.delete(taskId)
      if (this.runningCount > 0) this.runningCount--
    }
    this.queue = this.queue.filter(id => id !== taskId)
  }

  /** 重试任务 */
  retry(taskId: number): void {
    // 若任务正在运行，标记为已取代（防止旧执行器的回调影响新执行器）
    const executor = this.executors.get(taskId)
    if (executor) {
      executor.markSuperseded()
      this.executors.delete(taskId)
      if (this.runningCount > 0) this.runningCount--
    }
    // 从队列中移除旧记录（如有）
    this.queue = this.queue.filter(id => id !== taskId)

    updateTaskStatus(taskId, 'pending')
    this.queue.push(taskId)
    this.scheduleNext()
    taskLog(taskId, 'info', '任务已重新入队')
  }

  /** 停止所有任务 */
  stopAll(): void {
    this.queue = []
    this.executors.forEach(executor => executor.terminate())
    taskLog(null, 'warn', '已停止所有任务')
  }

  /** 调度下一个任务（并发控制） */
  private scheduleNext(): void {
    const maxConcurrency = getSettings().task.maxConcurrency
    while (this.runningCount < maxConcurrency && this.queue.length > 0) {
      const taskId = this.queue.shift()!
      void this.runTask(taskId)
    }
  }

  /** 执行任务 */
  private async runTask(taskId: number): Promise<void> {
    const task = getTask(taskId)
    if (!task) return

    this.runningCount++
    updateTaskStatus(taskId, 'running')
    pushEvent('task:statusChange', { taskId, status: 'running' })
    taskLog(taskId, 'info', '任务开始执行')

    const executor = new TaskExecutor(task, (id) => this.onTaskComplete(id))
    this.executors.set(taskId, executor)

    try {
      await executor.run()
    } catch (e) {
      log.error(`任务 ${taskId} 执行异常:`, e)
    }
  }

  /** 任务完成回调 */
  private onTaskComplete(taskId: number): void {
    if (!this.executors.has(taskId)) return // 防止重复调用
    this.executors.delete(taskId)
    this.runningCount--
    taskLog(taskId, 'info', '任务执行结束')

    // 间隔后调度下一个
    const interval = getSettings().task.taskInterval * 1000
    if (this.queue.length > 0) {
      setTimeout(() => this.scheduleNext(), interval)
    } else {
      // 队列空，检查是否批量完成
      if (this.runningCount === 0) {
        this.emitBatchComplete()
        // 所有任务结束，启动浏览器空闲休眠倒计时
        BrowserManager.getInstance().scheduleIdleCheck()
      }
    }
  }

  /** 推送批量完成通知 */
  private emitBatchComplete(): void {
    const stats = getDashboardStats()
    pushEvent('task:batchComplete', {
      total: stats.totalToday,
      success: stats.todaySuccess,
      failed: stats.todayFailed,
      revenue: stats.estimatedRevenue
    })
  }
}

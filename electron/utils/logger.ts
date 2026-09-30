import log from 'electron-log'
import { insertLog } from '../db/repository'
import type { LogLevel, ExceptionLevel } from '../../shared/types'
import { pushEvent } from '../ipc'

/**
 * 统一日志工具
 * 同时写入：electron-log 文件 + SQLite 数据库 + 推送前端事件
 */
export function taskLog(
  taskId: number | null,
  level: LogLevel,
  message: string,
  options?: { screenshotPath?: string; exceptionLevel?: ExceptionLevel }
) {
  // 1. 写入 electron-log 文件
  const prefix = taskId ? `[任务${taskId}]` : '[系统]'
  const logFn = level === 'error' ? log.error : level === 'warn' ? log.warn : level === 'debug' ? log.debug : log.info
  logFn(`${prefix} ${message}`)

  // 2. 写入数据库
  try {
    insertLog({ taskId, level, message, screenshotPath: options?.screenshotPath, exceptionLevel: options?.exceptionLevel })
  } catch (e) {
    log.error('日志写入数据库失败:', e)
  }

  // 3. 推送前端
  pushEvent('task:log', { taskId: taskId ?? 0, level, message, screenshotPath: options?.screenshotPath })
}

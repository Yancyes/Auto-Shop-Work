import log from 'electron-log'
import { insertLog } from '../db/repository'
import type { LogLevel, ExceptionLevel } from '../../shared/types'

/**
 * 统一日志工具
 * 同时写入：electron-log 文件 + SQLite 数据库
 */
export function scriptLog(
  scriptId: number | null,
  level: LogLevel,
  message: string,
  options?: { screenshotPath?: string; exceptionLevel?: ExceptionLevel }
) {
  const prefix = scriptId ? `[脚本${scriptId}]` : '[系统]'
  const logFn = level === 'error' ? log.error : level === 'warn' ? log.warn : level === 'debug' ? log.debug : log.info
  logFn(`${prefix} ${message}`)

  try {
    insertLog({ scriptId, level, message, screenshotPath: options?.screenshotPath, exceptionLevel: options?.exceptionLevel })
  } catch (e) {
    log.error('日志写入数据库失败:', e)
  }
}

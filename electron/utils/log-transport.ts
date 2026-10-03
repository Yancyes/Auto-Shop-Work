/**
 * 让 electron-log 的落盘位置跟随设置项 storage.logDir。
 * 启动时应用一次，保存设置后再应用一次，改目录无需重启。
 */
import { app } from 'electron'
import log from 'electron-log'
import { join } from 'node:path'
import { getSettings } from '../config'

const LOG_FILE = 'main.log'

export function applyLogDir(): void {
  const configured = (getSettings().storage?.logDir ?? '').trim()
  const dir = configured || join(app.getPath('userData'), 'logs')
  log.transports.file.level = 'info'
  log.transports.console.level = 'debug'
  log.transports.file.resolvePathFn = () => join(dir, LOG_FILE)
}

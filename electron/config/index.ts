import Store from 'electron-store'
import type { SystemSettings } from '../../shared/types'
import { app } from 'electron'
import { join } from 'node:path'

const store = new Store<SystemSettings>()

/** 默认系统配置 */
const defaultSettings: SystemSettings = {
  browser: {
    headless: false,
    viewport: { width: 1440, height: 900 },
    timeout: 30000
  },
  antiDetection: {
    enabled: true,
    typingDelay: true,
    mouseTrace: true,
    randomDelay: true
  },
  notification: {
    soundEnabled: true,
    manualIntervention: true,
    taskComplete: true
  },
  storage: {
    screenshotDir: join(app.getPath('userData'), 'screenshots'),
    logDir: join(app.getPath('userData'), 'logs')
  },
  task: {
    maxConcurrency: 2,
    taskInterval: 5,
    retryCount: 3
  }
}

let initialized = false

/** 初始化配置，首次运行写入默认值 */
export function initConfig() {
  if (initialized) return
  if (!store.size) {
    store.store = defaultSettings
  }
  initialized = true
}

/** 获取完整配置 */
export function getSettings(): SystemSettings {
  return { ...defaultSettings, ...store.store }
}

/** 更新配置（部分更新） */
export function saveSettings(partial: Partial<SystemSettings>): SystemSettings {
  const current = getSettings()
  const merged: SystemSettings = {
    browser: { ...current.browser, ...(partial.browser ?? {}) },
    antiDetection: { ...current.antiDetection, ...(partial.antiDetection ?? {}) },
    notification: { ...current.notification, ...(partial.notification ?? {}) },
    storage: { ...current.storage, ...(partial.storage ?? {}) },
    task: { ...current.task, ...(partial.task ?? {}) }
  }
  store.store = merged
  return merged
}

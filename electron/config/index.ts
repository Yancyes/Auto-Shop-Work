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
  script: {
    maxConcurrency: 1,
    runInterval: 3,
    retryCount: 3,
    hudEnabled: true
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

/** 获取完整配置
 *
 * 逐段合并：老版本存档缺少的新字段（如 script.hudEnabled）会用默认值补齐。
 * 若只展开顶层，存过的 script 段会整体覆盖默认段，新增字段变成 undefined。
 */
export function getSettings(): SystemSettings {
  const stored = store.store
  return {
    browser: { ...defaultSettings.browser, ...stored.browser },
    antiDetection: { ...defaultSettings.antiDetection, ...stored.antiDetection },
    notification: { ...defaultSettings.notification, ...stored.notification },
    storage: { ...defaultSettings.storage, ...stored.storage },
    script: { ...defaultSettings.script, ...stored.script }
  }
}

/** 更新配置（部分更新） */
export function saveSettings(partial: Partial<SystemSettings>): SystemSettings {
  const current = getSettings()
  const merged: SystemSettings = {
    browser: { ...current.browser, ...(partial.browser ?? {}) },
    antiDetection: { ...current.antiDetection, ...(partial.antiDetection ?? {}) },
    notification: { ...current.notification, ...(partial.notification ?? {}) },
    storage: { ...current.storage, ...(partial.storage ?? {}) },
    script: { ...current.script, ...(partial.script ?? {}) }
  }
  store.store = merged
  return merged
}

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import log from 'electron-log'
import type { SystemSettings } from '../../shared/types'

/**
 * 设置存储：直接读写 userData/config.json。
 * 之前用 electron-store，它会把 conf + ajv（合计约 190ms 加载、打包后是 main.js 的最大块）
 * 一起拽进启动关键路径，而我们并没有用到它的 schema 校验。
 * 文件名与 electron-store 的默认值保持一致，老用户的设置不会丢。
 */
function settingsFile(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** 默认系统配置（userData 路径要在 app ready 之后取，所以首次调用才算） */
let cachedDefaults: SystemSettings | null = null
function defaultSettings(): SystemSettings {
  if (!cachedDefaults) {
    cachedDefaults = {
      browser: {
        headless: false,
        viewport: { width: 1440, height: 900 },
        timeout: 30000,
        executablePath: ''
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
        logDir: join(app.getPath('userData'), 'logs')
      },
      script: {
        maxConcurrency: 1,
        runInterval: 3,
        retryCount: 3,
        hudEnabled: true
      }
    }
  }
  return cachedDefaults
}

function readStored(): Partial<SystemSettings> {
  const file = settingsFile()
  if (!existsSync(file)) return {}
  try {
    const raw = readFileSync(file, 'utf8').trim()
    return raw ? JSON.parse(raw) : {}
  } catch (e) {
    // 存档损坏时不能让应用起不来：退回默认配置，坏文件留给用户排查
    log.error(`[config] 读取 ${file} 失败，使用默认配置:`, e)
    return {}
  }
}

let stored: Partial<SystemSettings> | null = null

/** 初始化配置，首次运行写入默认值 */
export function initConfig() {
  if (stored) return
  stored = readStored()
  if (!Object.keys(stored).length) persist(defaultSettings())
}

function load(): Partial<SystemSettings> {
  if (!stored) {
    stored = readStored()
  }
  return stored
}

function persist(settings: SystemSettings) {
  const file = settingsFile()
  mkdirSync(dirname(file), { recursive: true })
  // 先写临时文件再改名：避免写到一半崩溃留下半个 JSON
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8')
  renameSync(tmp, file)
  stored = settings
}

/** 获取完整配置
 *
 * 逐段合并：老版本存档缺少的新字段（如 script.hudEnabled）会用默认值补齐。
 * 若只展开顶层，存过的 script 段会整体覆盖默认段，新增字段变成 undefined。
 */
export function getSettings(): SystemSettings {
  const s = load()
  const d = defaultSettings()
  return {
    browser: { ...d.browser, ...s.browser },
    antiDetection: { ...d.antiDetection, ...s.antiDetection },
    notification: { ...d.notification, ...s.notification },
    storage: { ...d.storage, ...s.storage },
    script: { ...d.script, ...s.script }
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
  persist(merged)
  return merged
}

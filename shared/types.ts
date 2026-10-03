/**
 * 全局共享类型定义
 * 主进程与渲染进程共用的类型契约
 */

/** 录制动作类型 */
export type RecordedAction = 'click' | 'dblclick' | 'fill' | 'select' | 'keypress' | 'scroll' | 'navigate' | 'wait'

/** 录制的操作步骤 */
export interface RecordedStep {
  id: number
  action: RecordedAction
  selector: string
  value?: string
  description?: string
  tagName?: string
  elementText?: string
  delayBefore?: number
}

/** 录制的脚本 */
export interface RecordedScript {
  id: number
  name: string
  description?: string
  targetUrl: string
  stepsJson: string
  runCount: number
  status: 'draft' | 'ready' | 'running' | 'completed' | 'failed'
  createdAt: string
  updatedAt: string
}

/** 脚本执行进度 */
export interface ScriptProgress {
  scriptId: number
  currentRun: number
  totalRuns: number
  stepIndex: number
  totalSteps: number
  /** 当前步骤描述（elementText/description/selector） */
  stepDescription?: string
  /** 当前步骤开始时间戳（ms） */
  stepStartedAt?: number
  /** 脚本是否处于暂停态 */
  paused?: boolean
}

/** 执行浮窗（HUD）展示的状态 */
export interface HudState {
  scriptId: number
  scriptName: string
  currentRun: number
  /** -1 表示无限循环 */
  totalRuns: number
  /** -1 表示不在具体步骤（启动中 / 轮次间隔） */
  stepIndex: number
  totalSteps: number
  stepDescription?: string
  stepStartedAt?: number
  paused: boolean
}

/** 日志级别 */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

/** 异常等级 */
export type ExceptionLevel = 'light' | 'medium' | 'heavy' | 'manual'

/** 运行日志 */
export interface RunLog {
  id: number
  scriptId: number | null
  level: LogLevel
  message: string
  exceptionLevel?: ExceptionLevel
  createdAt: string
}

/** 主进程探测到的执行浏览器来源 */
export interface BrowserDetectResult {
  source: 'custom' | 'bundled' | 'system' | 'none'
  /** 为空表示使用 Playwright 随包自带的 Chromium */
  executablePath?: string
  /** 没有可用浏览器时的提示文案 */
  problem?: string
}

/** 反检测开关：enabled 是总开关，子项各自控制一种模拟行为 */
export interface AntiDetectionSettings {
  enabled: boolean
  /** 逐字输入（模拟真人打字速度） */
  typingDelay: boolean
  /** 鼠标移动走轨迹而不是瞬移 */
  mouseTrace: boolean
  /** 步骤间隔与轨迹加入随机抖动 */
  randomDelay: boolean
}

/** 系统设置 */
export interface SystemSettings {
  browser: {
    headless: boolean
    viewport: { width: number; height: number }
    timeout: number
    /** 手动指定的浏览器可执行文件；空字符串表示自动探测 */
    executablePath: string
  }
  antiDetection: AntiDetectionSettings
  notification: {
    soundEnabled: boolean
    manualIntervention: boolean
    taskComplete: boolean
  }
  storage: {
    /** electron-log 的日志目录 */
    logDir: string
  }
  script: {
    /** 同时执行的脚本数（1..5），排队中的任务按空位派发 */
    maxConcurrency: number
    runInterval: number
    /** 单个步骤失败后的重试次数（不含首次执行） */
    retryCount: number
    /** 在执行浏览器上显示实时进度浮窗 */
    hudEnabled: boolean
  }
}

/** IPC 请求-响应通用包装 */
export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 自动更新状态 */
export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/** 自动更新状态快照 */
export interface UpdaterState {
  status: UpdaterStatus
  currentVersion: string
  availableVersion?: string
  releaseDate?: string
  releaseNotes?: string
  progress?: {
    percent: number
    transferred: number
    total: number
    bytesPerSecond: number
  }
  error?: string
}

/** 主进程推送给渲染进程的更新事件 */
export type UpdaterEvent =
  /** 状态跃迁：携带完整快照 */
  | { type: 'state-change'; state: UpdaterState }
  /** 下载进度：高频但轻量，仅带进度，避免每 tick 重传长文本/版本字段 */
  | { type: 'progress'; progress: NonNullable<UpdaterState['progress']> }

/** 一条历史版本更新记录（来自 GitHub Releases） */
export interface ChangelogEntry {
  version: string
  date: string
  notes: string
}

/** IPC 通信通道契约 */
export interface IpcChannels {
  'script:list': () => IpcResponse<RecordedScript[]>
  'script:save': (script: Partial<RecordedScript>) => IpcResponse<RecordedScript>
  'script:delete': (id: number) => IpcResponse<boolean>
  'script:run': (id: number, count: number) => IpcResponse<boolean>
  'script:pause': (id: number) => IpcResponse<boolean>
  'script:resume': (id: number) => IpcResponse<boolean>
  'script:terminate': (id: number) => IpcResponse<boolean>
  'script:stopAll': () => IpcResponse<boolean>
  'log:list': (filter?: { level?: LogLevel; scriptId?: number; startTime?: string; endTime?: string }) => IpcResponse<RunLog[]>
  'log:delete': (id: number) => IpcResponse<boolean>
  'log:clear': () => IpcResponse<boolean>
  'settings:get': () => IpcResponse<SystemSettings>
  'settings:save': (settings: Partial<SystemSettings>) => IpcResponse<SystemSettings>
  'browser:detect': (executablePath?: string) => IpcResponse<BrowserDetectResult>
  'dialog:pickBrowser': () => IpcResponse<string | null>
  'updater:state': () => IpcResponse<UpdaterState>
  'updater:check': () => IpcResponse<UpdaterState>
  'updater:check-throttled': () => IpcResponse<UpdaterState>
  'updater:download': () => IpcResponse<boolean>
  'updater:install': () => IpcResponse<boolean>
  'feedback:send': (feedback: { content: string; contact?: string }) => IpcResponse<boolean>
  'changelog:list': () => IpcResponse<ChangelogEntry[]>
}

/** 主进程推送到渲染进程的事件通道 */
export interface IpcEventChannels {
  'script:progress': (data: ScriptProgress) => void
  'script:complete': (data: { scriptId: number; success: boolean; message: string }) => void
  'script:stepError': (data: { scriptId: number; stepIndex: number; error: string }) => void
  'updater:event': (data: UpdaterEvent) => void
}

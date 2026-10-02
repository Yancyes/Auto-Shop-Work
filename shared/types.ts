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
  relativeX?: number
  relativeY?: number
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
  screenshotPath?: string
  exceptionLevel?: ExceptionLevel
  createdAt: string
}

/** 系统设置 */
export interface SystemSettings {
  browser: {
    headless: boolean
    viewport: { width: number; height: number }
    timeout: number
  }
  antiDetection: {
    enabled: boolean
    typingDelay: boolean
    mouseTrace: boolean
    randomDelay: boolean
  }
  notification: {
    soundEnabled: boolean
    manualIntervention: boolean
    taskComplete: boolean
  }
  storage: {
    screenshotDir: string
    logDir: string
  }
  script: {
    maxConcurrency: number
    runInterval: number
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

/** IPC 通信通道契约 */
export interface IpcChannels {
  'script:list': () => IpcResponse<RecordedScript[]>
  'script:get': (id: number) => IpcResponse<RecordedScript | null>
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
  'updater:state': () => IpcResponse<UpdaterState>
  'updater:check': () => IpcResponse<UpdaterState>
  'updater:check-throttled': () => IpcResponse<UpdaterState>
  'updater:download': () => IpcResponse<boolean>
  'updater:install': () => IpcResponse<boolean>
  'feedback:send': (feedback: { content: string; contact?: string }) => IpcResponse<boolean>
}

/** 主进程推送到渲染进程的事件通道 */
export interface IpcEventChannels {
  'script:progress': (data: ScriptProgress) => void
  'script:complete': (data: { scriptId: number; success: boolean; message: string }) => void
  'script:stepError': (data: { scriptId: number; stepIndex: number; error: string }) => void
  'updater:event': (data: UpdaterEvent) => void
}

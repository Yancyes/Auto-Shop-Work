/**
 * 全局共享类型定义
 * 主进程与渲染进程共用的类型契约
 */

/** 录制动作类型 */
export type RecordedAction =
  | 'click'
  | 'dblclick'
  | 'fill'
  | 'select'
  | 'keypress'
  | 'scroll'
  | 'navigate'
  | 'wait'
  /** 刷新受控页面：value 为「随机刷新秒数下限-上限」，到点前不刷新 */
  | 'refresh'
  /** 挂一个屏幕区域监控（value 为 monitor id） */
  | 'watch'

/** 屏幕上的矩形区域（DIP 坐标，与 Electron display.bounds 同一坐标系） */
export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 监控取数来源：
 * - screen：抓屏幕区域像素做分块差异，不依赖网页结构，任何窗口都适用
 * - page：读受控页面文本做关键词命中，准确但要 DOM 可用
 * - auto：两者都跑，任一命中即算变化
 */
export type MonitorSourceKind = 'screen' | 'page' | 'auto'

/** 一条屏幕区域监控（一个脚本可挂多条，各自独立判定） */
export interface RegionMonitor {
  id: string
  label: string
  /** 屏幕矩形；page 来源时用于截图定位，可不填 */
  rect?: ScreenRect
  source: MonitorSourceKind
  /**
   * 关键词规则。appear=出现即命中，disappear=消失即命中，
   * 只对 page/auto 来源生效（屏幕像素里没有文字可认，除非引入 OCR）
   */
  appear?: string[]
  disappear?: string[]
  /** 变化块占比命中阈值，0..1 */
  hitRatio?: number
  /** 轮询间隔 ms */
  intervalMs?: number
  /** 命中后动作：暂停等用户接管，或只记日志继续 */
  onChange?: 'pause' | 'log'
  /** 基准图（PNG）在本地的相对文件名；空表示还没有基准图 */
  baselineFile?: string
}

/** 一条监控的实时状态（推给界面画热区用） */
export interface MonitorStatus {
  monitorId: string
  label: string
  /** 最近一次差异块占比 */
  ratio: number
  hit: boolean
  /** 差异热区：行优先位图，尺寸见 blocksX/blocksY */
  blocks?: number[]
  blocksX?: number
  blocksY?: number
  appeared?: string[]
  disappeared?: string[]
  /** 当前帧 PNG dataURL，界面显示「现在长这样」 */
  snapshot?: string
  /** 这一轮没能按全部设定判定时的说明；有值就不要再把结果当「一切正常」展示 */
  note?: string
  checkedAt: number
}

/** 监控命中、等待用户接管的事件负载 */
export interface MonitorHit {
  scriptId: number
  monitorId: string
  label: string
  ratio: number
  appeared: string[]
  disappeared: string[]
  snapshot?: string
  /** 差异热区：接管卡片要直接画出「变的是哪一块」，不能只给用户一句文案 */
  blocks?: number[]
  blocksX?: number
  blocksY?: number
  at: number
}

/** 录制的操作步骤 */
export interface RecordedStep {
  id: number
  action: RecordedAction
  selector: string
  value?: string
  description?: string
  tagName?: string
  elementText?: string
  /** 本步执行完到下一步的等待（ms）；未设置按 DEFAULT_STEP_DELAY */
  delayBefore?: number
}

/** 脚本的自定义数据表：列为变量名，每行数据对应一轮执行 */
export interface ScriptDataSheet {
  columns: string[]
  rows: string[][]
}

/** 录制的脚本 */
export interface RecordedScript {
  id: number
  name: string
  description?: string
  targetUrl: string
  stepsJson: string
  /** 数据表 JSON（ScriptDataSheet）；空串表示没有自定义数据 */
  dataJson: string
  /** 屏幕区域监控 JSON（RegionMonitor[]）；空串表示没有监控 */
  monitorJson: string
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
  /** 因监控命中而等待用户接管 */
  takeover?: boolean
}

/**
 * 主窗口形态：
 * - normal 完整界面
 * - mini 收起成置顶迷你控制窗（录制/执行期间只留操作按钮，可以拖到屏幕任意位置）
 */
export type WindowMode = 'normal' | 'mini'

/** 迷你控制窗的状态（由主进程注入，界面只负责显示） */
export interface MiniControlState {
  mode: WindowMode
  phase: 'idle' | 'recording' | 'running'
  /** 当前在做什么：脚本名或「录制中」 */
  title: string
  /** 当前步骤文本 */
  stepText?: string
  /** 步骤进度，total 为 -1 表示无限轮次 */
  stepIndex: number
  totalSteps: number
  paused: boolean
  /** 等待接管（监控命中） */
  takeover: boolean
  /** 各监控项的命中摘要 */
  monitors: { id: string; label: string; hit: boolean; ratio: number }[]
}

/** 一次区域抓帧结果（位图字节留在主进程，只把 PNG 与尺寸给渲染层） */
export interface RegionFrame {
  width: number
  height: number
  /** PNG dataURL，可直接放进 <img> */
  png: string
  /** 抓帧时间戳 */
  at: number
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

/** 显示器信息（不含图片，供界面换算坐标） */
export interface DisplayInfo {
  id: number
  bounds: ScreenRect
  scaleFactor: number
}

/** 接管监控命中后的处理动作 */
export type TakeoverAction = 'resume' | 'skip' | 'abort'

/**
 * 迷你控制窗上的按钮。目标脚本与录制状态由主进程记住，
 * 页面只发「按了哪个钮」，不必知道 scriptId，也就不怕界面被改坏
 */
export type MiniWindowAction =
  | 'stopRecord'
  | 'restore'
  | 'pause'
  | 'resume'
  | 'skipStep'
  | 'terminate'

/** IPC 通信通道契约 */
export interface IpcChannels {
  'script:list': () => IpcResponse<RecordedScript[]>
  'script:save': (script: Partial<RecordedScript>) => IpcResponse<RecordedScript>
  'script:delete': (id: number) => IpcResponse<boolean>
  'script:run': (id: number, count: number, defaults?: Record<string, string>) => IpcResponse<boolean>
  'script:pause': (id: number) => IpcResponse<boolean>
  'script:resume': (id: number) => IpcResponse<boolean>
  'script:terminate': (id: number) => IpcResponse<boolean>
  'script:stopAll': () => IpcResponse<boolean>
  /** 执行中热改步骤：当前步跑完就按新列表继续 */
  'script:steps:update': (id: number, steps: RecordedStep[]) => IpcResponse<boolean>
  /** 跳过当前步（含因监控命中而暂停时） */
  'script:step:skip': (id: number) => IpcResponse<boolean>
  /** 退回上一步重做 */
  'script:step:back': (id: number) => IpcResponse<boolean>
  /** 监控命中的接管处理 */
  'script:takeover': (id: number, action: TakeoverAction) => IpcResponse<boolean>
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
  /** 主窗口在「完整界面」与「迷你控制窗」之间切换 */
  'window:setMode': (mode: WindowMode) => IpcResponse<WindowMode>
  'window:getMode': () => IpcResponse<WindowMode>
  /** 迷你控制窗上的按钮：目标脚本由主进程记住，页面不必知道 scriptId */
  'mini:command': (cmd: MiniWindowAction) => IpcResponse<boolean>
  /** 打开全屏框选遮罩，等用户拖出一个区域；取消返回 null */
  'region:pick': () => IpcResponse<ScreenRect | null>
  'region:displays': () => IpcResponse<DisplayInfo[]>
  /** 遮罩上拖完一条：局部坐标 + 显示器序号，由主进程换算成虚拟桌面坐标 */
  'overlay:select': (payload: { displayIndex: number; rect: ScreenRect }) => IpcResponse<boolean>
  'overlay:cancel': () => IpcResponse<boolean>
  /** 立即抓一块区域（预览 / 取基准图） */
  'monitor:snapshot': (rect: ScreenRect) => IpcResponse<RegionFrame>
  /** 把当前区域存成某监控项的基准图 */
  'monitor:baseline:save': (monitorId: string, rect: ScreenRect) => IpcResponse<string>
  /** 用界面选好的本地图片当基准图（不框选、直接拿一张参照图跑比对）；解码失败返回 null */
  'monitor:baseline:upload': (monitorId: string, pngDataUrl: string) => IpcResponse<string | null>
  'monitor:baseline:read': (monitorId: string) => IpcResponse<RegionFrame | null>
  /** 立刻按当前设置比对一次，让用户在保存前看到会不会命中 */
  'monitor:probe': (monitor: RegionMonitor) => IpcResponse<MonitorStatus>
  'script:monitors:save': (id: number, monitors: RegionMonitor[]) => IpcResponse<RecordedScript>
  /** 屏幕轨录制：在受控浏览器里注入采集脚本，步骤由主进程实时推回界面 */
  'record:start': (targetUrl: string) => IpcResponse<boolean>
  'record:stop': () => IpcResponse<boolean>
  'record:status': () => IpcResponse<boolean>
}

/** 主进程推送到渲染进程的事件通道 */
export interface IpcEventChannels {
  'script:progress': (data: ScriptProgress) => void
  'script:complete': (data: { scriptId: number; success: boolean; message: string }) => void
  'script:stepError': (data: { scriptId: number; stepIndex: number; error: string }) => void
  'updater:event': (data: UpdaterEvent) => void
  /** 监控巡检结果（每轮一条，含各区域热区） */
  'monitor:status': (data: { scriptId: number; statuses: MonitorStatus[] }) => void
  /** 监控命中，脚本已暂停等待接管 */
  'monitor:hit': (data: MonitorHit) => void
  'window:mode': (data: WindowMode) => void
  /** 屏幕轨实时录到的步骤 */
  'record:step': (data: RecordedStep) => void
  'record:state': (data: { recording: boolean }) => void
}

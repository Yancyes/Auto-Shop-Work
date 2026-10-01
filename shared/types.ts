/**
 * 全局共享类型定义
 * 主进程与渲染进程共用的类型契约
 */

/** 任务状态枚举 */
export type TaskStatus = 'pending' | 'running' | 'paused' | 'success' | 'failed' | 'waiting_manual'

/** 任务执行步骤枚举 */
export type TaskStep =
  | 'init'
  | 'page_load'
  | 'fill_product'
  | 'set_attributes'
  | 'pre_validate'
  | 'submit'
  | 'manual_handle'
  | 'result'

/** 日志级别 */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

/** 异常等级 */
export type ExceptionLevel = 'light' | 'medium' | 'heavy' | 'manual'

/** 元素拾取信息 */
export interface ElementInfo {
  index: number
  selector: string
  tag: string
  text: string
  x: number
  y: number
  width: number
  height: number
}

/** 商品模板配置 - 完整上架参数 */
export interface ProductTemplate {
  id: number
  name: string
  /** 商品数量 */
  quantity: number
  /** 单位（如：万金、个） */
  unit: string
  /** 单价（元） */
  unitPrice: number
  /** 发布件数 */
  publishCount: number
  /** 联系电话模式：1=平台代发联系电话 2=自定义手机号 */
  contactMode: 1 | 2
  /** 自定义手机号（contactMode=2 时使用） */
  phone?: string
  /** 包赔类型 */
  compensationType: string
  /** 交易时间段 */
  tradeTimeRange: string
  /** 资金到账方式 */
  fundSettlement: string
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

/** 任务记录 */
export interface TaskRecord {
  id: number
  /** 关联模板 ID */
  templateId: number
  /** 商品名称（模板快照） */
  productName: string
  /** 规格（数量+单位） */
  spec: string
  /** 单价 */
  unitPrice: number
  /** 任务状态 */
  status: TaskStatus
  /** 当前进度（0-100） */
  progress: number
  /** 当前执行步骤 */
  currentStep: TaskStep | null
  /** 模板参数快照（JSON） */
  paramsSnapshot: string
  /** 失败原因 */
  failReason?: string
  /** 结果截图路径 */
  resultScreenshot?: string
  /** 创建时间 */
  createdAt: string
  /** 完成时间 */
  completedAt?: string
}

/** 运行日志 */
export interface RunLog {
  id: number
  /** 关联任务 ID */
  taskId: number | null
  /** 日志级别 */
  level: LogLevel
  /** 日志内容 */
  message: string
  /** 截图路径 */
  screenshotPath?: string
  /** 异常等级 */
  exceptionLevel?: ExceptionLevel
  /** 时间戳 */
  createdAt: string
}

/** 仪表盘统计 */
export interface DashboardStats {
  todaySuccess: number
  todayFailed: number
  totalToday: number
  successRate: number
  estimatedRevenue: number
  runningCount: number
}

/** 实时进度步骤 */
export interface ProgressStep {
  step: TaskStep
  label: string
  status: 'wait' | 'process' | 'finish' | 'error'
  duration?: number
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
  task: {
    maxConcurrency: number
    taskInterval: number
    retryCount: number
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
  /** 版本发布时间 */
  releaseDate?: string
  /** 更新公告/日志 */
  releaseNotes?: string
  /** 下载进度（下载中） */
  progress?: {
    percent: number
    transferred: number
    total: number
    bytesPerSecond: number
  }
  /** 错误信息（status=error） */
  error?: string
}

/** 主进程推送给渲染进程的更新事件 */
export interface UpdaterEvent {
  type: 'state-change'
  state: UpdaterState
}

/** IPC 通信通道契约 */
export interface IpcChannels {
  'template:list': () => IpcResponse<ProductTemplate[]>
  'template:get': (id: number) => IpcResponse<ProductTemplate | null>
  'template:save': (template: Partial<ProductTemplate>) => IpcResponse<ProductTemplate>
  'template:delete': (id: number) => IpcResponse<boolean>
  'task:create': (templateId: number, count: number) => IpcResponse<TaskRecord[]>
  'task:list': (filter?: { status?: TaskStatus; keyword?: string }) => IpcResponse<TaskRecord[]>
  'task:start': (id: number) => IpcResponse<boolean>
  'task:pause': (id: number) => IpcResponse<boolean>
  'task:terminate': (id: number) => IpcResponse<boolean>
  'task:retry': (id: number) => IpcResponse<boolean>
  'task:startBatch': (ids: number[]) => IpcResponse<boolean>
  'task:pauseBatch': (ids: number[]) => IpcResponse<boolean>
  'task:terminateBatch': (ids: number[]) => IpcResponse<boolean>
  'task:stopAll': () => IpcResponse<boolean>
  'task:delete': (id: number) => IpcResponse<boolean>
  'task:deleteBatch': (ids: number[]) => IpcResponse<boolean>
  'task:detail': (id: number) => IpcResponse<TaskRecord | null>
  'log:list': (filter?: { level?: LogLevel; taskId?: number; startTime?: string; endTime?: string }) => IpcResponse<RunLog[]>
  'log:delete': (id: number) => IpcResponse<boolean>
  'log:clear': () => IpcResponse<boolean>
  'settings:get': () => IpcResponse<SystemSettings>
  'settings:save': (settings: Partial<SystemSettings>) => IpcResponse<SystemSettings>
  'dashboard:stats': () => IpcResponse<DashboardStats>
  'browser:ensureLogin': () => IpcResponse<boolean>
  'browser:getPages': () => IpcResponse<Array<{ id: string; url: string; title: string }>>
  'browser:screenshot': (pageIndex: number) => IpcResponse<string | null>
  'browser:execute': (pageIndex: number, action: string, params: any) => IpcResponse<any>
  'browser:pickElements': (pageIndex: number) => IpcResponse<{ screenshot: string; elements: ElementInfo[] }>
  'browser:pickClick': (pageIndex: number, index: number) => IpcResponse<boolean>
  'browser:pickExit': (pageIndex: number) => IpcResponse<boolean>
  'updater:state': () => IpcResponse<UpdaterState>
  'updater:check': () => IpcResponse<UpdaterState>
  'updater:download': () => IpcResponse<boolean>
  'updater:install': () => IpcResponse<boolean>
  'feedback:send': (feedback: { content: string; contact?: string }) => IpcResponse<boolean>
}

/** 主进程推送到渲染进程的事件通道 */
export interface IpcEventChannels {
  'task:progress': (data: { taskId: number; progress: number; step: TaskStep }) => void
  'task:statusChange': (data: { taskId: number; status: TaskStatus; failReason?: string }) => void
  'task:log': (data: { taskId: number; level: LogLevel; message: string; screenshotPath?: string }) => void
  'task:manualRequired': (data: { taskId: number; reason: string; screenshotPath: string }) => void
  'task:screenshot': (data: { taskId: number; step: TaskStep; screenshotPath: string }) => void
  'task:batchComplete': (data: { total: number; success: number; failed: number; revenue: number }) => void
  'updater:event': (data: UpdaterEvent) => void
}

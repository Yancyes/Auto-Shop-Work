/**
 * 自动更新模块
 * 基于 electron-updater（electron-builder 官方生态），配合 NSIS 目标使用。
 * - 生产环境（app.isPackaged）下生效，开发模式自动禁用
 * - 界面显示后延迟检查一次，之后每 10 分钟自动轮询
 * - 用户操作可触发检查（节流1分钟），发现新版本后自动下载
 */
import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { pushEvent } from './ipc'
import { installGitHubProxy, markProxyFallback, resetProxyFallback } from './services/github-proxy'
import type { UpdaterState, UpdaterEvent } from '../shared/types'

/** 不静态 import electron-updater：它连带 builder-util-runtime，加载约 150ms，属于启动关键路径 */
type AutoUpdater = typeof import('electron-updater')['autoUpdater']

const CHECK_INTERVAL = 10 * 60 * 1000
const THROTTLE_INTERVAL = 60 * 1000
/** 首屏显示后再发起首次检查 */
const FIRST_CHECK_DELAY = 5000
/** 后台检查失败后的补试间隔与次数（抗住偶发 DNS / 网络抖动，不必等下一轮 10 分钟） */
const AUTO_RETRY_DELAY = 60 * 1000
const MAX_AUTO_RETRIES = 2
/** 用户主动检查时，第一次失败的即时补试延迟 */
const MANUAL_RETRY_DELAY = 1500

let state: UpdaterState = {
  status: 'idle',
  currentVersion: app.getVersion()
}

let updaterInstance: AutoUpdater | null = null
let loadingPromise: Promise<AutoUpdater> | null = null
let checkTimer: ReturnType<typeof setInterval> | null = null
let lastCheckTime = 0
let isDownloading = false
/** 是否正在执行 quitAndInstall。main.ts 的 before-quit 用它放行安装流程 */
let installingUpdate = false
/** 最近一次更新操作是否由用户主动发起：后台轮询的网络抖动不应该弹给用户 */
let lastActionManual = false
/**
 * 是否有 await 中的检查/下载：其间 electron-updater 抛的 error 事件先记下，
 * 由调用方决定怎么呈现，避免「失败提示」在自动补试成功前就闪给用户。
 */
let errorFromInFlightCall = false
/** 在途调用期间收到的最后一条错误信息（部分失败只发事件、不 reject） */
let inFlightError: string | null = null
let autoRetryCount = 0
let autoRetryTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 把 Chromium / Node 的网络错误码翻译成用户能看懂的话，末尾保留原始码便于截图反馈。
 * 未命中的错误原样返回：更新服务器返回的业务错误本身就有意义。
 */
function friendlyUpdateError(raw: string): string {
  const code = raw.match(/net::[A-Z_]+/i)?.[0]
  const suffix = code ? `（${code}）` : ''
  if (/ERR_NAME_NOT_RESOLVED|ERR_DNS/i.test(raw)) return `无法解析更新服务器地址，请检查网络后重试${suffix}`
  if (/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|ERR_EMPTY_RESPONSE|ERR_SOCKET_NOT_CONNECTED|ETIMEDOUT|timeout/i.test(raw)) {
    return `连接更新服务器超时，请稍后重试${suffix}`
  }
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_ADDRESS_UNREACHABLE|ERR_CONNECTION_RESET/i.test(raw)) {
    return `当前网络不可用或不稳定，请恢复网络后重试${suffix}`
  }
  if (/ERR_CONNECTION_REFUSED|ERR_PROXY/i.test(raw)) return `网络或代理设置阻止了连接更新服务器${suffix}`
  if (/ERR_CERT|SSL/i.test(raw)) return `更新服务器证书校验失败，请确认网络未被劫持${suffix}`
  if (/Cannot parse|404|Not Found/i.test(raw)) return '更新信息暂时读取不到，请稍后重试'
  return raw
}

/** 下载进度推送节流：高频 progress 只带进度、最多每 250ms 广播一次，避免卡顿 */
const PROGRESS_PUSH_INTERVAL = 250
let lastProgressPush = 0
let pendingProgress: UpdaterState['progress'] | null = null
let progressTimer: ReturnType<typeof setTimeout> | null = null

function pushProgress(p: UpdaterState['progress']) {
  if (!p) return
  const now = Date.now()
  if (now - lastProgressPush >= PROGRESS_PUSH_INTERVAL) {
    lastProgressPush = now
    pushEvent('updater:event', { type: 'progress', progress: p })
  } else {
    pendingProgress = p
    if (!progressTimer) {
      progressTimer = setTimeout(() => {
        progressTimer = null
        if (pendingProgress) {
          lastProgressPush = Date.now()
          pushEvent('updater:event', { type: 'progress', progress: pendingProgress })
          pendingProgress = null
        }
      }, PROGRESS_PUSH_INTERVAL - (now - lastProgressPush))
    }
  }
}

/** 取消待发送的进度，用于下载结束/出错时收敛到最终状态 */
function cancelPendingProgress() {
  if (progressTimer) { clearTimeout(progressTimer); progressTimer = null }
  pendingProgress = null
  lastProgressPush = 0
}

export function isInstallingUpdate(): boolean {
  return installingUpdate
}

/** 是否已下载完成、等待安装（打包环境） */
export function hasPendingUpdate(): boolean {
  return app.isPackaged && state.status === 'downloaded'
}

/**
 * 供 before-quit 收尾调用：用户下载完成后直接关窗口时，后台静默装上、不弹向导、
 * 不强制重启（下次正常打开即为新版本），避免 app.exit 绕过安装导致更新要等下次触发。
 */
export function installPendingUpdateOnQuit(): boolean {
  if (!hasPendingUpdate()) return false
  return quitAndInstall(true, false)
}

/** 更新状态并推送给渲染进程 */
function updateState(patch: Partial<UpdaterState>, silent = false) {
  state = { ...state, ...patch }
  if (!silent) {
    const event: UpdaterEvent = { type: 'state-change', state }
    pushEvent('updater:event', event)
  }
}

function getState(): UpdaterState {
  return state
}

/** 安全提取 releaseNotes */
function extractReleaseNotes(info: { releaseNotes?: string | Array<{ note?: string | null }> | null }): string | undefined {
  if (!info.releaseNotes) return undefined
  if (typeof info.releaseNotes === 'string') return info.releaseNotes
  if (Array.isArray(info.releaseNotes)) {
    return info.releaseNotes.map(n => n?.note ?? '').filter(Boolean).join('\n')
  }
  return undefined
}

/** 首次用到时才加载 electron-updater，之后复用同一实例 */
function getAutoUpdater(): Promise<AutoUpdater> {
  if (updaterInstance) return Promise.resolve(updaterInstance)
  if (!loadingPromise) {
    loadingPromise = import('electron-updater')
      .then(({ autoUpdater }) => {
        // 代理只在更新器真要联网时安装：开发模式走不到这里，启动路径也不碰 net
        if (app.isPackaged) installGitHubProxy()
        autoUpdater.autoDownload = false
        // 关闭内建的退出即装，改由 main.ts 的 before-quit 显式触发 installPendingUpdateOnQuit，
        // 这样既能清理浏览器/数据库，又避免与内建机制双重启动安装器
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.logger = log
        bindUpdaterEvents(autoUpdater)
        updaterInstance = autoUpdater
        return autoUpdater
      })
      .catch(err => {
        // 加载失败要清空，否则一次瞬时错误会被永久缓存
        loadingPromise = null
        throw err
      })
  }
  return loadingPromise
}

/** 事件 → 状态机 */
function bindUpdaterEvents(autoUpdater: AutoUpdater) {
  autoUpdater.on('checking-for-update', () => {
    log.info('[updater] 正在检查更新...')
  })
  autoUpdater.on('update-available', (info) => {
    log.info('[updater] 发现新版本:', info.version)
    resetProxyFallback()
    updateState({
      status: 'available',
      availableVersion: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: extractReleaseNotes(info),
      error: undefined
    })
  })
  autoUpdater.on('update-not-available', () => {
    log.info('[updater] 当前已是最新版本')
    resetProxyFallback()
    updateState({ status: 'not-available', error: undefined })
  })
  autoUpdater.on('download-progress', (progress) => {
    const p = {
      percent: Math.round(progress.percent * 10) / 10,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    }
    // 静默更新内部 state（供 updater:state 查询），只广播节流后的轻量进度
    updateState({ status: 'downloading', progress: p }, true)
    pushProgress(p)
  })
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] 更新下载完成:', info.version)
    cancelPendingProgress()
    updateState({
      status: 'downloaded',
      availableVersion: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: extractReleaseNotes(info),
      progress: { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 },
      error: undefined
    })
  })
  autoUpdater.on('error', (err) => {
    const raw = err?.message || String(err)
    cancelPendingProgress()
    // 直连失败过一次，latest.yml 这类小文件后续也走中转，别反复撞同一面墙
    markProxyFallback()
    if (errorFromInFlightCall) {
      inFlightError = raw
      log.warn('[updater] 检查/下载期间报错，交由调用方处理:', raw)
      return
    }
    if (lastActionManual) {
      log.error('[updater] 更新错误（用户主动触发）:', raw)
      updateState({ status: 'error', error: friendlyUpdateError(raw) })
      return
    }
    log.warn('[updater] 后台更新检查失败，本轮忽略:', raw)
    // 已下载待装的版本不能被一次后台抖动抹掉，否则「重启更新」入口会消失
    if (state.status !== 'downloaded') {
      updateState({ status: 'idle', error: undefined }, true)
    }
  })
}

/** 后台检查失败后补试一次：偶发 DNS/网络抖动不必等满 10 分钟轮询 */
function scheduleAutoRetry() {
  if (autoRetryCount >= MAX_AUTO_RETRIES) {
    log.info('[updater] 后台补试次数已用完，等下一轮定时检查')
    return
  }
  autoRetryCount++
  if (autoRetryTimer) clearTimeout(autoRetryTimer)
  autoRetryTimer = setTimeout(() => {
    autoRetryTimer = null
    log.info(`[updater] 后台补试检查更新（第 ${autoRetryCount} 次）...`)
    checkForUpdates(false).catch(() => {})
  }, AUTO_RETRY_DELAY)
}

/** 检查更新（manual=true 时错误会反馈给界面，自动检查的错误仅记录日志） */
async function checkForUpdates(manual = false): Promise<UpdaterState> {
  lastActionManual = manual
  // 排队中的后台补试被本次检查取代，否则可能两个检查同时在跑
  if (autoRetryTimer) {
    clearTimeout(autoRetryTimer)
    autoRetryTimer = null
  }
  if (manual) autoRetryCount = 0

  if (!app.isPackaged) {
    if (manual) {
      updateState({ status: 'not-available', error: '开发模式下不支持自动更新，请使用打包后的应用' })
    } else {
      updateState({ status: 'idle', error: undefined }, true)
    }
    return getState()
  }

  updateState({ status: 'checking', error: undefined })
  errorFromInFlightCall = true
  inFlightError = null
  try {
    const autoUpdater = await getAutoUpdater()
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      // 用户主动点了就该多给一次机会：DNS 抖动常在 1~2 秒内自愈，别立刻弹「连接超时」
      if (!manual) throw e
      log.warn('[updater] 首次检查失败，即时补试:', (e as Error).message)
      await new Promise(r => setTimeout(r, MANUAL_RETRY_DELAY))
      await autoUpdater.checkForUpdates()
    }
    // 极少数失败只发 error 事件、不让 promise reject；不收尾界面会一直停在「检查中」
    if (state.status === 'checking') {
      const raw = inFlightError ?? '更新检查未能完成'
      log.error('[updater] 检查更新未完成:', raw)
      if (manual) {
        updateState({ status: 'error', error: friendlyUpdateError(raw) })
      } else {
        updateState({ status: 'idle', error: undefined }, true)
        scheduleAutoRetry()
      }
      return getState()
    }
    autoRetryCount = 0
    return getState()
  } catch (e) {
    const raw = (e as Error).message || String(e)
    log.error('[updater] 检查更新失败:', raw)
    if (manual) {
      updateState({ status: 'error', error: friendlyUpdateError(raw) })
    } else {
      updateState({ status: 'idle', error: undefined }, true)
      scheduleAutoRetry()
    }
    return getState()
  } finally {
    errorFromInFlightCall = false
  }
}

/** 下载新版本（需先检查到可用更新） */
async function downloadUpdate(): Promise<boolean> {
  if (!app.isPackaged) return false
  if (state.status !== 'available') {
    updateState({ status: 'error', error: '当前没有可下载的更新' })
    return false
  }
  if (isDownloading) {
    log.info('[updater] 下载已在进行中，忽略重复请求')
    return true
  }
  isDownloading = true
  // 在途标记要在置 downloading 之前复位：上一轮残留的错误不能把本轮刚开始的下载判死
  errorFromInFlightCall = true
  inFlightError = null
  updateState({ status: 'downloading', error: undefined })
  try {
    // 必须 await：否则下载期间的错误进不到 catch，界面却已收到"开始下载"的成功响应
    const autoUpdater = await getAutoUpdater()
    await autoUpdater.downloadUpdate()
    // getState() 而非 state：前者返回完整联合类型，不受上面 status 收窄影响
    if (inFlightError && getState().status === 'downloading') {
      updateState({ status: 'error', error: friendlyUpdateError(inFlightError) })
      return false
    }
    return true
  } catch (e) {
    const msg = (e as Error).message || String(e)
    log.error('[updater] 下载失败:', msg)
    updateState({ status: 'error', error: friendlyUpdateError(msg) })
    return false
  } finally {
    isDownloading = false
    errorFromInFlightCall = false
  }
}

/** 退出并安装（下载完成后调用） */
/**
 * 退出并安装。
 * @param isSilent 是否静默安装（无向导）。默认 true：后台装完，不出现「下一步」。
 * @param forceRunAfter 装完是否自动重启应用。默认 true。
 */
function quitAndInstall(isSilent = true, forceRunAfter = true): boolean {
  if (!app.isPackaged) return false
  if (state.status !== 'downloaded') {
    updateState({ status: 'error', error: '更新尚未下载完成' })
    return false
  }
  // 能走到这里说明下载已经通过 getAutoUpdater() 完成，实例必然已就绪。
  // 退出路径上不能再引入 await：拿不到实例就返回 false，让 before-quit 走常规退出，
  // 而不是 preventDefault 之后既不安装也不退出
  const autoUpdater = updaterInstance
  if (!autoUpdater) {
    log.warn('[updater] 更新实例未就绪，跳过本次安装')
    return false
  }
  // 先置标志再触发退出：main.ts 的 before-quit 靠它放行，
  // 否则 before-quit 的 preventDefault 会拦截退出导致安装程序永远不启动
  installingUpdate = true
  setImmediate(() => {
    autoUpdater.quitAndInstall(isSilent, forceRunAfter)
  })
  return true
}

/** 启动定时轮询 */
function startPeriodicCheck() {
  if (checkTimer) return
  checkTimer = setInterval(() => {
    log.info('[updater] 定时检查更新...')
    lastCheckTime = Date.now()
    // 新一轮开始：补试额度重置，未触发的补试作废（本次检查已覆盖它）
    autoRetryCount = 0
    checkForUpdates(false).catch(() => {})
  }, CHECK_INTERVAL)
}

/** 节流检查：1分钟内只允许一次 */
async function throttledCheck(): Promise<UpdaterState> {
  const now = Date.now()
  if (now - lastCheckTime < THROTTLE_INTERVAL) {
    log.info('[updater] 检查更新被节流，跳过')
    return getState()
  }
  lastCheckTime = now
  return checkForUpdates(false)
}

/** 初始化：注册 IPC，并把首次检查排到首屏之后 */
export function initUpdater() {
  // IPC 注册（放本模块，避免与 ipc.ts 循环依赖）
  ipcMain.handle('updater:state', () => ({ success: true, data: getState() }))
  ipcMain.handle('updater:check', async () => {
    try {
      return { success: true, data: await checkForUpdates(true) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('updater:check-throttled', async () => {
    try {
      return { success: true, data: await throttledCheck() }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('updater:download', async () => {
    try {
      return { success: true, data: await downloadUpdate() }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('updater:install', () => {
    try {
      return { success: true, data: quitAndInstall() }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  if (!app.isPackaged) {
    log.info('[updater] 开发模式下自动更新已禁用')
    return
  }

  // 首次检查延后：启动阶段把 CPU 和网络留给窗口首屏，之后每 10 分钟自动轮询
  setTimeout(() => {
    lastCheckTime = Date.now()
    checkForUpdates(false).catch(() => {})
    startPeriodicCheck()
  }, FIRST_CHECK_DELAY)
}

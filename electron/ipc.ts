import { ipcMain, dialog, BrowserWindow } from 'electron'
import log from 'electron-log'
import type {
  IpcEventChannels,
  MiniWindowAction,
  RecordedStep,
  RegionMonitor,
  ScreenRect,
  TakeoverAction,
  WindowMode
} from '../shared/types'
import {
  getScripts,
  saveScript,
  deleteScript,
  getLogs,
  deleteLog,
  clearLogs,
  getScript,
  updateScriptSteps,
  updateScriptMonitors,
  getScriptMonitors
} from './db/repository'
import { getSettings, saveSettings } from './config'
import { applyLogDir } from './utils/log-transport'
import { ScriptManager } from './script/script-manager'
import { BrowserManager } from './browser/browser-manager'
import { detectBrowser } from './browser/browser-detect'
import { sendFeedback } from './services/feedback'
import { getChangelog } from './services/changelog'
import { isPicking, pickRegion, submitSelect, cancelSelect } from './window/region-picker'
import {
  getWindowMode,
  setWindowMode,
  getMiniTarget,
  bindRecordFocus,
  endRecordFocus
} from './window/mini-control'
import {
  listDisplays,
  snapshotRegion,
  saveBaseline,
  saveBaselineFromDataUrl,
  readBaselineFrame,
  removeBaseline
} from './vision/capture'
import { probeOnce } from './vision/monitor-runner'
import { getRecordSession } from './record/record-session'
import type { IpcResponse } from '../shared/types'

export function pushEvent<K extends keyof IpcEventChannels>(
  channel: K,
  ...args: Parameters<IpcEventChannels[K]>
) {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  })
}

function ok<T>(data: T): IpcResponse<T> {
  return { success: true, data }
}

function fail(error: unknown): IpcResponse<never> {
  return { success: false, error: error instanceof Error ? error.message : String(error) }
}

function handle(channel: string, fn: (...args: any[]) => any) {
  ipcMain.handle(channel, async (_e: any, ...args: any[]) => {
    try {
      return ok(await fn(...args))
    } catch (e) {
      return fail(e)
    }
  })
}

export function registerIpcHandlers(_ipcMain: typeof ipcMain) {
  const sm = () => ScriptManager.getInstance()

  // ========== 脚本管理 ==========
  handle('script:list', () => getScripts())
  handle('script:save', (script: any) => saveScript(script))
  handle('script:delete', (id: number) => {
    // 执行/排队中的脚本不允许删除：记录被删后收尾阶段找不到行，界面会卡在「正在执行」
    if (sm().isBusy(id)) throw new Error('该脚本正在执行或排队中，请先终止后再删除')
    // 基准图是按监控项 id 存的文件，行删了文件留着就是无主垃圾
    for (const monitor of getScriptMonitors(id)) removeBaseline(monitor.id)
    return deleteScript(id)
  })
  // 非阻塞：入队后立即返回，不等待队列执行完（无限循环模式下 await 会让 IPC 永不返回）
  handle('script:run', (id: number, count: number, defaults?: Record<string, string>) => {
    sm().runScript(id, count, defaults ?? {})
    return true
  })
  handle('script:pause', (id: number) => {
    sm().pauseCurrent(id)
    return true
  })
  handle('script:resume', (id: number) => {
    sm().resumeCurrent(id)
    return true
  })
  handle('script:terminate', (id: number) => {
    sm().terminateCurrent(id)
    return true
  })
  handle('script:stopAll', () => {
    sm().stopAll()
    return true
  })

  // ========== 执行中实时操作 ==========
  /** 步骤落库 + 正在跑的那一轮立即按新列表走（当前这一步跑完生效） */
  handle('script:steps:update', (id: number, steps: RecordedStep[]) => {
    const saved = updateScriptSteps(id, steps)
    if (sm().updateLiveSteps(id, steps)) log.info(`[IPC] 脚本 ${id} 步骤已热更新（${steps.length} 步）`)
    return saved
  })
  handle('script:step:skip', (id: number) => sm().skipCurrentStep(id))
  handle('script:step:back', (id: number) => sm().stepBack(id))
  handle('script:takeover', (id: number, action: TakeoverAction) => sm().resolveTakeover(id, action))

  /** 保存监控项：被删掉的监控顺手清掉基准图文件，不留无主图片 */
  handle('script:monitors:save', (id: number, monitors: RegionMonitor[]) => {
    const kept = new Set(monitors.map(m => m.id))
    for (const monitor of getScriptMonitors(id)) {
      if (!kept.has(monitor.id)) removeBaseline(monitor.id)
    }
    updateScriptMonitors(id, monitors)
    const saved = getScript(id)
    if (!saved) throw new Error(`脚本 ${id} 不存在`)
    return saved
  })

  // ========== 日志 ==========
  handle('log:list', (filter?: any) => getLogs(filter))
  handle('log:delete', (id: number) => deleteLog(id))
  handle('log:clear', () => clearLogs())

  // ========== 设置 ==========
  handle('settings:get', () => getSettings())
  handle('settings:save', async (settings: any) => {
    const before = getSettings()
    const merged = saveSettings(settings)
    // 日志目录改了立即切换落盘位置，无需重启
    if (before.storage.logDir !== merged.storage.logDir) applyLogDir()
    // 换了浏览器程序或无头模式，缓存的浏览器实例还是旧配置：不重建的话要等 5 分钟空闲休眠才生效
    const needsRelaunch =
      before.browser.executablePath !== merged.browser.executablePath ||
      before.browser.headless !== merged.browser.headless
    if (!needsRelaunch) return merged
    if (sm().isBusy()) {
      log.warn('[IPC] 有脚本正在执行，新的浏览器配置将在本轮执行结束后生效')
    } else {
      await BrowserManager.getInstance().destroy()
    }
    return merged
  })

  // ========== 执行浏览器 ==========
  handle('browser:detect', (executablePath?: string) => detectBrowser(executablePath))
  // 选择浏览器程序文件；取消返回 null
  handle('dialog:pickBrowser', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择浏览器程序',
      properties: ['openFile'],
      defaultPath: process.env.ProgramFiles,
      filters: [{ name: '浏览器程序', extensions: ['exe'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ========== 功能反馈 ==========
  handle('feedback:send', async (payload: { content: string; contact?: string }) => { await sendFeedback(payload); return true })

  // ========== 历史更新记录 ==========
  handle('changelog:list', () => getChangelog())

  // ========== 窗口形态（完整界面 ⇄ 迷你控制窗） ==========
  handle('window:setMode', (mode: WindowMode) => {
    const next = setWindowMode(mode)
    pushEvent('window:mode', next)
    return next
  })
  handle('window:getMode', () => getWindowMode())

  /** 迷你窗按钮：界面只发按钮名，作用对象由主进程记住 */
  handle('mini:command', async (cmd: MiniWindowAction) => {
    const target = getMiniTarget()
    switch (cmd) {
      case 'stopRecord':
        await getRecordSession().stop()
        endRecordFocus()
        // 结束录制后应用回到原本大小，用户接着改步骤、看监控
        setWindowMode('normal')
        pushEvent('window:mode', 'normal')
        return true
      case 'restore': {
        const next = setWindowMode('normal')
        pushEvent('window:mode', next)
        return true
      }
      case 'pause':
        if (target !== null) sm().pauseCurrent(target)
        return true
      case 'resume':
        if (target !== null) sm().resumeCurrent(target)
        return true
      case 'skipStep':
        return target !== null && sm().skipCurrentStep(target)
      case 'terminate':
        if (target !== null) sm().terminateCurrent(target)
        return true
      default:
        return false
    }
  })

  // ========== 全屏框选 ==========
  // 遮罩是透明且盖在实时桌面上，不需要先收主窗口或先抓背景图
  handle('region:pick', () => {
    // 叠两层遮罩会让用户分不清在选哪一块，这里明确报错而不是静默返回 null
    if (isPicking()) throw new Error('屏幕上已经有一层框选遮罩，先在那块屏上拖框或按 Esc 取消')
    return pickRegion()
  })
  handle('region:displays', () => listDisplays())
  handle('overlay:select', (payload: { displayIndex: number; rect: ScreenRect }) =>
    submitSelect(payload.displayIndex, payload.rect)
  )
  handle('overlay:cancel', () => cancelSelect())

  // ========== 区域监控 ==========
  handle('monitor:snapshot', (rect: ScreenRect) => snapshotRegion(rect))
  handle('monitor:baseline:save', (monitorId: string, rect: ScreenRect) => saveBaseline(monitorId, rect))
  handle('monitor:baseline:upload', (monitorId: string, pngDataUrl: string) =>
    saveBaselineFromDataUrl(monitorId, pngDataUrl)
  )
  handle('monitor:baseline:read', (monitorId: string) => readBaselineFrame(monitorId))
  handle('monitor:probe', (monitor: RegionMonitor) => probeOnce(monitor))

  // ========== 屏幕轨录制（真实浏览器里采步骤） ==========
  handle('record:start', async (targetUrl: string) => {
    await getRecordSession().start(targetUrl)
    bindRecordFocus('屏幕轨录制中')
    return true
  })
  handle('record:stop', async () => {
    await getRecordSession().stop()
    endRecordFocus()
    return true
  })
  handle('record:status', () => getRecordSession().isRecording())
}

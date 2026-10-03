/**
 * 脚本管理器 - 管理脚本执行队列与并发
 *
 * 核心不变量：每个入队的任务「有且只有一次」完成通知（completeScript），
 * 由把它从队列中移除的那条路径负责调用，避免重复推送 script:complete / 重复写日志。
 *
 * 并发模型：队列项按 script.maxConcurrency 个槽位并行派发，每个脚本的执行轮次
 * （含轮次间隔）独占一个槽位，直到该脚本收尾出队才释放。
 */
import { ScriptExecutor } from './script-executor'
import { hideHud, showHud, updateHud } from './hud-overlay'
import { getScript, getScriptSteps, updateScriptStatus, insertLog, incrementRunCount } from '../db/repository'
import { BrowserManager } from '../browser/browser-manager'
import { getSettings } from '../config'
import { pushEvent } from '../ipc'
import { notifyScriptComplete } from '../notify/notifier'
import log from 'electron-log'

interface QueueItem {
  scriptId: number
  totalRuns: number
  currentRun: number
  /** 已被调度器派发（占用了并发槽位），不会再次入队执行 */
  dispatched: boolean
}

/** 并发上限：设置项为 1..5，非法值按串行处理 */
function concurrencyCap(): number {
  const raw = Math.floor(Number(getSettings().script.maxConcurrency))
  if (!Number.isFinite(raw) || raw < 1) return 1
  return Math.min(raw, 5)
}

export class ScriptManager {
  private static instance: ScriptManager
  private queue: QueueItem[] = []
  private running = false
  /** scriptId → 正在执行的 executor（暂停/终止按它定位） */
  private active = new Map<number, ScriptExecutor>()
  /** 占用并发槽位的脚本（执行中 + 轮次间隔等待中） */
  private slots = new Set<number>()
  private stopRequested = false
  /** 被单独终止的脚本 ID 集合（区别于 stopAll 的全局停止） */
  private terminatedScriptIds = new Set<number>()
  /** 已发出完成通知的队列项：completeScript 幂等（连点终止等场景不会重复通知）。
   *  按项而非按 scriptId 记录：同一脚本下次执行是新对象，不会被旧标志误吞 */
  private readonly completedItems = new WeakSet<QueueItem>()
  /** 调度器的等待钩子：有空位、有新任务或收到停止信号时唤醒 */
  private wake: (() => void) | null = null

  private constructor() {}

  static getInstance(): ScriptManager {
    if (!ScriptManager.instance) {
      ScriptManager.instance = new ScriptManager()
    }
    return ScriptManager.instance
  }

  /**
   * 启动脚本（同步、非阻塞）。
   * 入队后立即返回，不等待队列执行完 —— 否则无限循环模式下 IPC 永不返回，
   * 渲染进程 await 永久挂起，执行弹窗关不掉。
   */
  runScript(scriptId: number, count: number = 1): void {
    const script = getScript(scriptId)
    if (!script) {
      throw new Error(`脚本 ${scriptId} 不存在`)
    }
    // 同一脚本不允许重复入队（正在执行或排队中都算），防止队列里堆积同名任务
    if (this.queue.some(item => item.scriptId === scriptId)) {
      throw new Error('该脚本正在执行或排队中，请勿重复启动')
    }

    // 清理上一轮执行的残留终止标志，避免新一轮被旧标志挡住
    this.terminatedScriptIds.delete(scriptId)
    // count === 0 表示无限循环，用 Infinity 实现，靠 stopRequested 退出；
    // 其余值（含被清空的输入框传来的 null/NaN、以及负数）一律按 1 次执行，避免误判成无限循环
    const totalRuns = count === 0 ? Infinity : Math.max(1, Math.floor(Number(count)) || 1)
    updateScriptStatus(scriptId, 'running')
    this.queue.push({ scriptId, totalRuns, currentRun: 0, dispatched: false })

    this.kick()
  }

  /** 启动调度循环（若未在运行）；已在运行则只需唤醒它去派发新任务 */
  private kick() {
    if (this.running) {
      this.notify()
      return
    }
    this.running = true
    this.stopRequested = false
    void this.processQueue().catch(err => {
      log.error('[ScriptManager] 队列处理异常:', err)
    })
  }

  private notify() {
    const wake = this.wake
    this.wake = null
    wake?.()
  }

  private waitForWake(): Promise<void> {
    return new Promise<void>(resolve => { this.wake = resolve })
  }

  private async processQueue() {
    try {
      // 已派发项由各自的 runItem 收尾；停止信号到来后不再派发新任务，
      // 等占用槽位的任务全部退出后结束循环（之后若有新任务由 kick 重新接管）
      while (this.queue.length > 0 && !(this.stopRequested && this.slots.size === 0)) {
        const cap = concurrencyCap()
        for (const item of [...this.queue]) {
          if (this.slots.size >= cap) break
          if (item.dispatched) continue
          item.dispatched = true
          this.slots.add(item.scriptId)
          void this.runItem(item)
        }
        await this.waitForWake()
      }
    } finally {
      this.running = false
      this.active.clear()
      this.slots.clear()
      this.wake = null
      // 停止期间可能有新任务入队（stopAll 之后用户又点了执行），重新启动循环接管它们
      if (this.queue.length > 0) {
        setImmediate(() => this.kick())
      } else {
        BrowserManager.getInstance().scheduleIdleCheck()
      }
    }
  }

  /** 派发一个队列项；无论走哪条出口，最后都必须唤醒调度器，否则释放的槽位没人接手 */
  private async runItem(item: QueueItem) {
    try {
      await this.runQueueItem(item)
    } finally {
      this.notify()
    }
  }

  /** 单个队列项的完整生命周期：多轮执行 → 收尾 → 释放并发槽位 */
  private async runQueueItem(item: QueueItem) {
    const script = getScript(item.scriptId)
    const steps = script ? getScriptSteps(item.scriptId) : []
    if (!script || steps.length === 0) {
      if (script) log.warn(`[ScriptManager] 脚本 ${item.scriptId} 没有步骤`)
      // 不可执行的项同样要走唯一完成出口，否则前端一直显示「正在执行」、库里状态卡在 running
      this.finishItem(item, {
        successCount: 0,
        failCount: 1,
        stopped: false,
        message: script ? '脚本没有可执行的操作步骤' : '脚本记录已不存在，未能执行'
      })
      return
    }

    let successCount = 0
    let failCount = 0
    let stopped = false
    const isInfinite = !Number.isFinite(item.totalRuns)

    try {
      // 浮窗覆盖在执行浏览器上，避免用户对着一个「看起来没反应」的页面以为卡死
      showHud({
        scriptId: item.scriptId,
        scriptName: script.name,
        currentRun: 1,
        totalRuns: isInfinite ? -1 : item.totalRuns,
        stepIndex: -1,
        totalSteps: steps.length,
        stepDescription: '正在启动浏览器并打开目标页面…',
        paused: false
      })

      for (let i = 0; i < item.totalRuns; i++) {
        // 每轮开始前检查停止标志，避免 stopAll 或 terminate 后仍创建新 executor
        if (this.isStoppedFor(item.scriptId)) {
          stopped = true
          break
        }

        item.currentRun = i + 1
        log.info(`[ScriptManager] 执行脚本 ${item.scriptId} 第 ${i + 1}${isInfinite ? '' : '/' + item.totalRuns} 次`)

        const executor = new ScriptExecutor(script, steps, item.totalRuns, i + 1)
        this.active.set(item.scriptId, executor)
        let success: boolean
        try {
          success = await executor.run()
        } finally {
          if (this.active.get(item.scriptId) === executor) this.active.delete(item.scriptId)
        }

        if (success) {
          successCount++
          incrementRunCount(item.scriptId)
        } else {
          failCount++
        }

        // run 返回后再次检查，stopAll/terminate 在 run 期间触发时立即退出
        if (this.isStoppedFor(item.scriptId)) {
          stopped = true
          break
        }

        // 轮次间隔（设置项 script.runInterval，单位秒），可被停止打断
        if (i + 1 < item.totalRuns) {
          updateHud({
            scriptId: item.scriptId,
            stepIndex: -1,
            stepStartedAt: Date.now(),
            stepDescription: `第 ${i + 1} 轮已完成，等待下一轮…`
          })
          await this.interruptibleSleep(getSettings().script.runInterval * 1000, item.scriptId)
          if (this.isStoppedFor(item.scriptId)) {
            stopped = true
            break
          }
        }
      }
    } finally {
      // 收尾放在 finally：这里若被异常打断，队列项就永远留在队列里被反复重跑，
      // 而第二次 completeScript 会被幂等标志吞掉，前端再也收不到完成事件
      hideHud(item.scriptId)
      this.finishItem(item, { successCount, failCount, stopped })
    }
  }

  /** 单项收尾：释放槽位 → 清终止标志 → 唯一完成出口 → 按身份出队 */
  private finishItem(
    item: QueueItem,
    result: { successCount: number; failCount: number; stopped: boolean; message?: string }
  ) {
    this.slots.delete(item.scriptId)
    this.terminatedScriptIds.delete(item.scriptId)
    try {
      this.completeScript(item, result)
    } finally {
      // 按身份移除而不是盲目 shift：收尾期间队列可能被并发的另一项改过，
      // shift 会删掉别人的排队任务，或漏删本项导致它被重跑
      const idx = this.queue.indexOf(item)
      if (idx !== -1) this.queue.splice(idx, 1)
    }
  }

  /** 唯一完成出口：更新状态 + 推送完成事件 + 写日志 + 系统通知，四者一致且只发生一次（幂等） */
  private completeScript(
    item: QueueItem,
    result: { successCount: number; failCount: number; stopped: boolean; message?: string }
  ) {
    if (this.completedItems.has(item)) return
    this.completedItems.add(item)
    const { scriptId } = item
    const { successCount, failCount, stopped } = result
    const success = !stopped && failCount === 0
    const message =
      result.message ??
      (stopped ? '脚本已被手动停止' : `执行完成: 成功 ${successCount} 次, 失败 ${failCount} 次`)
    // 状态落库失败不能连带吞掉完成事件：否则前端界面永远停在「正在执行」
    try {
      updateScriptStatus(scriptId, success ? 'completed' : 'failed')
    } catch (err) {
      log.error(`[ScriptManager] 更新脚本 ${scriptId} 状态失败:`, err)
    }
    pushEvent('script:complete', { scriptId, success, message })
    this.safeInsertLog(scriptId, success ? 'info' : 'warn', message)
    notifyScriptComplete(scriptId, message, success)
  }

  /** 写日志失败不能连带打断完成通知（历史库的 run_logs 外键就曾指向已废弃表） */
  private safeInsertLog(scriptId: number, level: 'info' | 'warn', message: string) {
    try {
      insertLog({ scriptId, level, message })
    } catch (err) {
      log.error('[ScriptManager] 写入运行日志失败:', err)
    }
  }

  /** 该脚本是否已收到停止信号：全局 stopAll 或单脚本终止 */
  private isStoppedFor(scriptId: number): boolean {
    return this.stopRequested || this.terminatedScriptIds.has(scriptId)
  }

  /**
   * 是否有脚本在执行或排队中（队列项在收尾时才出队，因此覆盖执行期间）。
   * 不传 scriptId 表示询问「是否有任何脚本在跑」。
   */
  isBusy(scriptId?: number): boolean {
    return this.queue.some(item => scriptId === undefined || item.scriptId === scriptId)
  }

  /** 可被打断的 sleep（stopAll / terminate 时提前返回） */
  private async interruptibleSleep(ms: number, scriptId: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0) return
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (this.isStoppedFor(scriptId)) return
      await new Promise(r => setTimeout(r, Math.min(200, end - Date.now())))
    }
  }

  stopAll() {
    this.stopRequested = true
    // 清空单脚本终止集合，避免与全局停止混淆
    this.terminatedScriptIds.clear()
    for (const executor of this.active.values()) executor.terminate()

    // 尚未派发的任务：立即走完成出口。
    // 用 dispatched 而不是队列位置判断：并发下队列里同时存在执行中与待执行项，
    // 按位置切片会把正在收尾的项当成待执行项删掉，也会把它之后新排队的任务静默丢弃
    for (const item of this.queue) {
      if (!item.dispatched) {
        this.completeScript(item, { successCount: 0, failCount: 0, stopped: true })
      }
    }
    // 只保留已派发正在处理的项（若有），由各自 runItem 的 finally 负责收尾
    this.queue = this.queue.filter(item => item.dispatched)
    log.info('[ScriptManager] 所有脚本已停止')
    this.notify()
  }

  /** 暂停指定脚本（并发下只有目标脚本会停，其它脚本继续执行） */
  pauseCurrent(scriptId?: number) {
    for (const [id, executor] of this.active) {
      if (scriptId === undefined || id === scriptId) executor.pause()
    }
  }

  /** 恢复指定脚本 */
  resumeCurrent(scriptId?: number) {
    for (const [id, executor] of this.active) {
      if (scriptId === undefined || id === scriptId) executor.resume()
    }
  }

  /** 终止单个脚本：终止正在执行的 executor 或从队列移除待执行项 */
  terminateCurrent(scriptId: number) {
    const executor = this.active.get(scriptId)
    if (executor) {
      // 正在执行：加入终止集合，runItem 的轮次循环会检测并走统一完成出口
      this.terminatedScriptIds.add(scriptId)
      executor.terminate()
      log.info(`[ScriptManager] 脚本 ${scriptId} 已终止`)
      return
    }

    const target = this.queue.find(item => item.scriptId === scriptId)
    if (!target) {
      log.warn(`[ScriptManager] 脚本 ${scriptId} 未在执行，忽略终止请求`)
      return
    }

    if (target.dispatched) {
      // 已派发但处于轮次间隔/启动间隙：仍由它的 runItem 统一收尾，标记终止即可
      // （避免重复完成或重复执行）
      this.terminatedScriptIds.add(scriptId)
      log.info(`[ScriptManager] 脚本 ${scriptId} 标记终止，等待当前处理收尾`)
      return
    }

    // 尚未开始的排队项：直接从队列移除并立即完成
    this.finishItem(target, { successCount: 0, failCount: 0, stopped: true })
    log.info(`[ScriptManager] 排队中的脚本 ${scriptId} 已移除`)
    this.notify()
  }
}

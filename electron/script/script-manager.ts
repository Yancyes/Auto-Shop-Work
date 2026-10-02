/**
 * 脚本管理器 - 管理脚本执行队列和并发
 *
 * 核心不变量：每个入队的任务「有且只有一次」完成通知（completeScript），
 * 由把它从队列中移除的那条路径负责调用，避免重复推送 script:complete / 重复写日志。
 */
import { ScriptExecutor } from './script-executor'
import { hideHud, showHud, updateHud } from './hud-overlay'
import { getScript, getScriptSteps, updateScriptStatus, insertLog, incrementRunCount } from '../db/repository'
import { BrowserManager } from '../browser/browser-manager'
import { getSettings } from '../config'
import { pushEvent } from '../ipc'
import log from 'electron-log'

interface QueueItem {
  scriptId: number
  totalRuns: number
  currentRun: number
}

export class ScriptManager {
  private static instance: ScriptManager
  private queue: QueueItem[] = []
  private running = false
  private currentExecutor: ScriptExecutor | null = null
  private stopRequested = false
  /** 被单独终止的脚本 ID 集合（区别于 stopAll 的全局停止） */
  private terminatedScriptIds = new Set<number>()
  /** 已发出完成通知的脚本 ID：保证同一轮执行里 completeScript 幂等（连点终止等场景不会重复通知） */
  private completedScriptIds = new Set<number>()

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

    // 清理上一轮执行的残留标志，避免新一轮被旧标志挡住
    this.terminatedScriptIds.delete(scriptId)
    this.completedScriptIds.delete(scriptId)
    // count <= 0 表示无限循环，用 Infinity 实现，靠 stopRequested 退出
    const totalRuns = count <= 0 ? Infinity : count
    updateScriptStatus(scriptId, 'running')
    this.queue.push({ scriptId, totalRuns, currentRun: 0 })

    this.kick()
  }

  /** 启动队列处理循环（若未在运行） */
  private kick() {
    if (this.running) return
    this.running = true
    this.stopRequested = false
    void this.processQueue().catch(err => {
      log.error('[ScriptManager] 队列处理异常:', err)
    })
  }

  private async processQueue() {
    try {
      while (this.queue.length > 0 && !this.stopRequested) {
        const item = this.queue[0]
        const script = getScript(item.scriptId)
        if (!script) {
          this.queue.shift()
          continue
        }

        const steps = getScriptSteps(item.scriptId)
        if (steps.length === 0) {
          log.warn(`[ScriptManager] 脚本 ${item.scriptId} 没有步骤`)
          updateScriptStatus(item.scriptId, 'failed')
          this.safeInsertLog(item.scriptId, 'warn', '脚本没有操作步骤')
          this.queue.shift()
          continue
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

            this.currentExecutor = new ScriptExecutor(script, steps, item.totalRuns, i + 1)
            const success = await this.currentExecutor.run()
            this.currentExecutor = null

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
          // 收尾放在 finally：这里若被异常打断，队首项就永远留在队列里被反复重跑，
          // 而第二次 completeScript 会被 completedScriptIds 幂等吞掉，前端再也收不到完成事件
          hideHud()
          // 统一完成出口：自然结束与手动停止都在这里通知，且只通知一次
          this.completeScript(item.scriptId, { successCount, failCount, stopped })
          // 清理单脚本终止标志（不影响后续 stopAll 全局标志）
          this.terminatedScriptIds.delete(item.scriptId)
          this.queue.shift()
        }
      }
    } finally {
      hideHud()
      this.running = false
      this.currentExecutor = null
      // 停止期间可能有新任务入队（stopAll 之后用户又点了执行），重新启动循环接管它们
      if (this.queue.length > 0) {
        setImmediate(() => this.kick())
      } else {
        BrowserManager.getInstance().scheduleIdleCheck()
      }
    }
  }

  /** 唯一完成出口：更新状态 + 推送完成事件 + 写日志，三者一致且只发生一次（幂等） */
  private completeScript(scriptId: number, result: { successCount: number; failCount: number; stopped: boolean }) {
    if (this.completedScriptIds.has(scriptId)) return
    this.completedScriptIds.add(scriptId)
    const { successCount, failCount, stopped } = result
    if (stopped) {
      updateScriptStatus(scriptId, 'failed')
      pushEvent('script:complete', {
        scriptId,
        success: false,
        message: '脚本已被手动停止'
      })
      this.safeInsertLog(scriptId, 'warn', '脚本执行被手动停止')
    } else {
      const success = failCount === 0
      updateScriptStatus(scriptId, success ? 'completed' : 'failed')
      pushEvent('script:complete', {
        scriptId,
        success,
        message: `执行完成: 成功 ${successCount} 次, 失败 ${failCount} 次`
      })
      this.safeInsertLog(scriptId, success ? 'info' : 'warn', `脚本执行完成: 成功 ${successCount} 次, 失败 ${failCount} 次`)
    }
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

    const hasCurrent = this.currentExecutor !== null
    if (this.currentExecutor) {
      this.currentExecutor.terminate()
    }

    // 队列中尚未开始的任务：逐个走统一完成出口（当前正在执行的由 processQueue 停止分支处理）
    const pending = this.queue.slice(hasCurrent ? 1 : 0)
    for (const item of pending) {
      this.completeScript(item.scriptId, { successCount: 0, failCount: 0, stopped: true })
    }
    // 只保留当前正在执行的项（若有），等待 processQueue 的停止分支收尾
    this.queue = this.queue.slice(0, hasCurrent ? 1 : 0)
    log.info('[ScriptManager] 所有脚本已停止')
  }

  /** 暂停指定脚本（仅当它是当前正在执行的脚本时生效） */
  pauseCurrent(scriptId?: number) {
    if (this.currentExecutor && (scriptId === undefined || this.currentExecutor.script.id === scriptId)) {
      this.currentExecutor.pause()
    }
  }

  /** 恢复指定脚本 */
  resumeCurrent(scriptId?: number) {
    if (this.currentExecutor && (scriptId === undefined || this.currentExecutor.script.id === scriptId)) {
      this.currentExecutor.resume()
    }
  }

  /** 终止单个脚本：终止当前 executor 或从队列移除待执行项 */
  terminateCurrent(scriptId: number) {
    // 当前正在执行：加入终止集合，processQueue 的 for 循环会检测并走统一完成出口
    if (this.currentExecutor && this.currentExecutor.script.id === scriptId) {
      this.terminatedScriptIds.add(scriptId)
      this.currentExecutor.terminate()
      log.info(`[ScriptManager] 脚本 ${scriptId} 已终止`)
      return
    }

    const idx = this.queue.findIndex(item => item.scriptId === scriptId)
    if (idx === -1) {
      log.warn(`[ScriptManager] 脚本 ${scriptId} 未在执行，忽略终止请求`)
      return
    }

    if (idx === 0) {
      // 队首：可能正处于轮次间隔（currentExecutor 已置 null），但仍由 processQueue 处理。
      // 加入终止集合即可让 for 循环 break，并由其统一调用 completeScript（避免重复完成/重复执行）。
      this.terminatedScriptIds.add(scriptId)
      log.info(`[ScriptManager] 脚本 ${scriptId} 标记终止，等待当前处理收尾`)
      return
    }

    // 尚未开始的排队项（idx>0）：直接从队列移除并立即完成
    this.queue.splice(idx, 1)
    this.completeScript(scriptId, { successCount: 0, failCount: 0, stopped: true })
    log.info(`[ScriptManager] 排队中的脚本 ${scriptId} 已移除`)
  }
}

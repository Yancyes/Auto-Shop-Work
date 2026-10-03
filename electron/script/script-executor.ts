/**
 * 脚本执行器 - 回放录制的操作步骤
 * 使用 Playwright 在真实浏览器中执行录制的步骤
 */
import { BrowserContext, Page } from 'playwright'
import { BrowserManager } from '../browser/browser-manager'
import { getSettings } from '../config'
import { pushEvent } from '../ipc'
import { updateHud } from './hud-overlay'
import { insertLog } from '../db/repository'
import { notifyManualIntervention } from '../notify/notifier'
import type { AntiDetectionSettings, RecordedStep, RecordedScript } from '../../shared/types'
import log from 'electron-log'

/** 步骤之间的基础等待（ms） */
const BASE_STEP_DELAY = 300

export class ScriptExecutor {
  private context: BrowserContext | null = null
  private page: Page | null = null
  private terminated = false
  private paused = false
  private resumeResolve: (() => void) | null = null
  /** 本次执行的设置快照：跑到一半用户改设置不会让同一次回放的行为前后不一致 */
  private anti: AntiDetectionSettings = { enabled: false, typingDelay: false, mouseTrace: false, randomDelay: false }
  private stepRetry = 0

  constructor(
    public script: RecordedScript,
    public steps: RecordedStep[],
    public totalRuns: number,
    public currentRun: number
  ) {}

  /** 统一推送执行进度。Infinity 在 IPC 序列化时会变成 null，用 -1 表示无限循环 */
  private pushProgress(patch: { stepIndex: number; stepDescription?: string; stepStartedAt?: number; paused: boolean }) {
    const totalRuns = Number.isFinite(this.totalRuns) ? this.totalRuns : -1
    pushEvent('script:progress', {
      scriptId: this.script.id,
      currentRun: this.currentRun,
      totalRuns,
      totalSteps: this.steps.length,
      ...patch
    })
    updateHud({
      scriptId: this.script.id,
      scriptName: this.script.name,
      currentRun: this.currentRun,
      totalRuns,
      totalSteps: this.steps.length,
      ...patch
    })
  }

  async run(): Promise<boolean> {
    try {
      const settings = getSettings()
      this.anti = settings.antiDetection
      this.stepRetry = clampInt(settings.script.retryCount, 0, 10)

      const bm = BrowserManager.getInstance()
      this.context = await bm.createContext()
      this.page = await this.context.newPage()

      // 超时读取设置项（browser.timeout），不再硬编码
      const timeout = settings.browser.timeout
      this.page.setDefaultTimeout(timeout)

      await this.page.goto(this.script.targetUrl, { waitUntil: 'domcontentloaded', timeout })
      await this.page.waitForTimeout(1000)

      for (let i = 0; i < this.steps.length; i++) {
        if (this.terminated) {
          log.info(`[ScriptExecutor] 脚本 ${this.script.id} 执行被终止`)
          return false
        }

        await this.waitWhilePaused()

        const step = this.steps[i]
        const stepDescription = step.description || step.elementText || step.selector || step.action

        this.pushProgress({
          stepIndex: i,
          stepDescription,
          stepStartedAt: Date.now(),
          paused: this.paused
        })

        try {
          await this.executeStepWithRetry(step, stepDescription)
        } catch (err) {
          // 用户终止时 context 已关闭，正在 await 的操作必然抛「Target closed」：
          // 这是预期中断而不是脚本故障，记成步骤错误会让日志充满假报错
          if (this.terminated) {
            log.info(`[ScriptExecutor] 脚本 ${this.script.id} 在第 ${i + 1} 步被终止`)
            return false
          }
          const errorMsg = err instanceof Error ? err.message : String(err)
          log.error(`[ScriptExecutor] 步骤 ${i + 1} 执行失败:`, errorMsg)
          pushEvent('script:stepError', {
            scriptId: this.script.id,
            stepIndex: i,
            error: errorMsg
          })
          this.safeInsertLog(`步骤 ${i + 1}（${stepDescription}）重试 ${this.stepRetry} 次后仍失败: ${errorMsg}`)
          // 反复失败通常意味着页面变了（弹窗、改版、登录失效），人在旁边看一眼比静默放弃有用
          notifyManualIntervention(this.script.name, i, errorMsg)
          return false
        }

        await this.waitBeforeNextStep(step)
      }

      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      // 终止导致的 context 关闭不算异常
      if (!this.terminated) this.safeInsertLog(`执行异常: ${errorMsg}`)
      log.error(`[ScriptExecutor] 执行${this.terminated ? '被终止' : '异常'}:`, errorMsg)
      return false
    } finally {
      if (this.context) {
        await this.context.close().catch(() => {})
        this.context = null
        this.page = null
      }
    }
  }

  /** 按设置项 script.retryCount 重试同一步骤；全部失败才向上抛 (最后一次错误) */
  private async executeStepWithRetry(step: RecordedStep, stepDescription: string): Promise<void> {
    const attempts = this.stepRetry + 1
    let lastErr: unknown = null
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (this.terminated) throw new Error('执行已终止')
      try {
        await this.executeStep(step)
        return
      } catch (err) {
        lastErr = err
        if (attempt >= attempts || this.terminated) break
        const reason = err instanceof Error ? err.message : String(err)
        // 重试细节走运行日志文件，不写 run_logs 免把界面日志刷满
        log.warn(
          `[ScriptExecutor] 步骤「${stepDescription}」第 ${attempt} 次尝试失败，重试中:`,
          reason
        )
        await this.sleep(600 * attempt)
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  /** 步骤间等待：录制间隔优先，开启随机延迟时在 ±30% 内抖动 */
  private async waitBeforeNextStep(step: RecordedStep) {
    const recorded = step.delayBefore && step.delayBefore > 0 && step.delayBefore < 10000
      ? step.delayBefore
      : BASE_STEP_DELAY
    const ms = this.anti.enabled && this.anti.randomDelay
      ? Math.round(recorded * (0.7 + Math.random() * 0.6))
      : recorded
    if (!this.page) return
    await this.page.waitForTimeout(Math.max(50, ms))
  }

  private async waitWhilePaused() {
    while (this.paused) {
      await new Promise<void>(resolve => { this.resumeResolve = resolve })
    }
  }

  /** 可被终止打断的等待（重试退避用） */
  private async sleep(ms: number) {
    const end = Date.now() + ms
    while (Date.now() < end && !this.terminated) {
      await new Promise(r => setTimeout(r, Math.min(100, end - Date.now())))
    }
  }

  /** 写日志失败不能反过来打断执行收尾（历史库的 run_logs 外键就曾指向已废弃表） */
  private safeInsertLog(message: string) {
    try {
      insertLog({ scriptId: this.script.id, level: 'error', message })
    } catch (err) {
      log.error('[ScriptExecutor] 写入运行日志失败:', err)
    }
  }

  private async executeStep(step: RecordedStep): Promise<void> {
    if (!this.page) throw new Error('页面未初始化')
    const trace = this.anti.enabled && this.anti.mouseTrace
    const typing = this.anti.enabled && this.anti.typingDelay

    switch (step.action) {
      case 'click':
        if (trace) await this.traceClick(step.selector, false)
        else await this.page.click(step.selector)
        break
      case 'dblclick':
        if (trace) await this.traceClick(step.selector, true)
        else await this.page.dblclick(step.selector)
        break
      case 'fill':
        if (typing) await this.typeSequentially(step.selector, step.value ?? '')
        else await this.page.fill(step.selector, step.value ?? '')
        break
      case 'select':
        await this.page.selectOption(step.selector, step.value ?? '')
        break
      case 'keypress':
        await this.page.keyboard.press(step.value ?? 'Enter')
        break
      case 'scroll':
        await this.page.evaluate((direction: string) => {
          window.scrollBy(0, direction === 'down' ? 300 : -300)
        }, step.value ?? 'down')
        break
      case 'navigate':
        await this.page.goto(step.value ?? '', { waitUntil: 'domcontentloaded' })
        break
      case 'wait': {
        // 非法值兜底 1000ms，避免 waitForTimeout(NaN) 行为未定义
        const ms = parseInt(step.value ?? '', 10)
        await this.page.waitForTimeout(Number.isFinite(ms) && ms > 0 ? ms : 1000)
        break
      }
      default:
        log.warn(`[ScriptExecutor] 未知动作类型: ${step.action}`)
    }
  }

  /** 逐字输入：先清空再按人眼可辨的速度敲，比一次性 fill 更像真人 */
  private async typeSequentially(selector: string, value: string) {
    if (!this.page) throw new Error('页面未初始化')
    const target = this.page.locator(selector).first()
    await target.clear().catch(() => {
      // 非可清空控件（如 contenteditable）忽略，继续输入
    })
    const base = 60 + Math.floor(Math.random() * 80)
    const delay = this.anti.randomDelay ? base + Math.floor(Math.random() * 60) : base
    await target.pressSequentially(value, { delay })
  }

  /** 轨迹点击的起点：Playwright 的 Mouse 类型未暴露 position()，自己记上一次落点 */
  private mousePos = { x: 0, y: 0 }

  /** 鼠标轨迹点击：先移动到元素外沿再曲线靠近中心，避免瞬移被判为自动化 */
  private async traceClick(selector: string, dbl: boolean) {
    if (!this.page) throw new Error('页面未初始化')
    const target = this.page.locator(selector).first()
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    if (!box) throw new Error('元素不可见，无法模拟鼠标轨迹')

    const toX = box.x + box.width / 2
    const toY = box.y + box.height / 2
    const from = this.mousePos
    const jitter = () => (this.anti.randomDelay ? (Math.random() - 0.5) * 24 : 0)
    // 中间落点：走一条折线/弧线而不是一条直线
    await this.page.mouse.move(
      from.x + (toX - from.x) * 0.45 + jitter(),
      from.y + (toY - from.y) * 0.6 + jitter(),
      { steps: 10 }
    )
    await this.page.mouse.move(toX, toY, { steps: 14 })
    if (dbl) await this.page.mouse.click(toX, toY, { clickCount: 2 })
    else await this.page.mouse.click(toX, toY)
    this.mousePos = { x: toX, y: toY }
  }

  terminate() {
    this.terminated = true
    if (this.paused) {
      this.paused = false
      this.resumeResolve?.()
    }
    // 立即关闭 context，让正在 await 的 Playwright 操作抛 "Target closed" 错误快速退出
    // 避免用户点打断后还要等 page.goto 30s / page.click 5s 才返回
    if (this.context) {
      this.context.close().catch(() => {})
      // 注意：不置 null，让 run() 的 finally 块再次 await close()（幂等，no-op）
    }
  }

  pause() {
    this.paused = true
    // 推送暂停状态，前端可显示"已暂停"
    this.pushProgress({ stepIndex: -1, paused: true })
    updateHud({ scriptId: this.script.id, stepDescription: '已暂停，等待恢复执行…' })
  }

  resume() {
    this.paused = false
    this.resumeResolve?.()
    this.resumeResolve = null
    // 推送恢复状态
    this.pushProgress({ stepIndex: -1, paused: false })
    updateHud({ scriptId: this.script.id, stepDescription: '已恢复，继续执行下一步…' })
  }
}

/** 设置项取值夹到合法整数区间，避免空输入框/负数把重试次数变成 NaN 或无限循环 */
function clampInt(raw: unknown, min: number, max: number): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return min
  return Math.min(Math.max(n, min), max)
}

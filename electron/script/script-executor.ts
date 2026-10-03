/**
 * 脚本执行器 - 回放录制的操作步骤
 * 使用 Playwright 在真实浏览器中执行录制的步骤
 */
import type { BrowserContext, Page } from 'playwright'
import { BrowserManager } from '../browser/browser-manager'
import { getSettings } from '../config'
import { pushEvent } from '../ipc'
import { updateHud } from './hud-overlay'
import { insertLog } from '../db/repository'
import { notifyManualIntervention, notifyMonitorHit } from '../notify/notifier'
import { MonitorRunner } from '../vision/monitor-runner'
import { pushRunState } from '../window/mini-control'
import type {
  AntiDetectionSettings,
  MonitorStatus,
  RecordedStep,
  RecordedScript,
  RegionMonitor
} from '../../shared/types'
import {
  DEFAULT_STEP_DELAY,
  MAX_STEP_DELAY,
  REFRESH_MAX_MS,
  REFRESH_MIN_MS
} from '../../shared/constants'
import log from 'electron-log'

export class ScriptExecutor {
  private context: BrowserContext | null = null
  private page: Page | null = null
  private terminated = false
  private paused = false
  /** 监控命中后等待用户接管（区别于手动暂停：界面要走「接管」面板） */
  private takeover = false
  /** 用户按下的跳过/回退意图，在步骤边界生效（正在跑的这一步不打断） */
  private pendingJump = 0
  private resumeResolve: (() => void) | null = null
  /** 本次执行的设置快照：跑到一半用户改设置不会让同一次回放的行为前后不一致 */
  private anti: AntiDetectionSettings = { enabled: false, typingDelay: false, mouseTrace: false, randomDelay: false }
  private stepRetry = 0
  private timeout = 30000
  /** 即将执行（或正在执行）的步骤下标，跳过/回退的基准 */
  private currentIndex = 0
  private runner: MonitorRunner | null = null
  /** 最近一轮各监控项状态，迷你窗与进度事件用 */
  private lastStatuses: MonitorStatus[] = []

  constructor(
    public script: RecordedScript,
    public steps: RecordedStep[],
    public totalRuns: number,
    public currentRun: number,
    /** 脚本挂的屏幕/关键词监控项；为空表示这条脚本不做监控 */
    private readonly monitors: RegionMonitor[] = []
  ) {}

  /** 统一推送执行进度。Infinity 在 IPC 序列化时会变成 null，用 -1 表示无限循环 */
  private pushProgress(patch: { stepIndex: number; stepDescription?: string; stepStartedAt?: number; paused: boolean }) {
    const totalRuns = Number.isFinite(this.totalRuns) ? this.totalRuns : -1
    pushEvent('script:progress', {
      scriptId: this.script.id,
      currentRun: this.currentRun,
      totalRuns,
      totalSteps: this.steps.length,
      takeover: this.takeover,
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
    // 迷你控制窗只跟随「当前操作对象」那个脚本，其它并发脚本的进度不抢显示
    pushRunState(this.script.id, {
      phase: 'running',
      title: this.script.name,
      stepIndex: patch.stepIndex,
      totalSteps: this.steps.length,
      stepText: patch.stepDescription,
      paused: patch.paused,
      takeover: this.takeover,
      monitors: this.lastStatuses.map(s => ({
        id: s.monitorId,
        label: s.label,
        hit: s.hit,
        ratio: s.ratio
      }))
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
      this.trackPopups()

      // 超时读取设置项（browser.timeout），不再硬编码
      this.timeout = settings.browser.timeout
      this.page.setDefaultTimeout(this.timeout)

      await this.page.goto(this.script.targetUrl, { waitUntil: 'domcontentloaded', timeout: this.timeout })
      await this.page.waitForTimeout(1000)

      // 页面开起来之后再起巡检，基准文本才有内容可比
      this.startMonitors()

      this.currentIndex = 0
      while (this.currentIndex < this.steps.length) {
        if (this.terminated) {
          log.info(`[ScriptExecutor] 脚本 ${this.script.id} 执行被终止`)
          return false
        }

        await this.waitWhilePaused()
        if (this.terminated) return false

        // 跳过/回退在步骤边界生效：正在执行的这一步让它跑完，避免半途中断留下脏页面
        const jump = this.pendingJump
        if (jump !== 0) {
          this.pendingJump = 0
          this.currentIndex = Math.max(0, Math.min(this.steps.length, this.currentIndex + jump))
          continue
        }

        const i = this.currentIndex
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

        // 下标先推进再等间隔：正在等的这一段时间里，界面要显示「接下来要跑的那一步」，
        // 用户在这时候点跳过/看进度才对得上；等完再推进就会让显示比实际慢一步
        this.currentIndex = i + 1
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
      this.runner?.stop()
      this.runner = null
      if (this.context) {
        await this.context.close().catch(() => {})
        this.context = null
        this.page = null
      }
    }
  }

  /** 起区域监控：有监控项才建巡检器，命中即进入接管暂停 */
  private startMonitors() {
    if (this.monitors.length === 0) return
    this.runner = new MonitorRunner({
      monitors: this.monitors,
      readPageText: () => this.readPageText(),
      onHit: ({ monitor, status }) => this.requestTakeover(monitor, status),
      onTick: statuses => this.reportStatuses(statuses)
    })
    this.runner.start()
  }

  /** 巡检结果：合并进本地状态表再整包推给界面（只有命中项带热区，常态负载很小） */
  private reportStatuses(statuses: MonitorStatus[]): void {
    for (const status of statuses) {
      const idx = this.lastStatuses.findIndex(s => s.monitorId === status.monitorId)
      if (idx === -1) this.lastStatuses.push(status)
      else this.lastStatuses[idx] = status
    }
    pushEvent('monitor:status', { scriptId: this.script.id, statuses })
  }

  private readMonitor(id: string): RegionMonitor | undefined {
    return this.monitors.find(m => m.id === id)
  }

  /** 命中即暂停：当前这一步跑完就停在步骤边界，等用户选择继续/跳过/终止 */
  private requestTakeover(monitor: RegionMonitor, status: MonitorStatus): void {
    this.takeover = true
    this.paused = true
    pushEvent('monitor:hit', {
      scriptId: this.script.id,
      monitorId: monitor.id,
      label: monitor.label,
      ratio: status.ratio,
      appeared: status.appeared ?? [],
      disappeared: status.disappeared ?? [],
      snapshot: status.snapshot,
      blocks: status.blocks,
      blocksX: status.blocksX,
      blocksY: status.blocksY,
      at: Date.now()
    })
    notifyMonitorHit(this.script.name, monitor.label)
    this.safeInsertLog(`监控「${monitor.label}」检测到数据变化，已暂停等待接管`)
    this.pushProgress({
      stepIndex: this.currentIndex,
      stepDescription: `等待接管：${monitor.label} 数据有变化`,
      paused: true
    })
  }

  /** 读当前页面正文给关键词比对用；页面关了或还没渲染完就返回 null */
  private async readPageText(): Promise<string | null> {
    if (!this.page || this.page.isClosed()) return null
    try {
      return await this.page.evaluate(() => document.body?.innerText ?? '')
    } catch {
      return null
    }
  }

  /**
   * 页面点击弹出的新窗口（target=_blank、window.open）自动接成当前操作对象。
   * 不接管的话后续步骤仍打在已经看不见的旧页面上，用户只会觉得「点了没反应」。
   * 新窗口同样落在同一个 context 里，屏幕区域监控天然覆盖得到。
   */
  private trackPopups(): void {
    if (!this.context) return
    const context = this.context
    context.on('page', popup => {
      popup.setDefaultTimeout(this.timeout)
      popup.on('close', () => {
        if (this.page !== popup) return
        const remaining = context.pages().filter(p => !p.isClosed())
        this.page = remaining[remaining.length - 1] ?? null
        log.info(`[ScriptExecutor] 脚本 ${this.script.id} 的弹出页已关闭，操作对象回到${this.page ? '剩余页面' : '无可用页面'}`)
      })
      this.page = popup
      log.info(`[ScriptExecutor] 脚本 ${this.script.id} 切换到新弹出的页面: ${popup.url()}`)
    })
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
        await this.waitInterruptible(600 * attempt)
        // 重试等待期间用户按了「跳过本步」：这一步明显没戏了，剩下的尝试直接放弃。
        // 跳过在这一步兑现，标志必须清掉，否则步骤边界会再跳一次，连带把下一步也跳了
        if (this.pendingJump !== 0) {
          this.pendingJump = 0
          const reason = lastErr instanceof Error ? lastErr.message : String(lastErr)
          log.warn(`[ScriptExecutor] 步骤「${stepDescription}」重试中被用户跳过:`, reason)
          this.safeInsertLog(`步骤「${stepDescription}」重试期间被跳过，最后一次错误: ${reason}`)
          return
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  /** 步骤间等待：本步执行完等 delayBefore（默认 DEFAULT_STEP_DELAY）再下一步；开启随机延迟时在 ±30% 内抖动 */
  private async waitBeforeNextStep(step: RecordedStep) {
    if (!this.page) return
    // 上限与步骤编辑框一致：超出按上限等，避免误填的离谱数字把脚本卡死
    const base = Math.min(step.delayBefore ?? DEFAULT_STEP_DELAY, MAX_STEP_DELAY)
    const ms = this.anti.enabled && this.anti.randomDelay
      ? Math.round(base * (0.7 + Math.random() * 0.6))
      : base
    await this.waitInterruptible(Math.max(50, ms))
  }

  /**
   * 可被终止/暂停/跳过打断的等待，且暂停期间不计时。
   * 直接 await page.waitForTimeout 会让「跳过本步」等到延迟结束才生效，
   * 刷新步骤更要等 30~60 秒，期间用户点终止不能干等。
   * 暂停也不能把这段等待算进去：接管半天之后回来，页面会在没有任何预兆的情况下被刷掉。
   */
  private async waitInterruptible(ms: number): Promise<void> {
    let remaining = Math.max(0, ms)
    while (remaining > 0 && !this.terminated && this.pendingJump === 0) {
      const started = Date.now()
      await new Promise(resolve => setTimeout(resolve, Math.min(100, remaining)))
      if (!this.paused) remaining -= Date.now() - started
    }
  }

  private async waitWhilePaused() {
    while (this.paused) {
      await new Promise<void>(resolve => { this.resumeResolve = resolve })
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
      case 'refresh': {
        // 刷新前先随机等 30~60 秒：每次都卡同一秒的间隔太规整，容易被判成脚本
        const { min, max } = parseRefreshRange(step.value)
        const ms = min + Math.floor(Math.random() * (max - min + 1))
        log.info(`[ScriptExecutor] 刷新步骤：随机等待 ${Math.round(ms / 1000)} 秒后 reload`)
        this.pushHudNote(`等待 ${Math.round(ms / 1000)} 秒后刷新页面…`)
        await this.waitInterruptible(ms)
        if (this.terminated) throw new Error('执行已终止')
        // 等待期间用户按了跳过：这一步就是不刷了。跳过意图在这里已经兑现，
        // 必须把标志吃掉，否则步骤边界会再跳一次，把下一步也一起跳掉
        if (this.pendingJump !== 0) {
          this.pendingJump = 0
          log.info('[ScriptExecutor] 刷新等待被用户跳过，本步不再刷新')
          break
        }
        await this.page.reload({ waitUntil: 'domcontentloaded' })
        break
      }
      case 'watch': {
        await this.runWatchStep(step.value)
        break
      }
      default:
        log.warn(`[ScriptExecutor] 未知动作类型: ${step.action}`)
    }
  }

  /** 命中监控就进入接管暂停，这里等用户处理完（继续/跳过/终止）再往下走 */
  private async runWatchStep(monitorId: string | undefined): Promise<void> {
    if (!this.runner) {
      log.warn('[ScriptExecutor] 脚本没有配置监控区域，「监控检查」步骤已跳过')
      return
    }
    const ids = monitorId ? [monitorId] : undefined
    if (monitorId && !this.readMonitor(monitorId)) {
      log.warn(`[ScriptExecutor] 「监控检查」步骤指向的监控项 ${monitorId} 已不存在，改为全量巡检`)
    }
    // probe 内部已经走 onTick 回报状态，这里不再重复推一次
    await this.runner.probe(ids)
    await this.waitWhilePaused()
  }

  /** 只改浮窗文案，不动步骤下标（刷新等待、接管等待这类「还在本步」的提示） */
  private pushHudNote(text: string): void {
    updateHud({ scriptId: this.script.id, stepDescription: text })
    pushRunState(this.script.id, { stepText: text })
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
    this.takeover = false
    if (this.paused) {
      this.paused = false
      this.resumeResolve?.()
    }
    this.runner?.stop()
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
    this.pushProgress({ stepIndex: this.currentIndex, paused: true })
    updateHud({ scriptId: this.script.id, stepDescription: '已暂停，等待恢复执行…' })
  }

  resume() {
    this.paused = false
    // 接管暂停下点「继续」等同接管处理里的继续，不能留着 takeover 让界面一直显示等待接管
    this.takeover = false
    this.resumeResolve?.()
    this.resumeResolve = null
    // 推送恢复状态
    this.pushProgress({ stepIndex: this.currentIndex, paused: false })
    updateHud({ scriptId: this.script.id, stepDescription: '已恢复，继续执行下一步…' })
  }

  /**
   * 运行中热替换步骤列表。
   * 循环用的是「即将执行的步骤下标」而不是数组快照，换完列表下一轮自然按新列表走；
   * 新列表更短时下标越界，循环直接结束（等于提前收尾，不会越界取到 undefined）。
   */
  setSteps(steps: RecordedStep[]): void {
    this.steps = steps
    log.info(`[ScriptExecutor] 脚本 ${this.script.id} 步骤已热更新为 ${steps.length} 步`)
  }

  /** 跳过当前（即将执行的）这一步 */
  skipCurrentStep(): void {
    if (this.currentIndex >= this.steps.length) return
    this.pendingJump = 1
    // 正在等待间隔时立刻生效，不用等满一个 delayBefore
    this.resumeResolve?.()
  }

  /** 退回上一步重做（第一步没有「上一步」，忽略） */
  stepBack(): void {
    if (this.currentIndex <= 0) return
    this.pendingJump = -1
    this.resumeResolve?.()
  }

  /**
   * 监控命中后用户的选择：继续 / 跳过本步。
   * 「终止」不在这里处理：那要走 ScriptManager 的终止路径，才能连带结束整个多轮任务。
   */
  resolveTakeover(action: 'resume' | 'skip'): void {
    if (action === 'skip') this.skipCurrentStep()
    this.resume()
  }
}

/**
 * 解析刷新步骤的随机区间（value 形如 "30-60"，单位秒）。
 * 填错、只填一个数、填负数都退回默认 30~60 秒，不让一次手滑变成每 1 秒刷一次。
 */
function parseRefreshRange(value: string | undefined): { min: number; max: number } {
  const parts = (value ?? '').split(/[-~]/).map(s => Math.floor(Number(s.trim())) * 1000)
  const nums = parts.filter(n => Number.isFinite(n) && n >= 1000)
  if (nums.length === 0) return { min: REFRESH_MIN_MS, max: REFRESH_MAX_MS }
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  return { min, max: max > min ? max : min + 1000 }
}

/** 设置项取值夹到合法整数区间，避免空输入框/负数把重试次数变成 NaN 或无限循环 */
function clampInt(raw: unknown, min: number, max: number): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return min
  return Math.min(Math.max(n, min), max)
}

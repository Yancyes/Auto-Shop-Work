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
import type { RecordedStep, RecordedScript } from '../../shared/types'
import log from 'electron-log'

export class ScriptExecutor {
  private context: BrowserContext | null = null
  private page: Page | null = null
  private terminated = false
  private paused = false
  private resumeResolve: (() => void) | null = null

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
      const bm = BrowserManager.getInstance()
      this.context = await bm.createContext()
      this.page = await this.context.newPage()

      // 超时读取设置项（browser.timeout），不再硬编码
      const timeout = getSettings().browser.timeout
      this.page.setDefaultTimeout(timeout)

      await this.page.goto(this.script.targetUrl, { waitUntil: 'domcontentloaded', timeout })
      await this.page.waitForTimeout(1000)

      for (let i = 0; i < this.steps.length; i++) {
        if (this.terminated) {
          log.info(`[ScriptExecutor] 脚本 ${this.script.id} 执行被终止`)
          return false
        }

        while (this.paused) {
          await new Promise<void>(resolve => { this.resumeResolve = resolve })
        }

        const step = this.steps[i]
        const stepDescription = step.description || step.elementText || step.selector || step.action

        this.pushProgress({
          stepIndex: i,
          stepDescription,
          stepStartedAt: Date.now(),
          paused: this.paused
        })

        try {
          await this.executeStep(step)
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          log.error(`[ScriptExecutor] 步骤 ${i + 1} 执行失败:`, errorMsg)

          if (step.relativeX !== undefined && step.relativeY !== undefined) {
            log.info(`[ScriptExecutor] 尝试坐标回退: (${step.relativeX}, ${step.relativeY})`)
            try {
              await this.fallbackToCoordinates(step)
            } catch (fallbackErr) {
              pushEvent('script:stepError', {
                scriptId: this.script.id,
                stepIndex: i,
                error: errorMsg
              })
              insertLog({
                scriptId: this.script.id,
                level: 'error',
                message: `步骤 ${i + 1} 执行失败: ${errorMsg}`,
              })
              return false
            }
          } else {
            pushEvent('script:stepError', {
              scriptId: this.script.id,
              stepIndex: i,
              error: errorMsg
            })
            insertLog({
              scriptId: this.script.id,
              level: 'error',
              message: `步骤 ${i + 1} 执行失败: ${errorMsg}`,
            })
            return false
          }
        }

        if (step.delayBefore && step.delayBefore > 0 && step.delayBefore < 10000) {
          await this.page.waitForTimeout(step.delayBefore)
        } else {
          await this.page.waitForTimeout(300)
        }
      }

      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      log.error(`[ScriptExecutor] 执行异常:`, errorMsg)
      insertLog({
        scriptId: this.script.id,
        level: 'error',
        message: `执行异常: ${errorMsg}`,
      })
      return false
    } finally {
      if (this.context) {
        await this.context.close().catch(() => {})
        this.context = null
        this.page = null
      }
    }
  }

  private async executeStep(step: RecordedStep): Promise<void> {
    if (!this.page) throw new Error('页面未初始化')

    switch (step.action) {
      case 'click':
        await this.page.click(step.selector)
        break
      case 'dblclick':
        await this.page.dblclick(step.selector)
        break
      case 'fill':
        await this.page.fill(step.selector, step.value ?? '')
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

  private async fallbackToCoordinates(step: RecordedStep): Promise<void> {
    if (!this.page) throw new Error('页面未初始化')
    const viewport = this.page.viewportSize()
    if (!viewport) throw new Error('无法获取视口大小')

    const x = (step.relativeX ?? 0.5) * viewport.width
    const y = (step.relativeY ?? 0.5) * viewport.height
    await this.page.mouse.click(x, y)
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
    updateHud({ stepDescription: '已暂停，等待恢复执行…' })
  }

  resume() {
    this.paused = false
    this.resumeResolve?.()
    this.resumeResolve = null
    // 推送恢复状态
    this.pushProgress({ stepIndex: -1, paused: false })
    updateHud({ stepDescription: '已恢复，继续执行下一步…' })
  }
}

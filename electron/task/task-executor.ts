import type { TaskRecord, TaskStatus, TaskStep, ProductTemplate } from '../../shared/types'
import { updateTaskStatus, updateTaskProgress, updateTaskResult, localNowString } from '../db/repository'
import { BrowserManager } from '../browser/browser-manager'
import { PublishPage } from '../browser/pages/publish-page'
import { taskLog } from '../utils/logger'
import { pushEvent } from '../ipc'
import { getSettings } from '../config'
import type { BrowserContext } from 'playwright'

/** 任务执行步骤定义 */
export const TASK_STEPS: { step: TaskStep; label: string; progress: number }[] = [
  { step: 'init', label: '初始化', progress: 5 },
  { step: 'page_load', label: '页面加载', progress: 15 },
  { step: 'fill_product', label: '填写商品信息', progress: 35 },
  { step: 'set_attributes', label: '设置交易属性', progress: 55 },
  { step: 'pre_validate', label: '提交前校验', progress: 70 },
  { step: 'submit', label: '提交发布', progress: 85 },
  { step: 'manual_handle', label: '人工处理', progress: 85 },
  { step: 'result', label: '结果处理', progress: 100 }
]

/**
 * 任务执行器 - 单个任务的执行主体
 * 采用状态机模式逐步执行，每步记录日志、截图、推送进度
 */
export class TaskExecutor {
  private page: PublishPage | null = null
  private context: BrowserContext | null = null
  private paused = false
  private terminated = false
  private superseded = false
  private retryCount = 0
  private completed = false

  constructor(
    public task: TaskRecord,
    private onComplete: (taskId: number) => void
  ) {}

  /** 启动任务执行 */
  async run(): Promise<void> {
    try {
      await this.executeStep('init', async () => {
        taskLog(this.task.id, 'info', '任务初始化，创建浏览器上下文')
        // 使用 BrowserManager.createContext 确保反检测脚本注入
        this.context = await BrowserManager.getInstance().createContext()
        const page = await this.context.newPage()
        this.page = new PublishPage(page, this.task.id)
      })

      if (await this.checkState()) return

      await this.executeStep('page_load', async () => {
        await this.page!.navigate()
        // 登录检查
        const loggedIn = await this.page!.checkLogin()
        if (!loggedIn) {
          taskLog(this.task.id, 'warn', '检测到平台未登录，需要人工介入', { exceptionLevel: 'manual' })
          await this.handleManualIntervention('平台未登录，请手动登录后继续')
          return // 暂停等待人工处理
        }
      })

      if (await this.checkState()) return

      const template = JSON.parse(this.task.paramsSnapshot) as ProductTemplate

      await this.executeStep('fill_product', async () => {
        await this.page!.fillProductInfo(template)
      })

      if (await this.checkState()) return

      await this.executeStep('set_attributes', async () => {
        await this.page!.fillContactInfo(template)
        await this.page!.fillTradeAttributes(template)
      })

      if (await this.checkState()) return

      // 提交前三重校验
      let validated = false
      await this.executeStep('pre_validate', async () => {
        validated = await this.page!.preValidate()
      })

      if (await this.checkState()) return

      if (!validated) {
        throw new Error('三重校验未通过，终止发布')
      }

      // 提交发布
      await this.executeStep('submit', async () => {
        await this.page!.clickPublish()

        // 检测验证码
        const hasCaptcha = await this.page!.checkCaptcha()
        if (hasCaptcha) {
          taskLog(this.task.id, 'warn', '检测到验证码，需要人工处理', { exceptionLevel: 'manual' })
          await this.handleManualIntervention('检测到验证码，请手动完成后继续')
          return
        }
      })

      if (await this.checkState()) return

      // 结果处理
      await this.executeStep('result', async () => {
        const result = await this.page!.getResult()
        const screenshotPath = await this.page!.screenshot('result')

        if (result.success) {
          updateTaskStatus(this.task.id, 'success', undefined, this.nowString())
          updateTaskResult(this.task.id, screenshotPath)
          this.emitStatus('success')
          taskLog(this.task.id, 'info', `发布成功: ${result.message}`, { screenshotPath })
        } else {
          updateTaskStatus(this.task.id, 'failed', result.message, this.nowString())
          updateTaskResult(this.task.id, screenshotPath)
          this.emitStatus('failed', result.message)
          taskLog(this.task.id, 'error', `发布失败: ${result.message}`, { screenshotPath, exceptionLevel: 'medium' })
        }
      })

      this.finish()
    } catch (error) {
      await this.handleError(error as Error)
    }
  }

  /** 执行单个步骤 */
  private async executeStep(step: TaskStep, fn: () => Promise<void>): Promise<void> {
    const stepDef = TASK_STEPS.find(s => s.step === step)!
    updateTaskProgress(this.task.id, stepDef.progress, step)
    pushEvent('task:progress', { taskId: this.task.id, progress: stepDef.progress, step })

    await fn()

    if (this.page) {
      const screenshotPath = await this.page.screenshot(`step_${step}`)
      if (screenshotPath) {
        pushEvent('task:screenshot', { taskId: this.task.id, step, screenshotPath })
      }
    }
  }

  /** 等待暂停状态解除（用户 resume 或 terminate 后退出） */
  private async waitIfPaused(): Promise<void> {
    if (!this.paused) return
    taskLog(this.task.id, 'info', '任务已暂停，等待恢复...')
    await new Promise<void>(resolve => {
      const check = setInterval(() => {
        if (!this.paused || this.terminated) {
          clearInterval(check)
          resolve()
        }
      }, 500)
    })
  }

  /**
   * 检查终止/暂停状态
   * - terminated：清理资源并通知完成，返回 true 表示 run 应退出
   * - paused：阻塞等待恢复，恢复后若被终止则同样清理退出
   * 返回 false 表示可继续执行下一步
   */
  private async checkState(): Promise<boolean> {
    if (this.terminated) {
      this.handleTerminate()
      return true
    }
    if (this.paused) {
      await this.waitIfPaused()
      if (this.terminated) {
        this.handleTerminate()
        return true
      }
    }
    return false
  }

  /** 人工介入处理 */
  private async handleManualIntervention(reason: string): Promise<void> {
    updateTaskStatus(this.task.id, 'waiting_manual', reason)
    this.emitStatus('waiting_manual', reason)

    const screenshotPath = await this.page!.screenshot('manual')
    pushEvent('task:manualRequired', { taskId: this.task.id, reason, screenshotPath })

    this.paused = true
    // 等待人工处理后由 TaskManager 调用 resume()
    await new Promise<void>(resolve => {
      const check = setInterval(() => {
        if (!this.paused || this.terminated) {
          clearInterval(check)
          resolve()
        }
      }, 1000)
    })
  }

  /** 继续执行（人工处理完成后调用） */
  resume(): void {
    this.paused = false
    updateTaskStatus(this.task.id, 'running')
    this.emitStatus('running')
  }

  /** 暂停 */
  pause(): void {
    this.paused = true
    updateTaskStatus(this.task.id, 'paused')
    this.emitStatus('paused')
  }

  /** 终止 */
  terminate(): void {
    this.terminated = true
    this.paused = false
  }

  /** 标记为已取代（重试时调用，防止旧执行器的回调影响新执行器） */
  markSuperseded(): void {
    this.superseded = true
    this.terminated = true
    this.paused = false
  }

  /** 安全结束：清理浏览器上下文 + 通知 TaskManager */
  private finish(): void {
    if (this.completed) return
    this.completed = true
    this.cleanupContext()
    if (!this.superseded) {
      this.onComplete(this.task.id)
    }
  }

  private handleTerminate() {
    updateTaskStatus(this.task.id, 'failed', '任务已终止', this.nowString())
    this.emitStatus('failed', '任务已终止')
    this.finish()
  }

  /** 异常分级处理 */
  private async handleError(error: Error): Promise<void> {
    const message = error.message
    taskLog(this.task.id, 'error', `任务执行异常: ${message}`, { exceptionLevel: 'medium' })

    // 判断异常等级
    const isLight = message.includes('timeout') || message.includes('Network')
    const isHeavy = message.includes('Target closed') || message.includes('Browser closed')

    if (isLight && this.retryCount < getSettings().task.retryCount) {
      this.retryCount++
      taskLog(this.task.id, 'warn', `轻度异常，第${this.retryCount}次重试`, { exceptionLevel: 'light' })
      // 重试前清理旧上下文
      this.cleanupContext()
      await new Promise(r => setTimeout(r, 1000 * 2 ** this.retryCount))
      return this.run()
    }

    if (isHeavy) {
      taskLog(this.task.id, 'error', '重度异常：浏览器崩溃，重置浏览器', { exceptionLevel: 'heavy' })
      await BrowserManager.getInstance().destroy()
    }

    updateTaskStatus(this.task.id, 'failed', message, this.nowString())
    this.emitStatus('failed', message)
    this.finish()
  }

  /** 清理浏览器上下文，释放资源 */
  private cleanupContext(): void {
    if (this.context) {
      this.context.close().catch(() => {})
      this.context = null
      this.page = null
    }
  }

  /** 推送状态变更 */
  private emitStatus(status: TaskStatus, failReason?: string) {
    pushEvent('task:statusChange', { taskId: this.task.id, status, failReason })
  }

  /** 当前时间字符串（本地时间，与数据库一致） */
  private nowString(): string {
    return localNowString()
  }
}

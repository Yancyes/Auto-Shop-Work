import type { Browser, BrowserContext } from 'playwright'
import { getSettings } from '../config'
import { detectBrowser } from './browser-detect'
import { loadChromium } from './playwright-loader'
import log from 'electron-log'

/**
 * 浏览器管理器 - 单例模式
 * 全局维护一个浏览器实例，脚本执行时创建独立上下文
 */
export class BrowserManager {
  private static instance: BrowserManager
  private browser: Browser | null = null
  private launchPromise: Promise<void> | null = null
  private idleTimer: NodeJS.Timeout | null = null
  /** 启动代次：destroy 时递增，用于使进行中但迟到的 launch 失效，防止孤儿浏览器进程 */
  private launchGeneration = 0
  private static readonly IDLE_TIMEOUT = 5 * 60 * 1000 // 5分钟空闲休眠

  private constructor() {}

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager()
    }
    return BrowserManager.instance
  }

  /** 获取浏览器实例（懒初始化） */
  async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      if (!this.launchPromise) {
        const gen = ++this.launchGeneration
        // 只清理自己这一代：destroy 之后可能已经又发起了新的启动，无条件置空会误杀新 Promise
        const promise: Promise<void> = this.launch(gen).finally(() => {
          if (this.launchPromise === promise) this.launchPromise = null
        })
        this.launchPromise = promise
      }
      // 启动失败或被取消时，上面的 finally 已清空这个 Promise，下一次调用会重新启动
      await this.launchPromise
    }
    // launch 失败或被 destroy 打断时 browser 仍为 null，必须显式抛错，
    // 否则返回 undefined，下游 newContext 会炸出难以定位的 TypeError
    if (!this.browser || !this.browser.isConnected()) {
      throw new Error('浏览器启动失败或已断开连接，请重试')
    }
    this.clearIdleTimer()
    return this.browser
  }

  /** 启动浏览器 */
  private async launch(gen: number) {
    const settings = getSettings()
    const detected = await detectBrowser()
    if (detected.problem) {
      log.error('浏览器启动失败:', detected.problem)
      throw new Error(detected.problem)
    }
    log.info(`启动浏览器实例（来源: ${detected.source}，${detected.executablePath}）...`)

    const chromium = await loadChromium()
    const browser = await chromium.launch({
      headless: settings.browser.headless,
      executablePath: detected.executablePath,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--start-maximized'
      ]
    })

    // 启动期间有人调用了 destroy（代次已过期）→ 立即关闭这个迟到的实例，避免进程泄漏
    if (gen !== this.launchGeneration) {
      await browser.close().catch(() => {})
      throw new Error('浏览器启动已取消')
    }

    this.browser = browser
    browser.on('disconnected', () => {
      log.warn('浏览器实例断开连接')
      // 仅当断开的仍是当前实例时才置空，避免误清 destroy 后新启动的实例
      if (this.browser === browser) {
        this.browser = null
      }
    })
  }

  /** 创建脚本专用上下文（隔离 + 反检测） */
  async createContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser()
    const settings = getSettings()

    const context = await browser.newContext({
      viewport: settings.browser.viewport,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    })

    if (settings.antiDetection.enabled) {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5].map(() => ({
            name: 'Plugin',
            filename: 'plugin.dll',
            description: ''
          }))
        })
        Object.defineProperty(navigator, 'languages', {
          get: () => ['zh-CN', 'zh', 'en']
        })
      })
    }

    return context
  }

  /** 标记空闲，启动休眠倒计时 */
  scheduleIdleCheck() {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      log.info('浏览器空闲超时，自动休眠')
      this.destroy().catch(() => {})
    }, BrowserManager.IDLE_TIMEOUT)
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  /** 销毁浏览器实例 */
  async destroy() {
    this.clearIdleTimer()
    // 递增代次：使进行中的 launch 在完成时自我清理并抛错，不会留下孤儿进程
    this.launchGeneration++
    // 丢弃进行中的启动 Promise：否则 destroy 后立刻再取浏览器会复用这个注定失败的旧 Promise，
    // 用户看到的是「浏览器启动已取消」而不是重新启动
    this.launchPromise = null
    const browser = this.browser
    this.browser = null
    if (browser) {
      await browser.close().catch(() => {})
      log.info('浏览器实例已销毁')
    }
  }
}

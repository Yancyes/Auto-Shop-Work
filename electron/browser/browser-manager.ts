import { chromium, Browser, BrowserContext } from 'playwright'
import { getSettings } from '../config'
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
        this.launchPromise = this.launch(gen).finally(() => {
          this.launchPromise = null
        })
      }
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
    log.info('启动浏览器实例...')

    const browser = await chromium.launch({
      headless: settings.browser.headless,
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
    const browser = this.browser
    this.browser = null
    if (browser) {
      await browser.close().catch(() => {})
      log.info('浏览器实例已销毁')
    }
  }
}

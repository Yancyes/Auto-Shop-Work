import { chromium, Browser, BrowserContext } from 'playwright'
import { getSettings } from '../config'
import log from 'electron-log'
import type { ElementInfo } from '../../shared/types'

/**
 * 浏览器管理器 - 单例模式
 * 全局维护一个浏览器实例，多个任务复用，每个任务独立上下文
 */
export class BrowserManager {
  private static instance: BrowserManager
  private browser: Browser | null = null
  private launchPromise: Promise<void> | null = null
  private idleTimer: NodeJS.Timeout | null = null
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
        this.launchPromise = this.launch().finally(() => {
          this.launchPromise = null
        })
      }
      await this.launchPromise
    }
    this.clearIdleTimer()
    return this.browser!
  }

  /** 启动浏览器 */
  private async launch() {
    const settings = getSettings()
    log.info('启动浏览器实例...')

    this.browser = await chromium.launch({
      headless: settings.browser.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--start-maximized'
      ]
    })

    // 浏览器断开时清理
    this.browser.on('disconnected', () => {
      log.warn('浏览器实例断开连接')
      this.browser = null
    })
  }

  /** 创建任务专用上下文（隔离 + 共享登录态） */
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

    // 注入反检测脚本
    if (settings.antiDetection.enabled) {
      await context.addInitScript(() => {
        // 隐藏 webdriver 标识
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
        // 模拟真实插件
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5].map(() => ({
            name: 'Plugin',
            filename: 'plugin.dll',
            description: ''
          }))
        })
        // 模拟语言
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
    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
      log.info('浏览器实例已销毁')
    }
  }

  /** 获取所有活跃页面信息 */
  async getActivePages(): Promise<Array<{ id: string; url: string; title: string }>> {
    if (!this.browser || !this.browser.isConnected()) return []
    const contexts = this.browser.contexts()
    const pages: Array<{ id: string; url: string; title: string }> = []
    let index = 0
    for (const context of contexts) {
      for (const page of context.pages()) {
        pages.push({
          id: `page_${index++}`,
          url: page.url(),
          title: await page.title().catch(() => 'Untitled')
        })
      }
    }
    return pages
  }

  /** 截取指定页面截图 */
  async captureScreenshot(pageIndex: number): Promise<string | null> {
    if (!this.browser || !this.browser.isConnected()) return null
    const contexts = this.browser.contexts()
    let index = 0
    for (const context of contexts) {
      for (const page of context.pages()) {
        if (index === pageIndex) {
          const buffer = await page.screenshot({ type: 'jpeg', quality: 80 }).catch(() => null)
          if (buffer) {
            return `data:image/jpeg;base64,${buffer.toString('base64')}`
          }
        }
        index++
      }
    }
    return null
  }

  /** 进入元素拾取模式：高亮可交互元素并截图返回元素信息 */
  async pickElements(pageIndex: number): Promise<{ screenshot: string; elements: ElementInfo[] }> {
    const page = this.getTargetPage(pageIndex)

    await page.evaluate(() => {
      document.querySelectorAll('[data-picker-hl]').forEach(el => {
        (el as HTMLElement).style.outline = ''
      })
      document.querySelectorAll('.__picker-label').forEach(el => el.remove())
    })

    const elements = await page.evaluate(() => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const result: any[] = []
      const seen = new Set<Element>()

      const candidates = document.querySelectorAll(
        'a, button, input, select, textarea, [role="button"], [onclick], [data-v-md-e="click"], .el-button, .el-input__inner, .el-select, .el-radio, .el-checkbox'
      )

      let idx = 0
      for (const el of candidates) {
        const rect = el.getBoundingClientRect()
        if (rect.width < 5 || rect.height < 5) continue
        if (rect.right < 0 || rect.left > vw || rect.bottom < 0 || rect.top > vh) continue
        if (seen.has(el)) continue
        seen.add(el)

        const htmlEl = el as HTMLElement
        htmlEl.style.outline = '2px solid #409eff'
        htmlEl.setAttribute('data-picker-hl', '1')

        const label = document.createElement('div')
        label.className = '__picker-label'
        label.textContent = String(idx)
        Object.assign(label.style, {
          position: 'fixed',
          left: rect.left + 'px',
          top: rect.top + 'px',
          background: '#409eff',
          color: '#fff',
          fontSize: '11px',
          padding: '1px 5px',
          borderRadius: '3px',
          zIndex: '2147483647',
          pointerEvents: 'none',
          fontWeight: 'bold',
          lineHeight: '1.4'
        })
        document.body.appendChild(label)

        let sel = el.tagName.toLowerCase()
        if (el.id) sel += '#' + CSS.escape(el.id)
        if (el.className && typeof el.className === 'string') {
          sel += '.' + el.className.trim().split(/\s+/).map(c => CSS.escape(c)).join('.')
        }

        result.push({
          index: idx++,
          selector: sel,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().substring(0, 80),
          x: rect.left / vw,
          y: rect.top / vh,
          width: rect.width / vw,
          height: rect.height / vh
        })
      }
      return result
    })

    await new Promise(r => setTimeout(r, 200))

    const buffer = await page.screenshot({ type: 'jpeg', quality: 85 }).catch(() => null)
    const screenshot = buffer ? `data:image/jpeg;base64,${buffer.toString('base64')}` : ''

    return { screenshot, elements }
  }

  /** 点击拾取到的元素（按索引） */
  async pickClick(pageIndex: number, index: number): Promise<boolean> {
    const page = this.getTargetPage(pageIndex)
    return page.evaluate((idx: number) => {
      const candidates = document.querySelectorAll('[data-picker-hl]')
      const el = candidates[idx] as HTMLElement | undefined
      if (!el) return false
      el.scrollIntoView({ block: 'center' })
      el.click()
      return true
    }, index)
  }

  /** 退出元素拾取模式：清除高亮 */
  async pickExit(pageIndex: number): Promise<boolean> {
    const page = this.getTargetPage(pageIndex)
    await page.evaluate(() => {
      document.querySelectorAll('[data-picker-hl]').forEach(el => {
        (el as HTMLElement).style.outline = ''
        el.removeAttribute('data-picker-hl')
      })
      document.querySelectorAll('.__picker-label').forEach(el => el.remove())
    })
    return true
  }

  /** 在指定页面执行操作 */
  async executeOnPage(pageIndex: number, action: string, params: any): Promise<any> {
    if (!this.browser || !this.browser.isConnected()) throw new Error('浏览器未连接')
    const contexts = this.browser.contexts()
    let index = 0
    for (const context of contexts) {
      for (const page of context.pages()) {
        if (index === pageIndex) {
          switch (action) {
            case 'click':
              await page.click(params.selector)
              return { success: true }
            case 'fill':
              await page.fill(params.selector, params.value)
              return { success: true }
            case 'navigate':
              await page.goto(params.url)
              return { success: true }
            case 'press':
              await page.keyboard.press(params.key)
              return { success: true }
            case 'scroll':
              await page.evaluate((direction: string) => {
                window.scrollBy(0, direction === 'down' ? 300 : -300)
              }, params.direction || 'down')
              return { success: true }
            case 'evaluate':
              return await page.evaluate(params.script)
            default:
              throw new Error(`未知操作: ${action}`)
          }
        }
        index++
      }
    }
    throw new Error('页面未找到')
  }

  /** 根据索引获取页面对象 */
  private getTargetPage(pageIndex: number) {
    if (!this.browser || !this.browser.isConnected()) throw new Error('浏览器未连接')
    const contexts = this.browser.contexts()
    let index = 0
    for (const context of contexts) {
      for (const page of context.pages()) {
        if (index === pageIndex) return page
        index++
      }
    }
    throw new Error('页面未找到')
  }
}

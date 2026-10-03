/**
 * 屏幕轨录制会话：在 Playwright 启动的受控浏览器里录步骤
 *
 * 主窗口收成迷你窗后，内嵌 webview 是看不见的，用户只能操作这个真实浏览器窗口，
 * 所以这条轨道的采集脚本要由主进程注入、采集结果由主进程回传，渲染层只负责累积步骤。
 *
 * 采集脚本走 context.addInitScript：这样用户点出新标签/新窗口时，
 * 新页面天生带采集器，不用再手工补注入（子窗口监控同理走 context.on('page')）。
 */
import type { BrowserContext, Page } from 'playwright'
import log from 'electron-log'
import { RECORDER_INJECT_SCRIPT } from '../../shared/recorder-inject'
import type { RecordedStep } from '../../shared/types'
import { BrowserManager } from '../browser/browser-manager'
import { pushEvent } from '../ipc'

const PREFIX = '__RECORD__:'

interface RuntimePage {
  page: Page
  /** 同一个页面重复收到同一条时只报一次（防抖与 change 会撞车） */
  lastKey: string
}

class RecordSession {
  private context: BrowserContext | null = null
  private watched = new Set<Page>()
  private stepId = 0
  private lastKey = ''
  private active = false

  isRecording(): boolean {
    return this.active
  }

  /** 开始录制：起一个独立上下文并打开目标地址 */
  async start(targetUrl: string): Promise<void> {
    if (this.active) throw new Error('已有录制会话在进行中，请先结束录制')

    const context = await BrowserManager.getInstance().createContext()
    this.context = context
    this.stepId = 0
    this.lastKey = ''
    this.watched.clear()
    this.active = true

    // addInitScript 对之后新建的每个页面都生效，包括用户点出来的新窗口
    try {
      await context.addInitScript(RECORDER_INJECT_SCRIPT)
      context.on('page', page => this.track(page))

      const page = await context.newPage()
      this.track(page)
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(err => {
        log.warn('[record] 打开目标地址失败，仍可继续录制页内操作:', err)
      })
    } catch (err) {
      // 启动半途失败必须整段回滚：active 一直挂着的话，之后每次点录制都只会得到
      // 「已有录制会话在进行中」，用户除了重启应用没有别的出路
      log.error('[record] 录制启动失败，已回滚:', err)
      await this.stop()
      throw err instanceof Error ? err : new Error(String(err))
    }
    log.info(`[record] 录制开始：${targetUrl}`)
    pushEvent('record:state', { recording: true })
  }

  /** 结束录制：关掉上下文，浏览器实例交给空闲休眠，不影响后续执行 */
  async stop(): Promise<void> {
    if (!this.active) return
    this.active = false
    const context = this.context
    this.context = null
    this.watched.clear()
    if (context) {
      await context.close().catch(() => {})
    }
    BrowserManager.getInstance().scheduleIdleCheck()
    log.info(`[record] 录制结束，共 ${this.stepId} 步`)
    pushEvent('record:state', { recording: false })
  }

  private track(page: Page) {
    if (this.watched.has(page)) return
    this.watched.add(page)
    const runtime: RuntimePage = { page, lastKey: '' }

    page.on('console', msg => {
      if (msg.type() !== 'log') return
      const text = msg.text()
      if (!text.startsWith(PREFIX)) return
      this.emitStep(text.slice(PREFIX.length), runtime)
    })

    // 新窗口/新标签由 context.on('page') 统一接管（同一个上下文，弹出来的页也带采集器）
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame() || !this.active) return
      const url = frame.url()
      if (!url || url === 'about:blank') return
      this.push({ id: ++this.stepId, action: 'navigate', selector: '', value: url, description: `页面导航: ${url.slice(0, 40)}` })
    })
  }

  private emitStep(rawJson: string, runtime: RuntimePage) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(rawJson) as Record<string, unknown>
    } catch {
      return
    }
    if (parsed?.__record !== true) return

    const action = String(parsed.action ?? '')
    const selector = String(parsed.selector ?? '')
    const value = parsed.value === undefined || parsed.value === null ? undefined : String(parsed.value)
    const key = `${action}|${selector}|${value ?? ''}`
    // 相邻重复的同一动作直接丢：input+change+blur 三连会各报一次同样的 fill
    if (key === runtime.lastKey || key === this.lastKey) return
    runtime.lastKey = key
    this.lastKey = key

    this.push({
      id: ++this.stepId,
      action: action as RecordedStep['action'],
      selector,
      value,
      tagName: parsed.tagName ? String(parsed.tagName) : undefined,
      elementText: parsed.elementText ? String(parsed.elementText) : undefined,
      description: parsed.description ? String(parsed.description) : undefined
    })
  }

  private push(step: RecordedStep) {
    pushEvent('record:step', step)
  }
}

let session: RecordSession | null = null

export function getRecordSession(): RecordSession {
  if (!session) session = new RecordSession()
  return session
}

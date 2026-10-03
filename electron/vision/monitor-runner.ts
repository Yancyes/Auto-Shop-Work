/**
 * 区域监控器：把「屏幕区域像素变化」和「页面关键词」两路判定合成一个可暂停的巡检循环
 *
 * 设计要点：
 * - 一个循环管多条监控项，每轮按显示器分组抓屏（同屏多块区域共用一次抓图），
 *   各项按自己的 intervalMs 决定是否到点，避免一条 300ms 的监控拖着别的狂抓。
 * - 像素判定必须有基准图；关键词判定必须有页面文本来源。两者都不可用的监控项
 *   只报一次「测不了」，不把「测不了」当成「一切正常」。
 * - 命中不自己停脚本，只回调出去，由 ScriptManager 决定暂停、通知还是仅记日志。
 * - 同一状态持续命中不重复打断：命中后置位，必须等它回到正常才允许再次触发。
 */
import log from 'electron-log'
import { DEFAULT_MONITOR_INTERVAL_MS } from '../../shared/constants'
import { diffBgra, matchKeywords, normalizeText } from '../../shared/pixel-diff'
import type { MonitorStatus, RegionMonitor } from '../../shared/types'
import { cropFrame, displayForRect, grabDisplay, readBaseline, toDataUrl, type BgraFrame } from './capture'

export interface MonitorHitInfo {
  monitor: RegionMonitor
  status: MonitorStatus
}

export interface MonitorRunnerOptions {
  monitors: RegionMonitor[]
  /** 读当前页面文本；返回 null 表示此刻没有可用页面（浏览器还没起来或已关闭） */
  readPageText: () => Promise<string | null>
  /** 命中（达到阈值或关键词变化）时回调 */
  onHit: (info: MonitorHitInfo) => void
  /** 每轮结果回调，界面据此刷新热区与预览 */
  onTick?: (statuses: MonitorStatus[]) => void
}

interface MonitorRuntime {
  monitor: RegionMonitor
  /** 上次是否处于命中态，用于识别「从命中翻回正常」 */
  lastHit: boolean
  /** 关键词比对的基准文本，首轮读到后固定，命中后推进 */
  baselineText: string | null
  nextCheckAt: number
  /** 不可用原因只报一次，不刷屏 */
  warned: boolean
}

export class MonitorRunner {
  private timer: NodeJS.Timeout | null = null
  private readonly runtimes: MonitorRuntime[]
  private running = false
  private busy = false

  constructor(private readonly options: MonitorRunnerOptions) {
    this.runtimes = options.monitors.map(monitor => ({
      monitor,
      lastHit: false,
      baselineText: null,
      nextCheckAt: 0,
      warned: false
    }))
  }

  get active(): boolean {
    return this.running
  }

  start(): void {
    if (this.running || this.runtimes.length === 0) return
    this.running = true
    this.timer = setInterval(() => void this.tick(), this.tickStepMs())
    // 立即跑一轮，界面马上有第一帧，而不是空等一个间隔
    void this.tick()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 最快的监控项决定主循环节拍，再夹到 200ms 以上，避免定时器过密 */
  private tickStepMs(): number {
    const min = Math.min(...this.runtimes.map(r => r.monitor.intervalMs ?? DEFAULT_MONITOR_INTERVAL_MS))
    return Math.max(200, Math.min(min, DEFAULT_MONITOR_INTERVAL_MS))
  }

  /**
   * 立刻跑一轮（步骤级检查点用）：可只测指定监控项。
   * 与定时巡检共用命中判定，所以命中一样会走 onHit 回调 —— 检查点的意义就是
   * 「到这里必须确认一次数据有没有变」，而不是让用户自己去看返回值。
   */
  async probe(ids?: string[]): Promise<MonitorStatus[]> {
    const targets = ids && ids.length > 0
      ? this.runtimes.filter(r => ids.includes(r.monitor.id))
      : this.runtimes
    if (targets.length === 0) return []
    const statuses = await this.collect(targets)
    this.options.onTick?.(statuses)
    this.detectHits(targets, statuses)
    return statuses
  }

  private async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const now = Date.now()
      const due = this.runtimes.filter(r => now >= r.nextCheckAt)
      if (due.length === 0) return
      const statuses = await this.collect(due)
      if (statuses.length > 0) this.options.onTick?.(statuses)
      this.detectHits(due, statuses)
    } catch (err) {
      log.warn('[monitor] 巡检异常:', err)
    } finally {
      this.busy = false
    }
  }

  private detectHits(targets: MonitorRuntime[], statuses: MonitorStatus[]): void {
    for (const runtime of targets) {
      const status = statuses.find(s => s.monitorId === runtime.monitor.id)
      const hit = !!status?.hit
      if (hit && !runtime.lastHit && runtime.monitor.onChange !== 'log') {
        this.options.onHit({ monitor: runtime.monitor, status: status! })
      }
      runtime.lastHit = hit
    }
  }

  /** 跑一轮指定监控项；抓屏按显示器缓存，同屏多区域只抓一次 */
  private async collect(targets: MonitorRuntime[]): Promise<MonitorStatus[]> {
    const now = Date.now()
    targets.forEach(r => {
      r.nextCheckAt = now + (r.monitor.intervalMs ?? DEFAULT_MONITOR_INTERVAL_MS)
    })

    const frames = new Map<number, BgraFrame>()
    const statuses: MonitorStatus[] = []
    for (const runtime of targets) {
      const status = await this.checkOne(runtime, frames)
      if (status) statuses.push(status)
    }
    return statuses
  }

  /** 返回 null 表示这条监控项本轮测不了（缺基准图 / 没有页面文本） */
  private async checkOne(runtime: MonitorRuntime, frames: Map<number, BgraFrame>): Promise<MonitorStatus | null> {
    const { monitor } = runtime
    const status: MonitorStatus = {
      monitorId: monitor.id,
      label: monitor.label,
      ratio: 0,
      hit: false,
      checkedAt: Date.now()
    }

    const needsPixels = monitor.source !== 'page'
    const needsText = monitor.source !== 'screen'
    const pixelsOk = needsPixels ? await this.checkPixels(runtime, frames, status) : false
    const textOk = needsText ? await this.checkKeywords(runtime, status) : false

    if (!pixelsOk && !textOk) {
      if (!runtime.warned) {
        runtime.warned = true
        log.warn(
          `[monitor] 「${monitor.label}」暂时测不了：` +
            (needsPixels ? '缺少基准截图（先框选区域并截基准）。' : '') +
            (needsText ? ' 缺少页面文本或关键词。' : '')
        )
      }
      return null
    }
    runtime.warned = false
    return status
  }

  private async checkPixels(
    runtime: MonitorRuntime,
    frames: Map<number, BgraFrame>,
    status: MonitorStatus
  ): Promise<boolean> {
    return measurePixels(runtime.monitor, status, frames, message => {
      if (runtime.warned) return
      runtime.warned = true
      log.warn(message)
    })
  }

  private async checkKeywords(runtime: MonitorRuntime, status: MonitorStatus): Promise<boolean> {
    const { monitor } = runtime
    const appear = monitor.appear ?? []
    const disappear = monitor.disappear ?? []
    if (appear.length === 0 && disappear.length === 0) return false

    const raw = await this.options.readPageText()
    if (raw === null) return false
    const current = normalizeText(raw)
    if (runtime.baselineText === null) {
      runtime.baselineText = current
      return true
    }

    const hit = matchKeywords(current, runtime.baselineText, { appear, disappear })
    status.appeared = hit.appeared
    status.disappeared = hit.disappeared
    status.hit = status.hit || hit.hit
    // 命中后把基准文本推进到当前值，否则同一条变化会在每轮重复命中
    if (hit.hit) runtime.baselineText = current
    return true
  }
}

/**
 * 屏幕区域与基准图比对一次。
 * frames 是本轮的整屏位图缓存（同屏多块区域共用一张图），界面「立即测一次」
 * 传个新 Map 就够了，不必为了一次预览起整套巡检。
 * 返回 false 表示这块区域量不了（没框选 / 没基准图 / 抓屏失败）。
 */
async function measurePixels(
  monitor: RegionMonitor,
  status: MonitorStatus,
  frames: Map<number, BgraFrame>,
  warn: (message: string) => void
): Promise<boolean> {
  if (!monitor.rect) return false
  const baseline = readBaseline(monitor.id)
  if (!baseline) return false

  const display = displayForRect(monitor.rect)
  let frame = frames.get(display.id)
  if (!frame) {
    try {
      frame = await grabDisplay(display)
    } catch (err) {
      warn(`[monitor] 抓屏失败: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
    frames.set(display.id, frame)
  }

  const region = cropFrame(frame, monitor.rect, display)
  if (region.width !== baseline.width || region.height !== baseline.height) {
    warn(`[monitor] 「${monitor.label}」区域尺寸与基准图不一致（显示器缩放改过？），需要重新截基准`)
    return false
  }

  const diff = diffBgra(baseline.bitmap, region.bitmap, region.width, region.height, {
    hitRatio: monitor.hitRatio
  })
  status.ratio = diff.ratio
  // 或运算而不是赋值：关键词判定可能已经把这一轮标成命中，像素这边没变不能把它抹掉
  status.hit = status.hit || diff.hit
  // 热区与截图只在命中时回传：每秒推几万块状态和一张 PNG 只会把 IPC 与界面刷爆
  if (diff.hit) {
    status.blocks = Array.from(diff.blocks)
    status.blocksX = diff.blocksX
    status.blocksY = diff.blocksY
    status.snapshot = toDataUrl(region)
  }
  return true
}

/**
 * 界面「立即测一次」：不起巡检器，只按当前设置比一轮像素。
 * 关键词判定要靠脚本执行时读到的页面文本，配置阶段没有这个来源，
 * 所以测不了的东西必须写进 note —— 否则会显示成「未达阈值」，
 * 用户以为监控没问题，实际那次试测什么都没判定。
 */
export async function probeOnce(monitor: RegionMonitor): Promise<MonitorStatus> {
  const status: MonitorStatus = {
    monitorId: monitor.id,
    label: monitor.label,
    ratio: 0,
    hit: false,
    checkedAt: Date.now()
  }
  if (monitor.source === 'page') {
    status.note = '关键词要等脚本执行时读页面文本才能判定，这次试测没有比对任何内容'
    return status
  }
  const measured = await measurePixels(monitor, status, new Map(), message => log.info(message))
  if (!measured) {
    status.note = '这块区域现在测不出像素变化：先确认已框选区域并截了基准图'
  }
  return status
}

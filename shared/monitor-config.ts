/**
 * 屏幕区域监控的配置解析与默认值（纯逻辑，主进程与渲染层共用一套规则）
 *
 * 存库形态是 RegionMonitor[] 的 JSON。老脚本、手工改库、渲染层传来的半成品
 * 都可能缺字段，所以读取一律走 normalize，禁止把外部 JSON 直接当可信结构用。
 */
import {
  DEFAULT_MONITOR_HIT_RATIO,
  DEFAULT_MONITOR_INTERVAL_MS,
  MAX_MONITOR_INTERVAL_MS,
  MIN_MONITOR_INTERVAL_MS
} from './constants'
import type { MonitorSourceKind, RegionMonitor, ScreenRect } from './types'

export const EMPTY_MONITORS_JSON = ''

const SOURCES: MonitorSourceKind[] = ['screen', 'page', 'auto']

/** 比例类字段统一夹到 0..1，NaN/空串回落默认值 */
function ratio(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

function intRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(v => String(v ?? '').trim()).filter(Boolean)
}

function rect(value: unknown): ScreenRect | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const x = Math.round(Number(raw.x))
  const y = Math.round(Number(raw.y))
  const width = Math.round(Number(raw.width))
  const height = Math.round(Number(raw.height))
  if (![x, y, width, height].every(Number.isFinite)) return undefined
  if (width <= 0 || height <= 0) return undefined
  return { x, y, width, height }
}

/** 补全一条监控项：界面新增时只给了 id/label，其余字段在这里给默认值 */
export function normalizeMonitor(raw: unknown): RegionMonitor | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const id = String(value.id ?? '').trim()
  if (!id) return null
  const source = SOURCES.includes(value.source as MonitorSourceKind)
    ? (value.source as MonitorSourceKind)
    : 'screen'
  const onChange = value.onChange === 'log' ? 'log' : 'pause'
  return {
    id,
    label: String(value.label ?? '').trim() || `区域 ${id}`,
    rect: rect(value.rect),
    source,
    appear: stringList(value.appear),
    disappear: stringList(value.disappear),
    hitRatio: ratio(value.hitRatio, DEFAULT_MONITOR_HIT_RATIO),
    intervalMs: intRange(value.intervalMs, DEFAULT_MONITOR_INTERVAL_MS, MIN_MONITOR_INTERVAL_MS, MAX_MONITOR_INTERVAL_MS),
    onChange,
    baselineFile: typeof value.baselineFile === 'string' ? value.baselineFile : undefined
  }
}

/** 解析监控列表：坏 JSON、对象而非数组、字段缺失都不会抛错 */
export function parseMonitors(json?: string | null): RegionMonitor[] {
  if (!json) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeMonitor).filter((m): m is RegionMonitor => m !== null)
}

export function serializeMonitors(monitors: RegionMonitor[]): string {
  return monitors.length === 0 ? EMPTY_MONITORS_JSON : JSON.stringify(monitors)
}

/**
 * 保存前的必填校验：屏幕来源必须已框选区域，关键词来源必须至少有一个词，
 * 否则执行时不可能命中，界面应当在保存时就拦下来而不是运行时静默无效
 */
export function monitorProblems(monitor: RegionMonitor): string[] {
  const problems: string[] = []
  const needsRect = monitor.source !== 'page'
  if (needsRect && !monitor.rect) problems.push('还没有框选屏幕区域')
  const keywords = [...(monitor.appear ?? []), ...(monitor.disappear ?? [])]
  if (monitor.source !== 'screen' && keywords.length === 0) problems.push('页面来源至少填一个关键词')
  if (needsRect && monitor.rect && monitor.rect.width < 16) problems.push('区域太窄，像素比对没有意义')
  return problems
}

/** 命中原因的文案，监控日志与接管弹窗共用 */
export function describeHit(monitor: RegionMonitor, appeared: string[], disappeared: string[]): string {
  const parts: string[] = []
  if (appeared.length > 0) parts.push(`出现「${appeared.join('、')}」`)
  if (disappeared.length > 0) parts.push(`「${disappeared.join('、')}」消失`)
  if (parts.length === 0) return `${monitor.label} 画面变化达到阈值`
  return `${monitor.label} ${parts.join('，')}`
}

/** 一个脚本可用的监控项 id（步骤里 watch 动作要引用它） */
export function monitorIds(json?: string | null): string[] {
  return parseMonitors(json).map(m => m.id)
}

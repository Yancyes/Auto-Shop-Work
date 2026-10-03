/**
 * 渲染进程共享工具函数
 */
import type { RecordedAction, RecordedStep } from '../../shared/types'

export type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

/** 脚本状态 → 标签映射 */
export const SCRIPT_STATUS_MAP: Record<string, { label: string; type: TagType }> = {
  draft: { label: '草稿', type: 'info' },
  ready: { label: '就绪', type: 'primary' },
  running: { label: '运行中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  failed: { label: '失败', type: 'danger' }
}

/** 日志级别 → 标签类型 */
export const LOG_LEVEL_TAG: Record<string, TagType | undefined> = {
  info: 'info',
  warn: 'warning',
  error: 'danger',
  debug: undefined
}

/** 录制动作 → 标签（步骤编辑器与脚本卡片共用一份，避免两处各写一遍） */
export const ACTION_LABELS: Record<string, string> = {
  click: '点击',
  dblclick: '双击',
  fill: '输入',
  select: '选择',
  keypress: '按键',
  scroll: '滚动',
  navigate: '导航',
  wait: '等待',
  refresh: '刷新页面',
  watch: '监控检查点'
}

/** 步骤编辑器的动作下拉：顺序即界面顺序，「刷新/监控」放在末尾 */
export const ACTION_OPTIONS: { label: string; value: RecordedAction }[] = Object.entries(
  ACTION_LABELS
).map(([value, label]) => ({ value: value as RecordedAction, label }))

/** 日期字符串格式化（YYYY-MM-DD） */
export function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

/** 解析脚本的 stepsJson：历史数据可能不是合法 JSON 或不是数组，一律降级为空列表 */
export function parseScriptSteps(stepsJson?: string): RecordedStep[] {
  try {
    const steps = JSON.parse(stepsJson || '[]')
    return Array.isArray(steps) ? steps : []
  } catch {
    return []
  }
}

/** 秒数格式化为「X分Y秒」 */
export function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const r = seconds % 60
  return m > 0 ? `${m}分${r}秒` : `${r}秒`
}

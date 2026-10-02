/**
 * 渲染进程共享工具函数
 */

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

/** 录制动作 → 标签 */
export const ACTION_LABELS: Record<string, string> = {
  click: '点击',
  dblclick: '双击',
  fill: '输入',
  select: '选择',
  keypress: '按键',
  scroll: '滚动',
  navigate: '导航',
  wait: '等待'
}

/** 将本地 Windows 路径转换为可用的 file:// URL */
export function screenshotUrl(path: string): string {
  return 'file:///' + path.replace(/\\/g, '/').replace(/^\/+/, '')
}

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

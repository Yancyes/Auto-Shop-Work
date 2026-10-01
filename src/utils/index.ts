/**
 * 渲染进程共享工具函数
 */

export type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

/** 任务状态 → 标签映射 */
export const STATUS_MAP: Record<string, { label: string; type: TagType }> = {
  pending: { label: '等待中', type: 'info' },
  running: { label: '运行中', type: 'primary' },
  paused: { label: '已暂停', type: 'warning' },
  success: { label: '已完成', type: 'success' },
  failed: { label: '失败', type: 'danger' },
  waiting_manual: { label: '待人工', type: 'warning' }
}

/** 日志级别 → 标签类型 */
export const LOG_LEVEL_TAG: Record<string, TagType | undefined> = {
  info: 'info',
  warn: 'warning',
  error: 'danger',
  debug: undefined
}

/** 任务执行步骤中文标签（与后端 TaskStep 枚举对应） */
export const STEP_LABELS: Record<string, string> = {
  init: '初始化',
  page_load: '页面加载',
  fill_product: '填写商品',
  set_attributes: '设置属性',
  pre_validate: '三重校验',
  submit: '提交发布',
  manual_handle: '人工处理',
  result: '结果处理'
}

/** 将本地 Windows 路径转换为可用的 file:// URL（供 <img :src> 使用） */
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

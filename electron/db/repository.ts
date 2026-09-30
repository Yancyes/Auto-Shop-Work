import { getDb } from './index'
import type { ProductTemplate, TaskRecord, RunLog, TaskStatus, LogLevel } from '../../shared/types'

// ========== 行映射工具（snake_case → camelCase）==========

/** 数据库行类型（snake_case 列名） */
interface TemplateRow {
  id: number; name: string; quantity: number; unit: string
  unit_price: number; publish_count: number; contact_mode: number
  phone: string | null; compensation_type: string
  trade_time_range: string; fund_settlement: string
  created_at: string; updated_at: string
}

interface TaskRow {
  id: number; template_id: number; product_name: string
  spec: string; unit_price: number; status: string
  progress: number; current_step: string | null
  params_snapshot: string; fail_reason: string | null
  result_screenshot: string | null
  created_at: string; completed_at: string | null
}

interface LogRow {
  id: number; task_id: number | null; level: string
  message: string; screenshot_path: string | null
  exception_level: string | null; created_at: string
}

/** 将 snake_case 行映射为 camelCase ProductTemplate */
function mapTemplate(row: TemplateRow): ProductTemplate {
  return {
    id: row.id, name: row.name, quantity: row.quantity, unit: row.unit,
    unitPrice: row.unit_price, publishCount: row.publish_count,
    contactMode: row.contact_mode as 1 | 2, phone: row.phone ?? undefined,
    compensationType: row.compensation_type, tradeTimeRange: row.trade_time_range,
    fundSettlement: row.fund_settlement,
    createdAt: row.created_at, updatedAt: row.updated_at
  }
}

/** 将 snake_case 行映射为 camelCase TaskRecord */
function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id, templateId: row.template_id, productName: row.product_name,
    spec: row.spec, unitPrice: row.unit_price,
    status: row.status as TaskStatus, progress: row.progress,
    currentStep: row.current_step as TaskRecord['currentStep'],
    paramsSnapshot: row.params_snapshot, failReason: row.fail_reason ?? undefined,
    resultScreenshot: row.result_screenshot ?? undefined,
    createdAt: row.created_at, completedAt: row.completed_at ?? undefined
  }
}

/** 将 snake_case 行映射为 camelCase RunLog */
function mapLog(row: LogRow): RunLog {
  return {
    id: row.id, taskId: row.task_id, level: row.level as LogLevel,
    message: row.message, screenshotPath: row.screenshot_path ?? undefined,
    exceptionLevel: row.exception_level as RunLog['exceptionLevel'],
    createdAt: row.created_at
  }
}

// ========== 商品模板 CRUD ==========

export function getTemplates(): ProductTemplate[] {
  const rows = getDb().prepare('SELECT * FROM product_templates ORDER BY updated_at DESC').all() as TemplateRow[]
  return rows.map(mapTemplate)
}

export function getTemplate(id: number): ProductTemplate | null {
  const row = getDb().prepare('SELECT * FROM product_templates WHERE id = ?').get(id) as TemplateRow | undefined
  return row ? mapTemplate(row) : null
}

export function saveTemplate(template: Partial<ProductTemplate>): ProductTemplate {
  const now = localNowString()
  if (template.id) {
    getDb().prepare(`
      UPDATE product_templates SET
        name = @name, quantity = @quantity, unit = @unit, unit_price = @unitPrice,
        publish_count = @publishCount, contact_mode = @contactMode, phone = @phone,
        compensation_type = @compensationType, trade_time_range = @tradeTimeRange,
        fund_settlement = @fundSettlement, updated_at = @updatedAt
      WHERE id = @id
    `).run({
      name: template.name ?? '未命名模板',
      quantity: template.quantity ?? 1,
      unit: template.unit ?? '万金',
      unitPrice: template.unitPrice ?? 0,
      publishCount: template.publishCount ?? 1,
      contactMode: template.contactMode ?? 1,
      phone: template.phone ?? null,
      compensationType: template.compensationType ?? '不包赔',
      tradeTimeRange: template.tradeTimeRange ?? '全天',
      fundSettlement: template.fundSettlement ?? '平台代收',
      updatedAt: now,
      id: template.id
    })
    return getTemplate(template.id)!
  }

  const result = getDb().prepare(`
    INSERT INTO product_templates (name, quantity, unit, unit_price, publish_count, contact_mode, phone, compensation_type, trade_time_range, fund_settlement)
    VALUES (@name, @quantity, @unit, @unitPrice, @publishCount, @contactMode, @phone, @compensationType, @tradeTimeRange, @fundSettlement)
  `).run({
    name: template.name ?? '未命名模板',
    quantity: template.quantity ?? 1,
    unit: template.unit ?? '万金',
    unitPrice: template.unitPrice ?? 0,
    publishCount: template.publishCount ?? 1,
    contactMode: template.contactMode ?? 1,
    phone: template.phone ?? null,
    compensationType: template.compensationType ?? '不包赔',
    tradeTimeRange: template.tradeTimeRange ?? '全天',
    fundSettlement: template.fundSettlement ?? '平台代收'
  })
  return getTemplate(Number(result.lastInsertRowid))!
}

export function deleteTemplate(id: number): boolean {
  const result = getDb().prepare('DELETE FROM product_templates WHERE id = ?').run(id)
  return result.changes > 0
}

// ========== 任务记录 CRUD ==========

export function getTasks(filter?: { status?: TaskStatus; keyword?: string }): TaskRecord[] {
  let sql = 'SELECT * FROM task_records'
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (filter?.status) {
    conditions.push('status = @status')
    params.status = filter.status
  }
  if (filter?.keyword) {
    conditions.push('(product_name LIKE @keyword OR spec LIKE @keyword)')
    params.keyword = `%${filter.keyword}%`
  }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ' ORDER BY created_at DESC'

  const rows = getDb().prepare(sql).all(params) as TaskRow[]
  return rows.map(mapTask)
}

export function getTask(id: number): TaskRecord | null {
  const row = getDb().prepare('SELECT * FROM task_records WHERE id = ?').get(id) as TaskRow | undefined
  return row ? mapTask(row) : null
}

export function createTask(templateId: number, count: number, template: ProductTemplate): TaskRecord[] {
  const paramsSnapshot = JSON.stringify(template)
  const insert = getDb().prepare(`
    INSERT INTO task_records (template_id, product_name, spec, unit_price, status, progress, current_step, params_snapshot)
    VALUES (@templateId, @productName, @spec, @unitPrice, 'pending', 0, NULL, @paramsSnapshot)
  `)
  const tasks: TaskRecord[] = []
  for (let i = 0; i < count; i++) {
    const result = insert.run({
      templateId,
      productName: template.name,
      spec: `${template.quantity}${template.unit}`,
      unitPrice: template.unitPrice,
      paramsSnapshot
    })
    tasks.push(getTask(Number(result.lastInsertRowid))!)
  }
  return tasks
}

export function updateTaskStatus(id: number, status: TaskStatus, failReason?: string, completedAt?: string): void {
  getDb().prepare(`
    UPDATE task_records SET status = @status, fail_reason = @failReason, completed_at = @completedAt WHERE id = @id
  `).run({ status, failReason: failReason ?? null, completedAt: completedAt ?? null, id })
}

export function updateTaskProgress(id: number, progress: number, currentStep: string | null): void {
  getDb().prepare('UPDATE task_records SET progress = @progress, current_step = @currentStep WHERE id = @id')
    .run({ progress, currentStep, id })
}

export function updateTaskResult(id: number, screenshotPath: string | null): void {
  getDb().prepare('UPDATE task_records SET result_screenshot = @screenshotPath WHERE id = @id')
    .run({ screenshotPath, id })
}

export function deleteTask(id: number): boolean {
  const result = getDb().prepare('DELETE FROM task_records WHERE id = ?').run(id)
  return result.changes > 0
}

export function deleteTasks(ids: number[]): number {
  if (!ids.length) return 0
  const placeholders = ids.map(() => '?').join(',')
  const result = getDb().prepare(`DELETE FROM task_records WHERE id IN (${placeholders})`).run(...ids)
  return result.changes
}

// ========== 运行日志 ==========

export function insertLog(log: Omit<RunLog, 'id' | 'createdAt'>): RunLog {
  const result = getDb().prepare(`
    INSERT INTO run_logs (task_id, level, message, screenshot_path, exception_level)
    VALUES (@taskId, @level, @message, @screenshotPath, @exceptionLevel)
  `).run({
    taskId: log.taskId ?? null,
    level: log.level,
    message: log.message,
    screenshotPath: log.screenshotPath ?? null,
    exceptionLevel: log.exceptionLevel ?? null
  })
  const row = getDb().prepare('SELECT * FROM run_logs WHERE id = ?').get(Number(result.lastInsertRowid)) as LogRow
  return mapLog(row)
}

export function getLogs(filter?: { level?: LogLevel; taskId?: number; startTime?: string; endTime?: string }): RunLog[] {
  let sql = 'SELECT * FROM run_logs'
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (filter?.level) { conditions.push('level = @level'); params.level = filter.level }
  if (filter?.taskId) { conditions.push('task_id = @taskId'); params.taskId = filter.taskId }
  if (filter?.startTime) { conditions.push('created_at >= @startTime'); params.startTime = filter.startTime }
  if (filter?.endTime) { conditions.push('created_at <= @endTime'); params.endTime = filter.endTime }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ' ORDER BY created_at DESC LIMIT 500'

  const rows = getDb().prepare(sql).all(params) as LogRow[]
  return rows.map(mapLog)
}

export function deleteLog(id: number): boolean {
  const result = getDb().prepare('DELETE FROM run_logs WHERE id = ?').run(id)
  return result.changes > 0
}

export function clearLogs(): boolean {
  getDb().prepare('DELETE FROM run_logs').run()
  return true
}

// ========== 仪表盘统计 ==========

export function getDashboardStats() {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const todaySuccess = (getDb().prepare(
    "SELECT COUNT(*) as count FROM task_records WHERE status = 'success' AND DATE(completed_at) = ?"
  ).get(today) as { count: number }).count

  const todayFailed = (getDb().prepare(
    "SELECT COUNT(*) as count FROM task_records WHERE status = 'failed' AND DATE(completed_at) = ?"
  ).get(today) as { count: number }).count

  const totalToday = todaySuccess + todayFailed

  const runningCount = (getDb().prepare(
    "SELECT COUNT(*) as count FROM task_records WHERE status IN ('running','pending','paused','waiting_manual')"
  ).get() as { count: number }).count

  const revenueRow = getDb().prepare(
    "SELECT COALESCE(SUM(unit_price), 0) as total FROM task_records WHERE status = 'success' AND DATE(completed_at) = ?"
  ).get(today) as { total: number }

  return {
    todaySuccess,
    todayFailed,
    totalToday,
    successRate: totalToday > 0 ? Math.round((todaySuccess / totalToday) * 100) : 0,
    estimatedRevenue: revenueRow.total,
    runningCount
  }
}

// ========== 工具函数 ==========

/** 本地时间字符串（与 DB datetime('now','localtime') 格式一致） */
export function localNowString(): string {
  const d = new Date()
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().replace('T', ' ').slice(0, 19)
}

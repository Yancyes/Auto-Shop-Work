import { getDb } from './index'
import { parseMonitors, serializeMonitors } from '../../shared/monitor-config'
import type { RecordedScript, RecordedStep, RegionMonitor, RunLog, LogLevel } from '../../shared/types'

// ========== 行映射工具（snake_case → camelCase）==========

interface ScriptRow {
  id: number; name: string; description: string | null
  target_url: string; steps_json: string; data_json: string | null
  monitor_json: string | null
  run_count: number; status: string
  created_at: string; updated_at: string
}

interface LogRow {
  id: number; script_id: number | null; level: string
  message: string
  exception_level: string | null; created_at: string
}

function mapScript(row: ScriptRow): RecordedScript {
  return {
    id: row.id, name: row.name, description: row.description ?? undefined,
    targetUrl: row.target_url, stepsJson: row.steps_json,
    dataJson: row.data_json ?? '',
    monitorJson: row.monitor_json ?? '',
    runCount: row.run_count, status: row.status as RecordedScript['status'],
    createdAt: row.created_at, updatedAt: row.updated_at
  }
}

function mapLog(row: LogRow): RunLog {
  return {
    id: row.id, scriptId: row.script_id, level: row.level as LogLevel,
    message: row.message,
    exceptionLevel: row.exception_level as RunLog['exceptionLevel'],
    createdAt: row.created_at
  }
}

// ========== 录制脚本 CRUD ==========

export function getScripts(): RecordedScript[] {
  const rows = getDb().prepare('SELECT * FROM recorded_scripts ORDER BY updated_at DESC').all() as ScriptRow[]
  return rows.map(mapScript)
}

export function getScript(id: number): RecordedScript | null {
  const row = getDb().prepare('SELECT * FROM recorded_scripts WHERE id = ?').get(id) as ScriptRow | undefined
  return row ? mapScript(row) : null
}

export function saveScript(script: Partial<RecordedScript>): RecordedScript {
  const now = localNowString()
  if (script.id) {
    // run_count / status 用 COALESCE 保留原值：
    // 调用方不传这两个字段时（例如只改名称或步骤），不能把执行次数清零、把状态重置
    getDb().prepare(`
      UPDATE recorded_scripts SET
        name = @name, description = @description, target_url = @targetUrl,
        steps_json = @stepsJson,
        data_json = COALESCE(@dataJson, data_json),
        monitor_json = COALESCE(@monitorJson, monitor_json),
        run_count = COALESCE(@runCount, run_count),
        status = COALESCE(@status, status),
        updated_at = @updatedAt
      WHERE id = @id
    `).run({
      name: script.name ?? '未命名脚本',
      description: script.description ?? null,
      targetUrl: script.targetUrl ?? '',
      stepsJson: script.stepsJson ?? '[]',
      // 传空串表示「清空数据表」，不传（null）表示保持原数据表
      dataJson: script.dataJson ?? null,
      monitorJson: script.monitorJson ?? null,
      runCount: script.runCount ?? null,
      status: script.status ?? null,
      updatedAt: now,
      id: script.id
    })
    return getScript(script.id)!
  }

  const result = getDb().prepare(`
    INSERT INTO recorded_scripts (name, description, target_url, steps_json, data_json, monitor_json, run_count, status)
    VALUES (@name, @description, @targetUrl, @stepsJson, @dataJson, @monitorJson, @runCount, @status)
  `).run({
    name: script.name ?? '未命名脚本',
    description: script.description ?? null,
    targetUrl: script.targetUrl ?? '',
    stepsJson: script.stepsJson ?? '[]',
    dataJson: script.dataJson ?? '',
    monitorJson: script.monitorJson ?? '',
    runCount: script.runCount ?? 0,
    status: script.status ?? 'draft'
  })
  return getScript(Number(result.lastInsertRowid))!
}

export function deleteScript(id: number): boolean {
  const result = getDb().prepare('DELETE FROM recorded_scripts WHERE id = ?').run(id)
  return result.changes > 0
}

export function updateScriptStatus(id: number, status: string): void {
  // 注意：不更新 updated_at。列表按 updated_at 倒序排列，
  // 状态变化（运行/暂停/完成）如果连带刷新 updated_at，会导致运行中的脚本卡片在列表里不停跳动
  getDb().prepare('UPDATE recorded_scripts SET status = @status WHERE id = @id')
    .run({ status, id })
}

/** 执行次数 +1（每完成一轮调用，不影响 updated_at） */
export function incrementRunCount(id: number): void {
  getDb().prepare('UPDATE recorded_scripts SET run_count = run_count + 1 WHERE id = ?').run(id)
}

// ========== 脚本步骤解析 ==========

export function getScriptSteps(id: number): RecordedStep[] {
  const script = getScript(id)
  if (!script) return []
  try {
    const parsed = JSON.parse(script.stepsJson) as unknown
    // 手工改过库/旧版本存档可能存成对象或 null，直接当数组用会在执行器里炸出 TypeError
    return Array.isArray(parsed) ? (parsed as RecordedStep[]) : []
  } catch {
    return []
  }
}

/** 脚本的屏幕监控项：解析规则与渲染层共用 shared/monitor-config */
export function getScriptMonitors(id: number): RegionMonitor[] {
  const script = getScript(id)
  return script ? parseMonitors(script.monitorJson) : []
}

/**
 * 只覆盖步骤 JSON。
 * 不走 saveScript：整行更新会把没传的字段写回默认值（名称变「未命名脚本」、数据表被清空）。
 */
export function updateScriptSteps(id: number, steps: RecordedStep[]): boolean {
  const result = getDb()
    .prepare('UPDATE recorded_scripts SET steps_json = @stepsJson, updated_at = @updatedAt WHERE id = @id')
    .run({ stepsJson: JSON.stringify(steps), updatedAt: localNowString(), id })
  return result.changes > 0
}

/** 只覆盖监控区域 JSON，理由同上 */
export function updateScriptMonitors(id: number, monitors: RegionMonitor[]): boolean {
  const result = getDb()
    .prepare('UPDATE recorded_scripts SET monitor_json = @monitorJson, updated_at = @updatedAt WHERE id = @id')
    .run({ monitorJson: serializeMonitors(monitors), updatedAt: localNowString(), id })
  return result.changes > 0
}

// ========== 运行日志 ==========
export function insertLog(log: Omit<RunLog, 'id' | 'createdAt'>): RunLog {
  const result = getDb().prepare(`
    INSERT INTO run_logs (script_id, level, message, exception_level)
    VALUES (@scriptId, @level, @message, @exceptionLevel)
  `).run({
    scriptId: log.scriptId ?? null,
    level: log.level,
    message: log.message,
    exceptionLevel: log.exceptionLevel ?? null
  })
  const row = getDb().prepare('SELECT * FROM run_logs WHERE id = ?').get(Number(result.lastInsertRowid)) as LogRow
  return mapLog(row)
}

export function getLogs(filter?: { level?: LogLevel; scriptId?: number; startTime?: string; endTime?: string }): RunLog[] {
  let sql = 'SELECT * FROM run_logs'
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (filter?.level) { conditions.push('level = @level'); params.level = filter.level }
  if (filter?.scriptId) { conditions.push('script_id = @scriptId'); params.scriptId = filter.scriptId }
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

// ========== 工具函数 ==========

/** 本地时间字符串 */
export function localNowString(): string {
  const d = new Date()
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().replace('T', ' ').slice(0, 19)
}

/**
 * 脚本变量与自定义数据表：主进程替换步骤数据、渲染进程编辑数据表共用同一套规则，
 * 避免两边对 {{名称}} 的解析结果不一致（一边认得、一边当普通文本执行）。
 */
import type { RecordedStep, ScriptDataSheet } from './types'

const EMPTY_DATA_SHEET: ScriptDataSheet = { columns: [], rows: [] }

/** {{ 名称 }}，名称里不能出现大括号 */
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/

/** 每次调用新建正则：带 g 的正则有 lastIndex 状态，复用同一实例会漏匹配 */
function placeholderRe(): RegExp {
  return new RegExp(PLACEHOLDER.source, 'g')
}

/** 一段文本里出现的变量名（保序去重） */
export function varNamesIn(text: string | undefined): string[] {
  if (!text) return []
  const names: string[] = []
  for (const match of text.matchAll(placeholderRe())) {
    const name = match[1].trim()
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

/** 步骤的选择器与输入值里用到的全部变量名 */
export function collectStepVars(steps: RecordedStep[]): string[] {
  const names: string[] = []
  for (const step of steps) {
    for (const name of [...varNamesIn(step.selector), ...varNamesIn(step.value)]) {
      if (!names.includes(name)) names.push(name)
    }
  }
  return names
}

/** 替换文本里的占位符；vars 里没有的键保持原样，由执行前的必填校验拦下 */
export function applyVars(text: string | undefined, vars: Record<string, string>): string {
  if (!text) return text ?? ''
  return text.replace(placeholderRe(), (raw, name: string) => {
    const value = vars[name.trim()]
    return value ? value : raw
  })
}

/** 用一轮数据生成该轮实际执行的步骤；不改原数组，队列里保存的始终是模板 */
export function resolveSteps(steps: RecordedStep[], vars: Record<string, string>): RecordedStep[] {
  if (Object.keys(vars).length === 0) return steps
  return steps.map(step => ({
    ...step,
    selector: applyVars(step.selector, vars),
    value: step.value === undefined ? step.value : applyVars(step.value, vars)
  }))
}

/** 解析落库的数据表；旧脚本没有这一列、或 JSON 被手改坏时返回空表而不是抛错 */
export function parseDataSheet(json?: string | null): ScriptDataSheet {
  if (!json) return EMPTY_DATA_SHEET
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object') return EMPTY_DATA_SHEET
    const raw = parsed as { columns?: unknown; rows?: unknown }
    const columns = Array.isArray(raw.columns)
      ? raw.columns.filter((c): c is string => typeof c === 'string')
      : []
    const rows = Array.isArray(raw.rows)
      ? raw.rows
          .filter((r): r is unknown[] => Array.isArray(r))
          .map(r => r.map(cell => String(cell ?? '')))
      : []
    return normalizeRows(columns, rows)
  } catch {
    return EMPTY_DATA_SHEET
  }
}

/** 列名去重去空，并把每行补齐成与列数一致的字符串数组 */
function normalizeRows(columns: string[], rows: string[][]): ScriptDataSheet {
  const clean = columns
    .map(c => c.trim())
    .filter((c, i, arr) => c !== '' && arr.indexOf(c) === i)
  if (clean.length === 0) return EMPTY_DATA_SHEET
  return {
    columns: clean,
    rows: rows.map(row => clean.map((_, i) => (row[i] ?? '').trim()))
  }
}

export function serializeDataSheet(sheet: ScriptDataSheet): string {
  if (sheet.columns.length === 0 || sheet.rows.length === 0) return ''
  return JSON.stringify(sheet)
}

/** 去掉 AI 常包的 ``` 围栏；粘的本来就是纯 JSON 时无副作用 */
function stripFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
}

function stripQuotes(value: string): string {
  return value.replace(/^"|"$/g, '').trim()
}

/** 逗号分隔要认引号：AI 生成的数据里常有「含逗号的商品名」 */
function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map(c => c.trim())
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

/** 一行对象 → 按列对齐：键名能对上就按名取（AI 会换顺序），全对不上就按出现位置取 */
function objectToRow(obj: Record<string, unknown>, columns: string[]): string[] {
  const keys = Object.keys(obj)
  const matched = columns.map(name => keys.find(k => stripQuotes(k) === name))
  if (matched.every(key => key === undefined)) {
    return columns.map((_, i) => String(Object.values(obj)[i] ?? ''))
  }
  return matched.map(key => String(key === undefined ? '' : obj[key] ?? ''))
}

/**
 * 把用户从任意 AI 复制来的文本解析成数据行，接受 JSON 对象数组、JSON 二维数组、
 * 带或不带表头的 CSV/制表符文本：AI 的回复格式不由我们决定，能认就先按列名对齐。
 * JSON 不合法时抛出，由界面提示「无法识别」。
 */
export function parseDataText(raw: string, columns: string[]): string[][] {
  const text = stripFence(raw)
  if (!text) return []
  if (text.startsWith('[') || text.startsWith('{')) {
    const parsed = JSON.parse(text) as unknown
    const list = Array.isArray(parsed) ? parsed : [parsed]
    const rows: string[][] = []
    for (const item of list) {
      if (Array.isArray(item)) rows.push(columns.map((_, i) => String(item[i] ?? '')))
      else if (item && typeof item === 'object') rows.push(objectToRow(item as Record<string, unknown>, columns))
      // 单列表格时 AI 常直接回一串字符串：["耳机","手机壳"]
      else if (columns.length === 1 && item !== null && item !== undefined) rows.push([String(item)])
    }
    return rows
  }
  const cells = text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '').map(splitCells)
  const header = cells[0] ?? []
  const hits = header.filter(h => columns.includes(stripQuotes(h))).length
  if (hits >= Math.min(2, columns.length)) {
    const order = header.map(h => columns.indexOf(stripQuotes(h)))
    return cells.slice(1).map(row => columns.map((_, i) => row[order.indexOf(i)] ?? ''))
  }
  return cells.map(row => columns.map((_, i) => row[i] ?? ''))
}

/**
 * 第 runIndex 轮（0 起）取哪一行：行数不足时按行数取模循环，
 * 这样无限循环配少量数据也不会卡在第一行或越界。
 */
export function rowForRun(sheet: ScriptDataSheet, runIndex: number): Record<string, string> {
  if (sheet.columns.length === 0 || sheet.rows.length === 0) return {}
  const row = sheet.rows[Math.abs(runIndex) % sheet.rows.length] ?? []
  const vars: Record<string, string> = {}
  sheet.columns.forEach((name, i) => {
    const value = (row[i] ?? '').trim()
    if (value) vars[name] = value
  })
  return vars
}

/** 本轮数据与本次默认值合并：行内已有的值优先，空格子回落默认值 */
export function mergeRunVars(row: Record<string, string>, defaults: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(defaults)) {
    const v = (value ?? '').trim()
    if (v) out[key] = v
  }
  return { ...out, ...row }
}

/**
 * 启动前校验：返回执行期间会取不到值的变量名。
 * 数据表按行循环取数，所以只要有一行该列是空的、又没填本次默认值，那一轮就会把 {{名称}} 原样敲进页面。
 */
export function missingScriptVars(
  steps: RecordedStep[],
  targetUrl: string,
  sheet: ScriptDataSheet,
  defaults: Record<string, string>
): string[] {
  const needed = [...collectStepVars(steps), ...varNamesIn(targetUrl)]
  return needed.filter(name => {
    if ((defaults[name] ?? '').trim()) return false
    const col = sheet.columns.indexOf(name)
    // 只有列名、一行数据都没有，等于没填
    if (col === -1 || sheet.rows.length === 0) return true
    return sheet.rows.some(row => !(row[col] ?? '').trim())
  })
}

/**
 * 生成一段可直接粘给任意 AI 的取数提示词：把字段名和行数写进去，
 * AI 只要按格式回一段 JSON，用户原样贴回数据表就能用。
 */
export function buildAiDataPrompt(varNames: string[], rowCount: number): string {
  const names = varNames.length > 0 ? varNames : ['字段1', '字段2']
  const n = rowCount > 0 ? rowCount : 10
  const example = names.reduce<Record<string, string>>((acc, name, i) => {
    acc[name] = `示例${i + 1}`
    return acc
  }, {})
  return [
    `我在用一个网页自动化脚本，需要 ${n} 组填写数据，每组包含这些字段：${names.join('、')}。`,
    '请只输出 JSON，不要任何解释文字、不要 ``` 代码块标记：',
    '1. 顶层是数组，长度正好是 ' + n + '；',
    '2. 每个元素是一个对象，键名必须与上面的字段完全一致，一个都不能少；',
    '3. 所有值都写成字符串（数字也要加引号，例如 "2"）；',
    '4. 数据要真实可用、彼此不重复，符合网页填写场景的常识；',
    '5. 字段含义不明确时，按最常见的填写习惯直接生成，不要反问我。',
    '',
    '输出格式示例：',
    JSON.stringify([example], null, 2)
  ].join('\n')
}

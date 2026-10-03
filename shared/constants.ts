/** 主进程与渲染进程共用的运行期常量 */

/**
 * 步骤之间的默认等待（毫秒）：上一步执行完等这么久再执行下一步。
 * 录制时不再记录操作节奏，用户仍可在步骤里单独自定义延迟。
 */
export const DEFAULT_STEP_DELAY = 300

/** 步骤延迟可填的上限（毫秒），执行器与步骤编辑框共用 */
export const MAX_STEP_DELAY = 60000

/**
 * 「刷新页面」步骤的随机等待区间（毫秒）：
 * 执行到该步骤时先随机等 30~60 秒再 reload，节奏不固定，避免每次同一秒刷新被判为脚本行为。
 */
export const REFRESH_MIN_MS = 30000
export const REFRESH_MAX_MS = 60000

/** 区域监控默认轮询间隔与命中阈值：块级差异占比达到 6% 视为「数据变了」 */
export const DEFAULT_MONITOR_INTERVAL_MS = 1000
export const DEFAULT_MONITOR_HIT_RATIO = 0.06

/** 监控轮询间隔的可填区间：低于 300ms 抓屏会拖慢整机，高于 10 分钟等于没监控 */
export const MIN_MONITOR_INTERVAL_MS = 300
export const MAX_MONITOR_INTERVAL_MS = 600000

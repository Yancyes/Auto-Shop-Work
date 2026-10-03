/**
 * 系统通知（设置项 notification.* 的执行端）
 *
 * - taskComplete：脚本执行结束（成功/失败/被停止）时提醒
 * - manualIntervention：某步骤重试耗尽仍失败，页面可能需要人接手时提醒
 * - soundEnabled：提醒是否带声音（静音只是不响，不影响通知本身）
 */
import { Notification } from 'electron'
import { getSettings } from '../config'
import { getScript } from '../db/repository'
import log from 'electron-log'

function show(title: string, body: string) {
  const { soundEnabled } = getSettings().notification
  if (!Notification.isSupported()) return
  try {
    new Notification({ title, body, silent: !soundEnabled }).show()
  } catch (err) {
    // 通知只是附加体验，失败不能影响执行链路
    log.warn('[Notifier] 系统通知发送失败:', err)
  }
}

/** 脚本执行结束通知（受 notification.taskComplete 控制） */
export function notifyScriptComplete(scriptId: number, message: string, success: boolean) {
  if (!getSettings().notification.taskComplete) return
  const name = getScript(scriptId)?.name ?? `脚本 ${scriptId}`
  show(success ? `执行完成 · ${name}` : `执行未成功 · ${name}`, message)
}

/** 步骤彻底失败通知（受 notification.manualIntervention 控制） */
export function notifyManualIntervention(scriptName: string, stepIndex: number, error: string) {
  if (!getSettings().notification.manualIntervention) return
  show(`需要人工介入 · ${scriptName}`, `第 ${stepIndex + 1} 步反复失败：${error}`)
}

/** 区域监控命中通知：脚本已经停在步骤边界等人处理，走同一个人工介入开关 */
export function notifyMonitorHit(scriptName: string, label: string) {
  if (!getSettings().notification.manualIntervention) return
  show(`数据变化 · ${scriptName}`, `监控「${label}」检测到变化，已暂停等待接管`)
}

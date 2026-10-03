/** 渲染进程 IPC 通信封装 */

import { toRaw } from 'vue'
import type { IpcChannels, IpcEventChannels } from '../../shared/types'

/**
 * 把 Vue 响应式数据转成可被结构化克隆的纯数据。
 * reactive/ref 的 Proxy 传给 ipcRenderer.invoke 会抛 DataCloneError（「An object could not be cloned」），
 * 在出口统一脱 Proxy，省去每个调用点各自深拷贝、也不会漏。
 */
function toPlain(value: unknown, ancestors: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== 'object') return value
  const raw = toRaw(value as object)
  // 循环引用：截断，避免无限递归（IPC 本来也传不了环）
  if (ancestors.has(raw)) return null
  if (raw instanceof Date) return raw
  ancestors.add(raw)
  let plain: unknown
  if (Array.isArray(raw)) {
    plain = raw.map(item => toPlain(item, ancestors))
  } else {
    const source = raw as Record<string, unknown>
    const target: Record<string, unknown> = {}
    for (const key of Object.keys(source)) target[key] = toPlain(source[key], ancestors)
    plain = target
  }
  ancestors.delete(raw)
  return plain
}

// 安全获取 api（若 preload 加载失败，提供降级实现避免整个应用崩溃）
const api = window.api ?? {
  invoke: (_channel: string, ..._args: unknown[]) =>
    Promise.resolve({ success: false, error: 'IPC 通道不可用：preload 脚本未正确加载' }),
  on: (_channel: string, _listener: (...args: unknown[]) => void) => () => {}
}

export const ipc = {
  invoke: <K extends keyof IpcChannels>(channel: K, ...args: Parameters<IpcChannels[K]>) =>
    api.invoke(channel, ...args.map(arg => toPlain(arg)) as Parameters<IpcChannels[K]>),
  on: <K extends keyof IpcEventChannels>(channel: K, listener: IpcEventChannels[K]) =>
    api.on(channel, listener as (...args: unknown[]) => void)
}

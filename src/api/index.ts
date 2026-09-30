/** 渲染进程 IPC 通信封装 */

import type { IpcChannels, IpcEventChannels } from '../../shared/types'

// 安全获取 api（若 preload 加载失败，提供降级实现避免整个应用崩溃）
const api = window.api ?? {
  invoke: (_channel: string, ..._args: unknown[]) =>
    Promise.resolve({ success: false, error: 'IPC 通道不可用：preload 脚本未正确加载' }),
  on: (_channel: string, _listener: (...args: unknown[]) => void) => () => {}
}

export const ipc = {
  invoke: <K extends keyof IpcChannels>(channel: K, ...args: Parameters<IpcChannels[K]>) =>
    api.invoke(channel, ...args),
  on: <K extends keyof IpcEventChannels>(channel: K, listener: IpcEventChannels[K]) =>
    api.on(channel, listener as (...args: unknown[]) => void)
}

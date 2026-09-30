import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { IpcChannels, IpcEventChannels } from '../shared/types'

/**
 * 暴露给渲染进程的安全 API
 * 渲染进程通过 window.api 调用主进程能力
 */
const api = {
  /** 请求-响应模式：调用主进程方法 */
  invoke: <K extends keyof IpcChannels>(
    channel: K,
    ...args: Parameters<IpcChannels[K]>
  ): Promise<ReturnType<IpcChannels[K]>> => {
    return ipcRenderer.invoke(channel, ...args)
  },

  /** 事件推送模式：监听主进程事件 */
  on: <K extends keyof IpcEventChannels>(
    channel: K,
    callback: (data: Parameters<IpcEventChannels[K]>[0]) => void
  ): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => callback(data as never)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  /** 平台信息 */
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

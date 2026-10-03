// 预加载脚本 - CommonJS 格式（Electron 预加载上下文需要）
// 手写、不经 vite 构建（构建管道会把 ESM/CJS 转错），由 scripts/copy-preload.mjs
// 在 dev 与 build 时原样复制到 dist-electron/preload.cjs，主进程按该路径加载。
// 类型定义见 electron/preload.ts（仅供 TypeScript 检查，不参与运行）
const { contextBridge, ipcRenderer } = require('electron')

const api = {
  /** 请求-响应模式：调用主进程方法 */
  invoke: (channel, ...args) => {
    return ipcRenderer.invoke(channel, ...args)
  },
  /** 事件推送模式：监听主进程事件 */
  on: (channel, callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  /** 平台信息 */
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)

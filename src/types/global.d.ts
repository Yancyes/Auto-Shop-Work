/** 渲染进程全局 window.api 类型声明 */
import type { Api } from '../../electron/preload'

declare global {
  interface Window {
    api: Api
  }
}

export {}

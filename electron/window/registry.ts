/**
 * 主窗口引用登记表
 *
 * 迷你控制窗、框选遮罩都需要操作主窗口（隐藏/恢复/改尺寸），但主窗口的创建
 * 留在 main.ts 里，直接互相 import 会形成循环依赖，所以用这一层薄登记解决。
 */
import type { BrowserWindow } from 'electron'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

/** 主窗口可能已被关闭，调用方都要判空 */
export function getMainWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  return null
}

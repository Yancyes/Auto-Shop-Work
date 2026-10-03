import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getSettings } from '../config'
import type { BrowserDetectResult } from '../../shared/types'

/** 系统浏览器在 Windows 上的常见安装位置（相对各自根目录） */
const SYSTEM_BROWSER_FILES = [
  'Google/Chrome/Application/chrome.exe',
  'Google/Chrome Beta/Application/chrome.exe',
  'Microsoft/Edge/Application/msedge.exe'
]

function systemBrowserRoots(): string[] {
  if (process.platform !== 'win32') return []
  return [
    process.env.ProgramFiles ?? 'C:\\Program Files',
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    // 无管理员权限时 Chrome/Edge 装在这里（%LOCALAPPDATA%\Google\Chrome\Application），
    // 只搜 Programs 子目录会漏掉这种「 per-user 安装」，表现为「未找到谷歌浏览器」
    process.env.LOCALAPPDATA ?? '',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : ''
  ].filter(Boolean)
}

/** Playwright 自带 Chromium 的路径；未安装到本机时可能抛错或指向不存在的文件 */
function bundledChromiumPath(): string | null {
  try {
    const p = chromium.executablePath()
    return p && existsSync(p) ? p : null
  } catch {
    return null
  }
}

/**
 * 解析要启动的浏览器：手动指定 → Playwright 自带 → 系统 Chrome/Edge。
 * 不抛错，把「找不到」变成可展示的提示，供启动和设置页共用。
 * @param customOverride 设置页未保存时的候选路径，优先于存档
 */
export function detectBrowser(customOverride?: string): BrowserDetectResult {
  const custom = (customOverride ?? getSettings().browser.executablePath ?? '').trim()
  if (custom) {
    return existsSync(custom)
      ? { source: 'custom', executablePath: custom }
      : { source: 'none', problem: `手动指定的浏览器不存在：${custom}（可能已被卸载或移动，请重新选择）` }
  }

  const bundled = bundledChromiumPath()
  if (bundled) return { source: 'bundled', executablePath: bundled }

  const system = systemBrowserRoots()
    .flatMap(root => SYSTEM_BROWSER_FILES.map(rel => join(root, rel)))
    .find(p => existsSync(p))
  if (system) return { source: 'system', executablePath: system }

  return {
    source: 'none',
    problem: '未找到可用的浏览器。请在「日志与设置 → 浏览器设置 → 执行浏览器」中选择 Chrome 或 Edge 的程序文件'
  }
}

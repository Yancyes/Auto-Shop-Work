/** playwright 的 d.ts 只导出 chromium 实例，类型要从它自身取 */
type Chromium = typeof import('playwright').chromium

/**
 * playwright 在主进程侧加载一次约 300ms，只有真正要驱动浏览器时才用得上。
 * 用动态导入并复用同一个 Promise，把它移出应用启动的关键路径。
 */
let pending: Promise<Chromium> | null = null

export function loadChromium(): Promise<Chromium> {
  if (!pending) {
    // 失败必须清空：否则一次瞬时报错会被永久缓存，之后再也起不了浏览器
    pending = import('playwright')
      .then(({ chromium }) => chromium)
      .catch(err => {
        pending = null
        throw err
      })
  }
  return pending
}

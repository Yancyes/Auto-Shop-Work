/**
 * 屏幕抓帧：用 desktopCapturer 抓整屏，区域内裁剪用纯 Buffer 运算完成
 *
 * 两条经验决定了这里的写法：
 * 1. thumbnailSize 传显示器的 DIP 尺寸时，WebrtcImageAdapter 会把物理截图缩放到该尺寸，
 *    返回图与显示器原点的 DIP 坐标一一对应 —— 于是框选矩形可以直接按 DIP 裁，
 *    不需要按 scaleFactor 换算，跨 100%/125%/150% 缩放比的机器行为一致。
 * 2. 一次 getSources 大约几十毫秒，多个监控区域若各抓一次会明显拖慢执行，
 *    所以每轮只抓一次整屏，各区域从同一张位图里裁（BGRA 每像素 4 字节，纯偏移计算）。
 */
import { app, desktopCapturer, nativeImage, screen } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log'
import type { DisplayInfo, RegionFrame, ScreenRect } from '../../shared/types'

export interface BgraFrame {
  width: number
  height: number
  /** BGRA 原始像素，长度 = width * height * 4 */
  bitmap: Buffer
}

/** 基准图目录：PNG 落盘，比对时再解码回 BGRA，避免把大图塞进 SQLite */
function baselineDir(): string {
  const dir = join(app.getPath('userData'), 'monitor-baselines')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function baselinePath(monitorId: string): string {
  // monitorId 由本应用生成（rnd + 时间戳），仍挡一层，避免手工改库写出目录外的文件
  const safe = monitorId.replace(/[^A-Za-z0-9_-]/g, '')
  return join(baselineDir(), `${safe || 'unknown'}.png`)
}

export function listDisplays(): DisplayInfo[] {
  return screen.getAllDisplays().map(d => ({
    id: d.id,
    // 原点与尺寸都取自 bounds：它们是同一套虚拟桌面 DIP 坐标，混用 size 会让多屏混排时裁偏
    bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
    scaleFactor: d.scaleFactor
  }))
}

/** 区域中心点落在哪台显示器；中心点都不在（区域越界）时用主屏 */
export function displayForRect(rect: ScreenRect): DisplayInfo {
  const displays = listDisplays()
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const hit = displays.find(
    d => cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width && cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height
  )
  return hit ?? displays[0] ?? { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }
}

/**
 * 抓一台显示器的整屏位图。
 * 抓不到（显示器拔掉、源被系统隐藏）时抛错，由调用方决定是跳过本轮还是提示用户。
 */
export async function grabDisplay(display: DisplayInfo): Promise<BgraFrame> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: display.bounds.width, height: display.bounds.height }
  })
  // display_id 才是与显示器的对应关系；source.id 只是 screen:序号:0，末段并不是显示器 id
  let source = sources.find(s => s.display_id === String(display.id))
  // 单屏时系统偶尔不填 display_id，用唯一那块；多屏匹不上绝不能随便抓一块，
  // 否则会拿另一块屏幕的画面来比这块的基准图，每轮都是满区差异
  if (!source && sources.length === 1) source = sources[0]
  if (!source) throw new Error(`找不到显示器 ${display.id} 对应的屏幕源（显示器可能已拔掉或系统未上报）`)

  let image = source.thumbnail
  const size = image.getSize()
  // 尺寸和 DIP 不一致时缩放到 DIP，保证框选坐标与像素坐标同一套
  if (size.width !== display.bounds.width || size.height !== display.bounds.height) {
    image = image.resize({ width: display.bounds.width, height: display.bounds.height })
  }
  const width = display.bounds.width
  const height = display.bounds.height
  const bitmap = image.toBitmap()
  if (bitmap.length < width * height * 4) {
    throw new Error(`截屏位图尺寸异常：${bitmap.length} < ${width * height * 4}`)
  }
  return { width, height, bitmap }
}

/** 抓一次屏幕并裁出区域（返回独立 BGRA 缓冲区） */
export async function grabRegion(rect: ScreenRect): Promise<BgraFrame> {
  const display = displayForRect(rect)
  const frame = await grabDisplay(display)
  return cropFrame(frame, rect, display)
}

/** 从整屏位图里裁出区域；越界按边界裁掉，裁空则抛错 */
export function cropFrame(frame: BgraFrame, rect: ScreenRect, display: DisplayInfo): BgraFrame {
  return cropLocal(frame, { ...rect, x: rect.x - display.bounds.x, y: rect.y - display.bounds.y })
}

/**
 * 按「图内局部坐标」裁剪。
 * 页面来源（page.screenshot）得到的图本来就以内容区左上角为原点，
 * 不需要减显示器原点，走这个入口才不会把区域裁到屏幕外。
 */
export function cropLocal(frame: BgraFrame, rect: ScreenRect): BgraFrame {
  const localX = Math.round(rect.x)
  const localY = Math.round(rect.y)
  const x0 = Math.max(0, Math.min(localX, frame.width - 1))
  const y0 = Math.max(0, Math.min(localY, frame.height - 1))
  const x1 = Math.max(x0 + 1, Math.min(localX + rect.width, frame.width))
  const y1 = Math.max(y0 + 1, Math.min(localY + rect.height, frame.height))
  const width = x1 - x0
  const height = y1 - y0
  const bitmap = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const src = ((y0 + y) * frame.width + x0) * 4
    frame.bitmap.copy(bitmap, y * width * 4, src, src + width * 4)
  }
  return { width, height, bitmap }
}

/** BGRA → PNG dataURL（只在需要给界面看的时候做，比对本身不需要编码） */
export function toDataUrl(frame: BgraFrame): string {
  const image = nativeImage.createFromBitmap(frame.bitmap, { width: frame.width, height: frame.height })
  return `data:image/png;base64,${image.toPNG().toString('base64')}`
}

function toFrame(bgra: BgraFrame): RegionFrame {
  return { width: bgra.width, height: bgra.height, png: toDataUrl(bgra), at: Date.now() }}

export async function snapshotRegion(rect: ScreenRect): Promise<RegionFrame> {
  return toFrame(await grabRegion(rect))
}

/** 把当前画面存成某监控项的基准图，返回文件名 */
export async function saveBaseline(monitorId: string, rect: ScreenRect): Promise<string> {
  return writeBaseline(monitorId, await grabRegion(rect))
}

/** 用户直接上传截图做基准（不必非得在屏上框选，例如参照别人给的页面快照） */
export function saveBaselineFromDataUrl(monitorId: string, dataUrl: string): string | null {
  const frame = frameFromDataUrl(dataUrl)
  if (!frame) return null
  return writeBaseline(monitorId, frame)
}

export function writeBaseline(monitorId: string, frame: BgraFrame): string {
  const image = nativeImage.createFromBitmap(frame.bitmap, { width: frame.width, height: frame.height })
  const file = baselinePath(monitorId)
  writeFileSync(file, image.toPNG())
  return `${monitorId}.png`
}

/** 从 PNG dataURL 还原位图；解码失败返回 null（用户选了非图片文件、文件损坏） */
export function frameFromDataUrl(dataUrl: string): BgraFrame | null {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  if (!base64) return null
  try {
    const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'))
    const { width, height } = image.getSize()
    if (!width || !height) return null
    return { width, height, bitmap: image.toBitmap() }
  } catch (err) {
    log.warn('[vision] 图片解码失败:', err)
    return null
  }
}

/** 读基准图回 BGRA；文件不存在返回 null（表示还没截过基准） */
export function readBaseline(monitorId: string): BgraFrame | null {
  const file = baselinePath(monitorId)
  if (!existsSync(file)) return null
  const image = nativeImage.createFromPath(file)
  const { width, height } = image.getSize()
  if (!width || !height) return null
  return { width, height, bitmap: image.toBitmap() }
}

export function baselineExists(monitorId: string): boolean {
  return existsSync(baselinePath(monitorId))
}

/** 读基准图的 dataURL，给界面显示「录制时的样子」 */
export function readBaselineDataUrl(monitorId: string): string | null {
  const frame = readBaseline(monitorId)
  if (!frame) return null
  try {
    return toDataUrl(frame)
  } catch (err) {
    log.warn('[vision] 基准图读取失败:', err)
    return null
  }
}

/** 基准图连同尺寸一起返回，界面用它和当前帧左右对齐 */
export function readBaselineFrame(monitorId: string): RegionFrame | null {
  const frame = readBaseline(monitorId)
  if (!frame) return null
  return { width: frame.width, height: frame.height, png: toDataUrl(frame), at: Date.now() }
}

/** 删掉某监控项的基准图（删除监控项或删脚本时调用，避免留下无主文件） */
export function removeBaseline(monitorId: string): void {
  const file = baselinePath(monitorId)
  if (!existsSync(file)) return
  try {
    rmSync(file)
  } catch (err) {
    log.warn('[vision] 基准图删除失败:', err)
  }
}

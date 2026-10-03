/**
 * 屏幕区域像素差异比对（纯函数，不依赖 Electron，可在 Node 直接单测）
 *
 * 输入是 desktopCapturer 截图像素的 BGRA 原始字节：同一坐标系下两次抓帧的尺寸
 * 必然一致，所以这里不需要 PNG 解码库，也不需要 pixelmatch。
 *
 * 判定方式按「块」而不是逐像素：截帧会带上光标闪烁、视频/动画、亚像素渲染抖动，
 * 逐像素相等几乎永远不成立。分块之后既能容忍噪声，又能告诉界面「变化发生在哪一块」，
 * 让用户看懂是哪块数据动了。
 */

import { DEFAULT_MONITOR_HIT_RATIO } from './constants'

/** 一个块的正方形边长（像素，DIP）。太小会被抖动刷屏，太大看不清局部变化 */
export const DEFAULT_BLOCK_SIZE = 16

/** 单像素三通道绝对差之和超过该值算「这个像素变了」，用于过滤亚像素渲染抖动 */
export const DEFAULT_PIXEL_TOLERANCE = 30

/** 块内变化像素占比超过该值才算整块变化，避免一根光标划过就命中 */
export const DEFAULT_BLOCK_PIXEL_RATIO = 0.12

export interface DiffOptions {
  blockSize?: number
  pixelTolerance?: number
  blockPixelRatio?: number
  /** 变化块占比达到该值即认为「数据变了」 */
  hitRatio?: number
}

export interface DiffResult {
  /** 变化块占总块数比例，0..1 */
  ratio: number
  /** 是否达到命中阈值 */
  hit: boolean
  /** 每块是否变化，行优先，长度 blocksX * blocksY。用于界面画差异热区 */
  blocks: Uint8Array
  blocksX: number
  blocksY: number
  /** 两块尺寸不一致（例如换了显示器缩放比），无法比对 */
  sizeMismatch: boolean
  changedBlocks: number
  totalBlocks: number
}

const EMPTY_DIFF: DiffResult = {
  ratio: 0,
  hit: false,
  blocks: new Uint8Array(0),
  blocksX: 0,
  blocksY: 0,
  sizeMismatch: true,
  changedBlocks: 0,
  totalBlocks: 0
}

type Bytes = Uint8Array | Buffer

/**
 * 比对两张同尺寸截图。
 * 每块内按步长 2 采样（隔一个像素取一个），16px 块约取 64 个采样点，
 * 足够判断「这一块整块变了」，又把每帧计算量压到可以 1 秒轮询。
 */
export function diffBgra(
  a: Bytes,
  b: Bytes,
  width: number,
  height: number,
  options: DiffOptions = {}
): DiffResult {
  const blockSize = Math.max(4, options.blockSize ?? DEFAULT_BLOCK_SIZE)
  const pixelTolerance = options.pixelTolerance ?? DEFAULT_PIXEL_TOLERANCE
  const blockPixelRatio = options.blockPixelRatio ?? DEFAULT_BLOCK_PIXEL_RATIO
  // 默认阈值与监控项配置同一个常量：不传参数也不能和界面显示的默认值判出两种结果
  const hitRatio = options.hitRatio ?? DEFAULT_MONITOR_HIT_RATIO

  if (width <= 0 || height <= 0) return { ...EMPTY_DIFF, sizeMismatch: false }
  if (a.length !== b.length) return { ...EMPTY_DIFF, blocksX: 0, blocksY: 0, sizeMismatch: true }
  if (a.length < width * height * 4) return { ...EMPTY_DIFF, sizeMismatch: true }

  const blocksX = Math.ceil(width / blockSize)
  const blocksY = Math.ceil(height / blockSize)
  const blocks = new Uint8Array(blocksX * blocksY)
  let changedBlocks = 0

  for (let by = 0; by < blocksY; by++) {
    const y0 = by * blockSize
    const y1 = Math.min(height, y0 + blockSize)
    for (let bx = 0; bx < blocksX; bx++) {
      const x0 = bx * blockSize
      const x1 = Math.min(width, x0 + blockSize)
      let sampled = 0
      let changed = 0
      for (let y = y0; y < y1; y += 2) {
        const row = y * width
        for (let x = x0; x < x1; x += 2) {
          const i = (row + x) * 4
          const delta = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
          sampled++
          if (delta > pixelTolerance) changed++
        }
      }
      if (sampled > 0 && changed / sampled >= blockPixelRatio) {
        blocks[by * blocksX + bx] = 1
        changedBlocks++
      }
    }
  }

  const totalBlocks = blocksX * blocksY
  const ratio = totalBlocks === 0 ? 0 : changedBlocks / totalBlocks
  return {
    ratio,
    hit: ratio >= hitRatio,
    blocks,
    blocksX,
    blocksY,
    sizeMismatch: false,
    changedBlocks,
    totalBlocks
  }
}

/**
 * 关键词命中：在最新文本里找「应有」与「不应有」的关键词。
 * 录制时通常关心「某个值出现了/消失了」（如库存变成「无货」），所以两个列表都要支持。
 */
export interface KeywordRule {
  /** 出现即命中 */
  appear: string[]
  /** 消失即命中 */
  disappear: string[]
}

export interface KeywordHit {
  hit: boolean
  /** 本次新出现的关键词 */
  appeared: string[]
  /** 本次消失的关键词 */
  disappeared: string[]
}

export function matchKeywords(current: string, baseline: string, rule: KeywordRule): KeywordHit {
  const appeared = rule.appear.filter(word => word.trim() && current.includes(word) && !baseline.includes(word))
  const disappeared = rule.disappear.filter(word => word.trim() && baseline.includes(word) && !current.includes(word))
  return { hit: appeared.length > 0 || disappeared.length > 0, appeared, disappeared }
}

/** 文本是否变化（大小写、空白以外的内容变化才算，避免换行数抖动） */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 像素差异与关键词命中回归测试（纯函数，直接用 Node 跑 TS）
 * 用法: node tests/vision/run-test.mjs
 */
// shared 模块之间是无扩展名互相引用的（打包器解析），Node 原生 ESM 要补上 .ts 才能跑
import { registerHooks } from 'node:module'
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return nextResolve(specifier + '.ts', context)
      } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  }
})
// 静态 import 会被提升执行，必须等钩子装好再动态取
const { diffBgra, matchKeywords, normalizeText } = await import('../../shared/pixel-diff.ts')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  PASS  ' + name)
  } catch (e) {
    failed++
    console.log('  FAIL  ' + name + '  ->  ' + e.message)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/** 纯色 BGRA 帧 */
function flat(width, height, color = [200, 160, 90, 255]) {
  const bitmap = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    bitmap[i * 4] = color[0]
    bitmap[i * 4 + 1] = color[1]
    bitmap[i * 4 + 2] = color[2]
    bitmap[i * 4 + 3] = color[3]
  }
  return { width, height, bitmap }
}

/** 把 [x0,y0)-[x1,y1) 改成另一种颜色，模拟「这块数据变了」 */
function paint(frame, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * frame.width + x) * 4
      frame.bitmap[i] = color[0]
      frame.bitmap[i + 1] = color[1]
      frame.bitmap[i + 2] = color[2]
    }
  }
  return frame
}

const W = 64
const H = 64

console.log('\n[像素差异 / 关键词命中测试]')

test('同一帧比对：不命中、比例为 0', () => {
  const a = flat(W, H)
  const b = flat(W, H)
  const diff = diffBgra(a.bitmap, b.bitmap, W, H)
  assert(diff.hit === false, '相同画面不应命中')
  assert(diff.ratio === 0, '相同画面比例应为 0，实际 ' + diff.ratio)
  assert(diff.sizeMismatch === false, '同尺寸不该报尺寸不一致')
})

test('整块变色：命中，且热区落在变化的那块上', () => {
  const a = flat(W, H)
  const b = paint(flat(W, H), 16, 32, 32, 48, [10, 20, 240, 255])
  const diff = diffBgra(a.bitmap, b.bitmap, W, H)
  assert(diff.hit === true, '16x16 整块变色应命中默认阈值')
  assert(diff.changedBlocks === 1, '应只有 1 个块被判为变化，实际 ' + diff.changedBlocks)
  // 块坐标：x=16/16=1，y=32/16=2 → 索引 2*4+1
  assert(diff.blocks[2 * diff.blocksX + 1] === 1, '热区应标记在变化发生的那一块')
  assert(diff.blocksX === 4 && diff.blocksY === 4, '64px 按 16 分块应为 4x4')
})

test('光标级噪声（单像素变化）：不算命中', () => {
  const a = flat(W, H)
  const b = paint(flat(W, H), 30, 30, 31, 31, [0, 0, 0, 255])
  const diff = diffBgra(a.bitmap, b.bitmap, W, H)
  assert(diff.hit === false, '一个像素变化不该命中')
  assert(diff.changedBlocks === 0, '单像素不该让整个块命中，实际 ' + diff.changedBlocks)
})

test('亚像素抖动（低于容差的色差）：不算命中', () => {
  const a = flat(W, H)
  const b = paint(flat(W, H), 0, 0, 8, 8, [205, 163, 92, 255])
  const diff = diffBgra(a.bitmap, b.bitmap, W, H)
  assert(diff.changedBlocks === 0, '5 以内的色差应被容差吃掉')
})

test('自定义命中阈值：同一画面可按需收紧或放宽', () => {
  const a = flat(W, H)
  const b = paint(flat(W, H), 0, 0, 16, 16, [0, 0, 0, 255])
  const loose = diffBgra(a.bitmap, b.bitmap, W, H, { hitRatio: 0.01 })
  const strict = diffBgra(a.bitmap, b.bitmap, W, H, { hitRatio: 0.9 })
  assert(loose.hit === true, '低阈值应命中')
  assert(strict.hit === false, '高阈值应不命中')
})

test('尺寸不一致：标记 sizeMismatch 而不是抛错', () => {
  const a = flat(W, H)
  const b = flat(32, 32)
  const diff = diffBgra(a.bitmap, b.bitmap, W, H)
  assert(diff.sizeMismatch === true, '字节数不同应报尺寸不一致')
  assert(diff.hit === false, '比不了就不该命中')
})

test('零尺寸区域：不崩、不命中', () => {
  const diff = diffBgra(Buffer.alloc(0), Buffer.alloc(0), 0, 0)
  assert(diff.hit === false && diff.ratio === 0, '空区域应安全返回')
})

test('关键词：新出现与消失都能命中，各自只报一次', () => {
  const baseline = '库存 12 件 有货'
  const current = '库存 0 件 无货'
  const hit = matchKeywords(current, baseline, { appear: ['无货'], disappear: ['有货'] })
  assert(hit.hit === true, '出现「无货」应命中')
  assert(hit.appeared.join() === '无货', 'appeared 应只含新出现的词')
  assert(hit.disappeared.join() === '有货', 'disappeared 应只含消失的词')
})

test('关键词：本来就在的词不算「新出现」', () => {
  const hit = matchKeywords('一直无货', '本来就无货', { appear: ['无货'], disappear: [] })
  assert(hit.hit === false, '基准里已有的词不该再次触发命中')
})

test('文本归一化：换行与空格差异不影响比对', () => {
  assert(normalizeText(' 库存\n  12  件 ') === '库存 12 件', '空白应压成单个空格')
})

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`)
if (failed > 0) process.exit(1)

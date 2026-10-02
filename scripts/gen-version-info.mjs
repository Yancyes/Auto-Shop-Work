// 构建期生成 public/version-info.json，作为「版本信息」对话框的数据来源。
// 单一来源：version 取 package.json，releaseDate/releaseNotes 取 electron-builder.yml 的 releaseInfo，
// 避免手工维护 json 导致版本升级后内容不刷新。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8')

function matchReleaseDate(text) {
  const m = text.match(/^\s*releaseDate:\s*['"]?([^'"\n]+?)['"]?\s*$/m)
  return m ? m[1].trim() : ''
}

/** 解析 `releaseNotes: |` 块标量，去掉公共缩进 */
function matchReleaseNotes(text) {
  const lines = text.split(/\r?\n/)
  let keyIndent = 0
  const start = lines.findIndex(l => {
    const m = l.match(/^(\s*)releaseNotes:\s*[|>]-?\s*$/)
    if (m) { keyIndent = m[1].length; return true }
    return false
  })
  if (start === -1) {
    // 内联形式：releaseNotes: "..."
    const m = text.match(/^\s*releaseNotes:\s*['"](.*)['"]\s*$/m)
    return m ? m[1] : ''
  }
  const block = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() === '') { block.push(''); continue }
    // 缩进不超过键本身 => 块结束
    if (l.match(/^[ \t]*/)[0].length <= keyIndent) break
    block.push(l)
  }
  // 去掉尾部空行
  while (block.length && block[block.length - 1].trim() === '') block.pop()
  const minIndent = block.reduce((min, l) => {
    if (l.trim() === '') return min
    const ind = l.match(/^[ \t]*/)[0].length
    return Math.min(min, ind)
  }, Infinity)
  const strip = Number.isFinite(minIndent) ? minIndent : 0
  return block.map(l => l.slice(strip)).join('\n')
}

const out = {
  version: pkg.version,
  releaseDate: matchReleaseDate(yml),
  releaseNotes: matchReleaseNotes(yml)
}

writeFileSync(join(root, 'public', 'version-info.json'), JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(`[gen-version-info] version-info.json -> v${out.version} (${out.releaseDate})`)

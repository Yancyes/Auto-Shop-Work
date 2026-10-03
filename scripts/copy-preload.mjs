import { copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'electron', 'preload.cjs')
const dest = join(root, 'dist-electron', 'preload.cjs')

// dist-electron 是构建产物目录，vite build 可能清空它，所以这一步必须排在 vite build 之后
mkdirSync(dirname(dest), { recursive: true })
copyFileSync(src, dest)
console.log('preload.cjs copied to dist-electron/')

import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// vite-plugin-electron 不清空产物目录：每次构建都留下上一轮的哈希分包，
// 这些死代码会被 electron-builder 一起打进 app.asar，让安装包持续变大
rmSync(join(root, 'dist-electron'), { recursive: true, force: true })
console.log('dist-electron/ cleaned')

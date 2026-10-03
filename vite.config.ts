import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'node:path'

// 部分终端 / IDE 的内置 shell（例如 WorkBuddy）会向子进程注入 ELECTRON_RUN_AS_NODE=1。
// 该变量会让 electron 可执行文件退化成「纯 Node 解释器」，于是 `import 'electron'`
// 拿不到 GUI 内建模块，主进程在 ESM 加载阶段直接崩溃
// （TypeError: Cannot read properties of undefined (reading 'exports')）。
// 这里在派生 electron 子进程之前清除它，保证始终以 GUI 模式启动；
// 在没注入该变量的普通终端里，这行是没有任何副作用的 no-op。
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron')
    }
  },
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'webview'
        }
      }
    }),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: { outDir: 'dist-electron', rollupOptions: { external: ['better-sqlite3', 'playwright'] } }
        }
      }
      // 注意：preload 走 electron/preload.cjs（手写 CJS），由 scripts/copy-preload.mjs
      // 在 dev/build 时原样复制到 dist-electron/，不经 vite 构建以避免 ESM/CJS 转换问题。
      // electron/preload.ts 仅供 TypeScript 类型检查参考。
    ]),
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia'],
      resolvers: [ElementPlusResolver()],
      dts: 'src/types/auto-imports.d.ts'
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/types/components.d.ts'
    })
  ],
  server: {
    port: 5173
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})

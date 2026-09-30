import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'node:path'

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron')
    }
  },
  plugins: [
    vue(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: { outDir: 'dist-electron', rollupOptions: { external: ['better-sqlite3', 'playwright'] } }
        }
      }
      // 注意：preload.cjs 为手写的 CommonJS 文件（dist-electron/preload.cjs），
      // 不通过 vite 构建，因为 vite-plugin-electron 无法正确输出 CJS 格式。
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

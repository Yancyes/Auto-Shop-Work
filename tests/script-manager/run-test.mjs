/**
 * 测试构建器：用 esbuild 打包 entry.ts，把 ScriptManager 的外部依赖全部打桩
 * 用法: pnpm test:script-manager  或  node tests/script-manager/run-test.mjs
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(DIR, '../..')

// esbuild 是 vite 的传递依赖，pnpm 下未提升到顶层，在 .pnpm 里定位实际包目录
const pnpmDir = path.join(PROJECT_ROOT, 'node_modules/.pnpm')
const esbuildDir = fs.readdirSync(pnpmDir).find(d => d.startsWith('esbuild@'))
if (!esbuildDir) throw new Error('未找到 esbuild 包（node_modules/.pnpm/esbuild@*）')
const require = createRequire(path.join(pnpmDir, esbuildDir, 'node_modules/esbuild/package.json'))
const esbuild = require('esbuild')

const STUBS = {
  'electron-log': `
    const noop = () => {}
    export default { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop }
  `,
  'ipc': `
    export function pushEvent(channel, payload) {
      globalThis.__TEST.events.push({ channel, payload })
    }
  `,
  'repository': `
    const T = () => globalThis.__TEST
    export function getScript(id) { return T().scripts.get(id) ?? null }
    export function getScriptSteps(id) { return T().steps.get(id) ?? [] }
    export function getScriptMonitors(id) { return T().monitors.get(id) ?? [] }
    export function updateScriptStatus(id, status) { const s = T().scripts.get(id); if (s) s.status = status }
    export function incrementRunCount(id) { const s = T().scripts.get(id); if (s) s.runCount++ }
    export function insertLog(entry) {
      if (T().logThrows) throw new Error('SqliteError: FOREIGN KEY constraint failed')
      T().logs.push(entry); return entry
    }
  `,
  'mini-control': `
    const T = () => globalThis.__TEST
    export function bindRunFocus(scriptId, title) { T().mini.push({ type: 'bind', scriptId, title }) }
    export function clearMiniTarget(scriptId) { T().mini.push({ type: 'clear', scriptId }) }
  `,
  'browser-manager': `
    export class BrowserManager {
      static getInstance() { return new BrowserManager() }
      scheduleIdleCheck() { globalThis.__TEST.idleChecks++ }
    }
  `,
  'config': `
    export function getSettings() {
      const T = () => globalThis.__TEST
      return {
        script: {
          runInterval: T().runInterval ?? 0,
          maxConcurrency: T().maxConcurrency ?? 1,
          retryCount: T().retryCount ?? 0
        }
      }
    }
  `,
  'hud-overlay': `
    export function showHud(state) { globalThis.__TEST.hud.push({ type: 'show', state }) }
    export function updateHud(patch) { globalThis.__TEST.hud.push({ type: 'update', patch }) }
    export function hideHud(scriptId) { globalThis.__TEST.hud.push({ type: 'hide', scriptId }) }
  `,
  'notifier': `
    export function notifyScriptComplete(scriptId, message, success) {
      globalThis.__TEST.notifications.push({ type: 'complete', scriptId, message, success })
    }
    export function notifyManualIntervention(scriptName, stepIndex, error) {
      globalThis.__TEST.notifications.push({ type: 'intervention', scriptName, stepIndex, error })
    }
  `,
  'script-executor': `
    export class ScriptExecutor {
      constructor(script, steps, totalRuns, currentRun, monitors) {
        this.script = script
        this.steps = steps
        this.totalRuns = totalRuns
        this.currentRun = currentRun
        this.monitors = monitors ?? []
        this._terminated = false
        this._resolve = null
        globalThis.__TEST.executors.push(this)
      }
      async run() {
        const mode = globalThis.__TEST.executorMode
        if (mode === 'hang') {
          return await new Promise(resolve => { this._resolve = resolve })
        }
        await new Promise(r => setTimeout(r, 5))
        return !this._terminated && mode !== 'fail'
      }
      terminate() {
        this._terminated = true
        if (this._resolve) { const r = this._resolve; this._resolve = null; r(false) }
      }
      pause() { this.paused = true }
      resume() { this.paused = false }
      setSteps(steps) { this.steps = steps; globalThis.__TEST.stepUpdates.push({ scriptId: this.script.id, steps }) }
      skipCurrentStep() { this.skipped = true }
      stepBack() { this.wentBack = true }
      resolveTakeover(action) { this.takeoverAction = action }
    }
  `
}

const stubPlugin = {
  name: 'stubs',
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'electron-log') return { path: 'electron-log', namespace: 'stub' }
      const resolved = path.resolve(args.resolveDir, args.path).replace(/\\/g, '/')
      if (resolved.endsWith('electron/script/script-executor')) return { path: 'script-executor', namespace: 'stub' }
      if (resolved.endsWith('electron/script/hud-overlay')) return { path: 'hud-overlay', namespace: 'stub' }
      if (resolved.endsWith('electron/notify/notifier')) return { path: 'notifier', namespace: 'stub' }
      if (resolved.endsWith('electron/window/mini-control')) return { path: 'mini-control', namespace: 'stub' }
      if (resolved.endsWith('electron/db/repository')) return { path: 'repository', namespace: 'stub' }
      if (resolved.endsWith('electron/browser/browser-manager')) return { path: 'browser-manager', namespace: 'stub' }
      if (resolved.endsWith('electron/config')) return { path: 'config', namespace: 'stub' }
      if (resolved.endsWith('electron/ipc')) return { path: 'ipc', namespace: 'stub' }
      return null
    })
    build.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: STUBS[args.path],
      loader: 'js'
    }))
  }
}

await esbuild.build({
  entryPoints: [path.join(DIR, 'entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: path.join(DIR, 'out.mjs'),
  plugins: [stubPlugin],
  logLevel: 'warning'
})

await import(pathToFileURL(path.join(DIR, 'out.mjs')).href)

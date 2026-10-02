/**
 * ScriptManager 调度逻辑回归测试
 * 依赖通过 esbuild 插件打桩（repository / browser-manager / ipc / config / script-executor / electron-log）
 */
import { ScriptManager } from '../../electron/script/script-manager'

interface TestState {
  events: { channel: string; payload: any }[]
  logs: any[]
  executors: any[]
  idleChecks: number
  scripts: Map<number, { id: number; name: string; status: string; runCount: number }>
  steps: Map<number, any[]>
  executorMode: 'success' | 'fail' | 'hang'
  runInterval: number
}

declare const globalThis: any

function T(): TestState { return globalThis.__TEST }

function reset() {
  globalThis.__TEST = {
    events: [], logs: [], executors: [], idleChecks: 0,
    scripts: new Map(), steps: new Map(),
    executorMode: 'success', runInterval: 0
  } satisfies TestState
}

function addScript(id: number, stepCount = 2) {
  T().scripts.set(id, { id, name: 'script-' + id, status: 'ready', runCount: 0 })
  T().steps.set(id, Array.from({ length: stepCount }, (_, i) => ({ id: i + 1, action: 'click', selector: '#x' })))
}

function completes(scriptId: number) {
  return T().events.filter(e => e.channel === 'script:complete' && e.payload.scriptId === scriptId)
}

function scriptOf(id: number) { return T().scripts.get(id)! }

async function waitFor(cond: () => boolean, ms = 3000, label = ''): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('TIMEOUT ' + label)
    await new Promise(r => setTimeout(r, 10))
  }
}

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg) }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

let passed = 0, failed = 0
async function test(name: string, fn: () => Promise<void>) {
  reset()
  try {
    await fn()
    passed++
    console.log('  PASS  ' + name)
  } catch (e) {
    failed++
    console.log('  FAIL  ' + name + '  ->  ' + (e as Error).message)
  }
}

const sm = ScriptManager.getInstance()

async function main() {
  console.log('\n[ScriptManager 回归测试]')

  await test('runScript 非阻塞：无限循环下入队后立即返回', async () => {
    addScript(1)
    T().executorMode = 'hang'
    sm.runScript(1, 0) // count=0 → Infinity，同步返回
    assert(completes(1).length === 0, '入队后不应立即有完成事件')
    assert(scriptOf(1).status === 'running', '入队后状态应为 running')
    // 清理
    sm.stopAll()
    await waitFor(() => completes(1).length === 1, 3000, 'stopAll 后应有完成事件')
    await sleep(100)
  })

  await test('同一脚本重复启动被拒绝', async () => {
    addScript(1)
    T().executorMode = 'hang'
    sm.runScript(1, 0)
    let threw = false
    try {
      sm.runScript(1, 0)
    } catch (e) {
      threw = true
      assert((e as Error).message.includes('重复'), '错误信息应说明重复启动')
    }
    assert(threw, '重复启动同脚本应抛错')
    sm.stopAll()
    await waitFor(() => completes(1).length === 1)
    await sleep(100)
  })

  await test('自然完成：状态 completed + runCount 累加 + 完成事件恰好一次', async () => {
    addScript(1)
    sm.runScript(1, 2)
    await waitFor(() => completes(1).length >= 1, 3000, '等待完成事件')
    await sleep(100)
    assert(completes(1).length === 1, '完成事件应恰好一次，实际 ' + completes(1).length)
    assert(completes(1)[0].payload.success === true, '全部成功时 success 应为 true')
    assert(scriptOf(1).status === 'completed', '状态应为 completed，实际 ' + scriptOf(1).status)
    assert(scriptOf(1).runCount === 2, 'runCount 应为 2，实际 ' + scriptOf(1).runCount)
    assert(T().idleChecks >= 1, '队列排空后应调度浏览器空闲检查')
  })

  await test('执行失败：状态 failed + success=false', async () => {
    addScript(1)
    T().executorMode = 'fail'
    sm.runScript(1, 1)
    await waitFor(() => completes(1).length === 1)
    await sleep(50)
    assert(completes(1)[0].payload.success === false, '失败时 success 应为 false')
    assert(scriptOf(1).status === 'failed', '状态应为 failed')
    assert(scriptOf(1).runCount === 0, '失败轮次不应累加 runCount')
  })

  await test('终止当前脚本：完成事件恰好一次（无重复通知）', async () => {
    addScript(1)
    T().executorMode = 'hang'
    sm.runScript(1, 0)
    await waitFor(() => T().executors.length === 1, 3000, '等待 executor 创建')
    sm.terminateCurrent(1)
    await waitFor(() => completes(1).length >= 1, 3000, '终止后应有完成事件')
    await sleep(150)
    assert(completes(1).length === 1, '终止路径完成事件应恰好一次，实际 ' + completes(1).length)
    assert(scriptOf(1).status === 'failed', '被终止脚本状态应为 failed')
  })

  await test('连点两次终止：仍然只通知一次', async () => {
    addScript(1)
    T().executorMode = 'hang'
    sm.runScript(1, 0)
    await waitFor(() => T().executors.length === 1)
    sm.terminateCurrent(1)
    sm.terminateCurrent(1) // 连点
    await waitFor(() => completes(1).length >= 1)
    await sleep(150)
    assert(completes(1).length === 1, '连点终止应只通知一次，实际 ' + completes(1).length)
  })

  await test('stopAll：当前执行 + 排队任务各通知一次，前端状态能复位', async () => {
    addScript(1); addScript(2)
    T().executorMode = 'hang'
    sm.runScript(1, 0)
    await waitFor(() => T().executors.length === 1)
    sm.runScript(2, 1) // 排队
    sm.stopAll()
    await waitFor(() => completes(1).length >= 1 && completes(2).length >= 1, 3000, 'stopAll 应通知所有受影响脚本')
    await sleep(150)
    assert(completes(1).length === 1, '当前脚本应恰好通知一次，实际 ' + completes(1).length)
    assert(completes(2).length === 1, '排队脚本应恰好通知一次，实际 ' + completes(2).length)
    assert(scriptOf(1).status === 'failed' && scriptOf(2).status === 'failed', '两者状态都应为 failed（不卡在 running）')
  })

  await test('stopAll 之后立即启动新脚本：新任务能被接管执行（并发回归）', async () => {
    addScript(1); addScript(3)
    T().executorMode = 'hang'
    sm.runScript(1, 0)
    await waitFor(() => T().executors.length === 1)
    sm.stopAll()
    // 旧循环尚未收尾时立刻启动新脚本
    T().executorMode = 'success'
    sm.runScript(3, 1)
    await waitFor(() => completes(3).length === 1, 3000, '新脚本应被执行并完成')
    assert(completes(3)[0].payload.success === true, '新脚本应成功完成')
    assert(scriptOf(3).status === 'completed', '新脚本状态应为 completed')
    await sleep(100)
  })

  await test('终止排队中的脚本：从队列移除并立即通知', async () => {
    addScript(1); addScript(2)
    T().executorMode = 'hang'
    sm.runScript(1, 0)
    await waitFor(() => T().executors.length === 1)
    sm.runScript(2, 1)
    sm.terminateCurrent(2) // 终止的是排队中的 2，不是当前的 1
    assert(completes(2).length === 1, '排队脚本应立即收到一次完成通知')
    assert(scriptOf(2).status === 'failed', '排队脚本状态应为 failed')
    // 脚本 1 不受影响，停止它清理现场
    sm.terminateCurrent(1)
    await waitFor(() => completes(1).length === 1)
    await sleep(100)
  })

  await test('轮次间隔：runInterval 设置项生效', async () => {
    addScript(1)
    T().runInterval = 1 // 1 秒
    const t0 = Date.now()
    sm.runScript(1, 2)
    await waitFor(() => completes(1).length === 1, 5000)
    const elapsed = Date.now() - t0
    assert(elapsed >= 900, '2 轮执行应间隔约 1s，实际 ' + elapsed + 'ms')
  })

  console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`)
  if (failed > 0) process.exit(1)
  process.exit(0)
}

main().catch(e => {
  console.error('测试运行器异常:', e)
  process.exit(1)
})

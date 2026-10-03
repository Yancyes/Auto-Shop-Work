/**
 * ScriptManager 调度逻辑回归测试
 * 依赖通过 esbuild 插件打桩（repository / browser-manager / ipc / config / script-executor / electron-log）
 */
import { ScriptManager } from '../../electron/script/script-manager'
import { parseDataText } from '../../shared/script-vars'

interface TestState {
  events: { channel: string; payload: any }[]
  logs: any[]
  executors: any[]
  idleChecks: number
  scripts: Map<number, { id: number; name: string; status: string; runCount: number }>
  steps: Map<number, any[]>
  /** 脚本挂的屏幕监控项（走 getScriptMonitors 桩） */
  monitors: Map<number, any[]>
  executorMode: 'success' | 'fail' | 'hang'
  runInterval: number
  maxConcurrency: number
  /** 让 insertLog 抛错，模拟老库 run_logs 外键指向已废弃表 */
  logThrows: boolean
  hud: { type: 'show' | 'update' | 'hide'; state?: any; patch?: any; scriptId?: number }[]
  notifications: any[]
  /** 迷你控制窗绑定记录（bindRunFocus / clearMiniTarget） */
  mini: { type: 'bind' | 'clear'; scriptId: number; title?: string }[]
  /** 运行中热改步骤的记录 */
  stepUpdates: { scriptId: number; steps: any[] }[]
}

declare const globalThis: any

function T(): TestState { return globalThis.__TEST }

function reset() {
  globalThis.__TEST = {
    events: [], logs: [], executors: [], idleChecks: 0,
    scripts: new Map(), steps: new Map(), monitors: new Map(),
    executorMode: 'success', runInterval: 0, maxConcurrency: 1, logThrows: false,
    hud: [], notifications: [], mini: [], stepUpdates: []
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

  await test('轮次间隔中终止：立即打断间隔、不启动下一轮、完成恰好一次', async () => {
    addScript(1)
    T().executorMode = 'success'
    T().runInterval = 2 // 2 秒，足够在间隔中终止
    sm.runScript(1, 3)
    await waitFor(() => T().executors.length === 1, 3000, '第一轮 executor 创建')
    // 等第一轮成功结束、进入轮次间隔（此时 completes=0、executors 仍为 1、runCount>=1）
    await waitFor(
      () => completes(1).length === 0 && T().executors.length === 1 && scriptOf(1).runCount >= 1,
      1500, '进入轮次间隔'
    )
    const t0 = Date.now()
    sm.terminateCurrent(1)
    await waitFor(() => completes(1).length >= 1, 1500, '终止应快速打断间隔并产出完成事件')
    const waited = Date.now() - t0
    await sleep(200)
    assert(completes(1).length === 1, '完成事件应恰好一次，实际 ' + completes(1).length)
    assert(T().executors.length === 1, '终止后不应再创建下一轮 executor，实际 ' + T().executors.length)
    assert(waited < 1500, '轮次间隔应被快速打断（远小于 2s），实际等待 ' + waited + 'ms')
    assert(scriptOf(1).status === 'failed', '终止后状态应为 failed，实际 ' + scriptOf(1).status)
  })

  await test('轮次间隔中 stopAll 并立即启动新脚本：新任务不被队首收尾误删', async () => {
    addScript(1); addScript(3)
    T().executorMode = 'success'
    T().runInterval = 2 // 留出充足的间隔窗口
    sm.runScript(1, 3)
    await waitFor(
      () => completes(1).length === 0 && T().executors.length === 1 && scriptOf(1).runCount >= 1,
      1500, '进入轮次间隔'
    )
    sm.stopAll()
    // 间隔窗口内启动另一个脚本：它排在正在收尾的队首之后
    sm.runScript(3, 1)
    await waitFor(() => completes(3).length === 1, 3000, '新脚本应被执行并完成，而不是被静默丢弃')
    assert(completes(1).length === 1, '被停止的脚本应恰好通知一次')
    assert(completes(3)[0].payload.success === true, '新脚本应执行成功')
    assert(scriptOf(3).status === 'completed', '新脚本状态应为 completed，实际 ' + scriptOf(3).status)
    assert(T().executors.length === 2, '不应创建多余 executor，实际 ' + T().executors.length)
    await sleep(150)
    assert(completes(3).length === 1 && completes(1).length === 1, '收尾后不应有重复通知')
  })

  await test('执行浮窗：自然结束后关闭，不留残留窗口', async () => {
    addScript(1)
    sm.runScript(1, 2)
    await waitFor(() => completes(1).length === 1, 3000, '等待完成')
    await sleep(100)
    assert(T().hud.some(e => e.type === 'show'), '执行开始应显示浮窗')
    const shows = T().hud.filter(e => e.type === 'show').length
    assert(shows === 1, '多轮执行应只打开一次浮窗（不每轮闪烁），实际 ' + shows)
    assert(T().hud[T().hud.length - 1].type === 'hide', '最后一条应是关闭浮窗')
  })

  await test('执行浮窗：被终止后同样关闭', async () => {
    addScript(1)
    T().executorMode = 'hang'
    sm.runScript(1, 0)
    await waitFor(() => T().executors.length === 1, 3000, '等待 executor')
    sm.terminateCurrent(1)
    await waitFor(() => completes(1).length === 1, 3000, '等待完成事件')
    await sleep(100)
    assert(T().hud[T().hud.length - 1].type === 'hide', '终止后浮窗应关闭，否则用户会看到卡住的进度条')
  })

  await test('写日志失败不打断收尾：完成事件照常、脚本不会被重跑', async () => {
    addScript(1)
    T().logThrows = true // 模拟老库 run_logs 外键指向已废弃的 task_records
    sm.runScript(1, 1)
    await waitFor(() => completes(1).length === 1, 3000, 'insertLog 抛错时也应收到完成事件')
    await sleep(300)
    assert(completes(1).length === 1, '完成事件应恰好一次')
    assert(T().executors.length === 1, '队列卡死会反复重跑脚本，实际 executor 数 ' + T().executors.length)
    assert(scriptOf(1).status === 'completed', '状态应落库为 completed，实际 ' + scriptOf(1).status)
  })

  await test('无步骤的脚本：也要发出完成事件，不能让界面卡在「正在执行」', async () => {
    addScript(1, 0) // 0 步骤
    sm.runScript(1, 1)
    await waitFor(() => completes(1).length === 1, 3000, '无步骤应立即收尾并通知')
    assert(completes(1)[0].payload.success === false, '无步骤应为失败')
    assert(scriptOf(1).status === 'failed', '无步骤状态应为 failed')
    assert(T().executors.length === 0, '无步骤不应创建 executor')
  })

  await test('空输入框传来的非法次数按 1 次执行，不会被误判成无限循环', async () => {
    addScript(1)
    sm.runScript(1, null as unknown as number)
    await waitFor(() => completes(1).length === 1, 3000, '非法次数应正常执行一次')
    assert(T().executors.length === 1, '非法次数应只执行 1 轮，实际 ' + T().executors.length)
  })

  await test('并发上限：超过 maxConcurrency 的脚本排队等待，不被派发', async () => {
    addScript(1); addScript(2); addScript(3)
    T().maxConcurrency = 2
    T().executorMode = 'hang'
    sm.runScript(1, 0); sm.runScript(2, 0); sm.runScript(3, 0)
    await waitFor(() => T().executors.length === 2, 3000, '应有 2 个脚本并发执行')
    await sleep(200)
    assert(T().executors.length === 2, '并发上限外的脚本不应被派发，实际 ' + T().executors.length)
    assert(completes(3).length === 0, '排队中的脚本不应已完成')
    sm.stopAll()
    await waitFor(
      () => completes(1).length === 1 && completes(2).length === 1 && completes(3).length === 1,
      3000, 'stopAll 应让三个脚本各完成一次'
    )
    await sleep(150)
    assert(T().executors.length === 2, 'stopAll 后不应再派发排队脚本')
  })

  await test('并发执行：终止单个脚本不影响其它脚本，浮窗各自关闭', async () => {
    addScript(1); addScript(2)
    T().maxConcurrency = 2
    T().executorMode = 'hang'
    sm.runScript(1, 0); sm.runScript(2, 0)
    await waitFor(() => T().executors.length === 2, 3000, '两个脚本应并发执行')
    sm.terminateCurrent(1)
    await waitFor(() => completes(1).length === 1, 3000, '被终止脚本应有完成事件')
    await sleep(150)
    assert(completes(2).length === 0, '未被终止的脚本应继续执行')
    assert(T().executors.length === 2, '终止一个脚本不应创建多余 executor')
    assert(
      T().hud.filter(e => e.type === 'hide' && e.scriptId === 1).length === 1,
      '脚本 1 的浮窗应恰好关闭一次'
    )
    assert(
      T().hud.filter(e => e.type === 'hide' && e.scriptId === 2).length === 0,
      '脚本 2 仍在执行，浮窗不应关闭'
    )
    sm.stopAll()
    await waitFor(() => completes(2).length === 1, 3000)
    await sleep(150)
    assert(completes(1).length === 1 && completes(2).length === 1, '两个脚本应各通知一次')
    assert(T().hud.filter(e => e.type === 'hide' && e.scriptId === 2).length === 1, '脚本 2 浮窗应关闭一次')
  })

  await test('并发调度：槽位释放后排队任务自动顶上', async () => {
    addScript(1); addScript(2)
    T().maxConcurrency = 1
    T().executorMode = 'hang'
    sm.runScript(1, 0)
    sm.runScript(2, 1)
    await waitFor(() => T().executors.length === 1, 3000, '脚本 1 应开始执行')
    assert(completes(2).length === 0, '并发=1 时脚本 2 应排队')
    T().executorMode = 'success'
    sm.terminateCurrent(1)
    await waitFor(() => completes(2).length === 1, 3000, '脚本 1 收尾后脚本 2 应自动顶上并完成')
    assert(completes(2)[0].payload.success === true, '脚本 2 应执行成功')
    await sleep(100)
  })

  await test('系统通知接线：脚本完成会推送一条桌面通知', async () => {
    addScript(1)
    sm.runScript(1, 1)
    await waitFor(() => completes(1).length === 1, 3000)
    await sleep(50)
    const items = T().notifications.filter(n => n.type === 'complete')
    assert(items.length === 1, '应有一条完成通知，实际 ' + items.length)
    assert(items[0].scriptId === 1 && items[0].success === true, '通知应带上脚本 ID 与成功标记')
  })

  await test('自定义数据：每轮取一行替换步骤里的 {{变量}}', async () => {
    addScript(1, 1)
    T().steps.set(1, [{ id: 1, action: 'fill', selector: '#kw', value: '{{关键词}}' }])
    const s = scriptOf(1) as any
    s.targetUrl = 'https://shop.example'
    s.dataJson = JSON.stringify({ columns: ['关键词'], rows: [['耳机'], ['手机壳']] })
    sm.runScript(1, 2)
    await waitFor(() => T().executors.length === 2, 3000, '两轮执行')
    assert(T().executors[0].steps[0].value === '耳机', '第 1 轮应取第 1 行')
    assert(T().executors[1].steps[0].value === '手机壳', '第 2 轮应取第 2 行')
    assert(T().steps.get(1)?.[0]?.value === '{{关键词}}', '队列里的模板步骤不能被改坏')
    await waitFor(() => completes(1).length === 1, 3000, '脚本 1 收尾')
  })

  await test('自定义数据：行数不足从头循环，空格子回落本次值', async () => {
    addScript(1, 1)
    T().steps.set(1, [{ id: 1, action: 'fill', selector: '#kw', value: '{{关键词}}' }])
    const s = scriptOf(1) as any
    s.targetUrl = 'https://shop.example'
    s.dataJson = JSON.stringify({ columns: ['关键词'], rows: [['耳机'], ['']] })
    sm.runScript(1, 3, { 关键词: '兜底' })
    await waitFor(() => T().executors.length === 3, 3000, '三轮执行')
    assert(T().executors[0].steps[0].value === '耳机', '第 1 轮用行数据')
    assert(T().executors[1].steps[0].value === '兜底', '空行回落本次值')
    assert(T().executors[2].steps[0].value === '耳机', '行数不足应从头循环')
    await waitFor(() => completes(1).length === 1, 3000, '等本轮收尾，别把队列残留带给下一个用例')
  })

  await test('自定义数据：变量没有数据时拒绝启动，不入队', async () => {
    addScript(1, 1)
    T().steps.set(1, [{ id: 1, action: 'fill', selector: '#kw', value: '{{关键词}}' }])
    const s = scriptOf(1) as any
    s.targetUrl = 'https://shop.example'
    s.dataJson = ''
    let message = ''
    try {
      sm.runScript(1, 1)
    } catch (e) {
      message = (e as Error).message
    }
    assert(message.includes('关键词'), '应报出缺数据的变量名')
    assert(T().executors.length === 0, '不应派发执行')
    assert(s.status === 'ready', '状态不应被改成 running')
  })

  await test('监控区域：脚本执行时把监控项交给执行器，结束后清掉迷你窗目标', async () => {
    addScript(1)
    T().monitors.set(1, [{ id: 'm1', label: '库存', source: 'screen' }])
    sm.runScript(1, 1)
    await waitFor(() => T().executors.length === 1, 3000, 'executor 创建')
    assert(T().executors[0].monitors.length === 1, '执行器应拿到 1 条监控项')
    assert(T().mini.some(e => e.type === 'bind' && e.scriptId === 1), '应把迷你窗绑定到这次执行')
    await waitFor(() => completes(1).length === 1, 3000, '完成')
    assert(T().mini.some(e => e.type === 'clear' && e.scriptId === 1), '收尾应清掉迷你窗目标')
  })

  await test('运行中热改步骤：按当前轮的变量值替换后交给执行器', async () => {
    addScript(1, 1)
    T().steps.set(1, [{ id: 1, action: 'fill', selector: '#kw', value: '{{关键词}}' }])
    const s = scriptOf(1) as any
    s.targetUrl = 'https://shop.example'
    s.dataJson = JSON.stringify({ columns: ['关键词'], rows: [['耳机'], ['手机壳']] })
    T().executorMode = 'hang'
    sm.runScript(1, 2)
    await waitFor(() => T().executors.length === 1, 3000, '第一轮开始')
    const okUpdated = sm.updateLiveSteps(1, [{ id: 9, action: 'fill', selector: '#kw', value: '{{关键词}}' }])
    assert(okUpdated, '执行中改步骤应返回 true')
    assert(T().stepUpdates.length === 1, '应推送一次热更新')
    assert(T().stepUpdates[0].steps[0].value === '耳机', '第 1 轮的热更新应按第 1 行数据替换')
    assert(T().steps.get(1)?.[0]?.value === '{{关键词}}', '库里的模板步骤不应被改坏')
    sm.stopAll()
    await waitFor(() => completes(1).length === 1, 3000, '收尾')
  })

  await test('跳过 / 回退 / 接管：只作用于正在执行的脚本，没在执行时返回 false', async () => {
    addScript(1)
    assert(!sm.skipCurrentStep(1), '未执行时跳过应返回 false')
    assert(!sm.stepBack(1), '未执行时回退应返回 false')
    assert(!sm.resolveTakeover(1, 'resume'), '未执行时接管处理应返回 false')
    T().executorMode = 'hang'
    sm.runScript(1, 0)
    await waitFor(() => T().executors.length === 1, 3000, 'executor 创建')
    assert(sm.skipCurrentStep(1), '执行中跳过应返回 true')
    assert(T().executors[0].skipped === true, '跳过应打到执行器上')
    assert(sm.stepBack(1), '执行中回退应返回 true')
    assert(T().executors[0].wentBack === true, '回退应打到执行器上')
    assert(sm.resolveTakeover(1, 'skip'), '执行中接管处理应返回 true')
    assert(T().executors[0].takeoverAction === 'skip', '接管动作应透传给执行器')
    // abort 不该只停执行器：要走 manager 的终止路径，否则多轮任务会把它当「这轮失败」接着跑下一轮
    assert(sm.resolveTakeover(1, 'abort'), '执行中终止应返回 true')
    assert(T().executors[0]._terminated === true, 'abort 应终止当前执行器')
    await waitFor(() => completes(1).length === 1, 3000, 'abort 后收尾')
    await sleep(100)
    assert(T().executors.length === 1, 'abort 后不应再开新一轮，实际 executor 数 ' + T().executors.length)
  })

  await test('自定义数据：粘贴解析兼容 AI 常见的几种回复格式', async () => {
    const cols = ['关键词', '数量']
    const eq = (a: string[][], b: string[][], label: string) =>
      assert(JSON.stringify(a) === JSON.stringify(b), label + ' -> ' + JSON.stringify(a))
    eq(parseDataText('[{"关键词":"耳机","数量":"2"},{"数量":"5","关键词":"手机壳"}]', cols),
      [['耳机', '2'], ['手机壳', '5']], 'JSON 对象数组（键序不同也要对齐）')
    eq(parseDataText('```json\n[{"关键词":"耳机","数量":"2"}]\n```', cols), [['耳机', '2']], '带 ``` 围栏')
    eq(parseDataText('[["耳机","2"],["手机壳","5"]]', cols), [['耳机', '2'], ['手机壳', '5']], '二维数组')
    eq(parseDataText('数量,关键词\n2,耳机\n5,手机壳', cols), [['耳机', '2'], ['手机壳', '5']], 'CSV 表头换序')
    eq(parseDataText('耳机,2\n手机壳,5', cols), [['耳机', '2'], ['手机壳', '5']], 'CSV 无表头按位置')
    eq(parseDataText('耳机\t2\n手机壳\t5', cols), [['耳机', '2'], ['手机壳', '5']], '制表符分隔')
    eq(parseDataText('"含逗号,名字",2', ['名称', '数量']), [['含逗号,名字', '2']], '引号里的逗号不切')
  })

  console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`)
  if (failed > 0) process.exit(1)
  process.exit(0)
}

main().catch(e => {
  console.error('测试运行器异常:', e)
  process.exit(1)
})

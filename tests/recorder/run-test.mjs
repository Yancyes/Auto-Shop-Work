/**
 * 录制注入脚本回归测试（点击/双击/输入的步骤采集保真度）
 *
 * 注入代码是一整段字符串，语法错了或事件顺序变了都不会在编译期报警，
 * 只会让用户录出来的步骤莫名其妙多一条/少一条，所以这里用最小 DOM 假对象跑一遍。
 * 用法: node tests/recorder/run-test.mjs
 */
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
const { RECORDER_INJECT_SCRIPT } = await import('../../shared/recorder-inject.ts')

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 元素给 id：getSelector 走 #id 分支，就不必再伪造 querySelectorAll/parentElement */
function element(id, text = '') {
  return { tagName: 'BUTTON', id, textContent: text, className: '' }
}

/**
 * 起一份注入脚本，返回「采集到的步骤」与派发事件的入口。
 * document/window 只实现脚本真正用到的 API，多余的一律不给，避免测的是一套假世界。
 */
function createPage() {
  const recorded = []
  const handlers = { document: new Map(), window: new Map() }

  const addInto = map => (type, fn) => {
    if (!map.has(type)) map.set(type, [])
    map.get(type).push(fn)
  }
  const document = {
    body: { tagName: 'BODY' },
    addEventListener: addInto(handlers.document),
    querySelectorAll: () => []
  }
  const window = {
    scrollY: 0,
    pageYOffset: 0,
    addEventListener: addInto(handlers.window)
  }
  const console_ = {
    log(text) {
      if (typeof text !== 'string' || !text.startsWith('__RECORD__:')) return
      recorded.push(JSON.parse(text.slice('__RECORD__:'.length)))
    }
  }
  const location = { href: 'https://example.com/start' }
  // pushState 的原始实现改地址：注入脚本包过一层后会自动补采 navigate
  const history = {
    pushState() {
      location.href = 'https://example.com/next'
    },
    replaceState() {}
  }

  new Function('window', 'document', 'CSS', 'console', 'location', 'history', RECORDER_INJECT_SCRIPT)(
    window,
    document,
    { escape: value => value },
    console_,
    location,
    history
  )

  function fire(scope, type, event) {
    for (const fn of handlers[scope].get(type) ?? []) fn(event)
  }
  return { recorded, fire, history }
}

/** 采集到的动作序列，按顺序比对 */
function actions(recorded) {
  return recorded.map(r => r.action).join(',')
}

async function main() {
  console.log('\n[录制注入脚本测试]')

  await test('普通单击：落一条 click（延后到双击窗口结束）', async () => {
    const page = createPage()
    const btn = element('submit')
    page.fire('document', 'mousedown', { detail: 1, target: btn })
    assert(actions(page.recorded) === '', '单击不该在 mousedown 当帧就落账')
    await sleep(300)
    assert(actions(page.recorded) === 'click', '应恰好采到一条 click，实际: ' + actions(page.recorded))
    assert(page.recorded[0].selector === '#submit', '选择器应取到 #id')
  })

  await test('双击：只落一条 dblclick，不再多采一次单击', async () => {
    const page = createPage()
    const cell = element('row')
    page.fire('document', 'mousedown', { detail: 1, target: cell })
    page.fire('document', 'mousedown', { detail: 2, target: cell })
    await sleep(300)
    assert(actions(page.recorded) === 'dblclick', '双击不该录成 click+dblclick，实际: ' + actions(page.recorded))
  })

  await test('连点两个不同元素：两条 click 都保留且顺序不变', async () => {
    const page = createPage()
    const a = element('a')
    const b = element('b')
    page.fire('document', 'mousedown', { detail: 1, target: a })
    page.fire('document', 'mousedown', { detail: 1, target: b })
    await sleep(300)
    assert(actions(page.recorded) === 'click,click', '实际: ' + actions(page.recorded))
    assert(page.recorded[0].selector === '#a' && page.recorded[1].selector === '#b', '单击顺序应与操作顺序一致')
  })

  await test('单击后立刻跳转：卸载前把待记的单击落账', async () => {
    const page = createPage()
    const link = element('go')
    page.fire('document', 'mousedown', { detail: 1, target: link })
    page.fire('window', 'beforeunload', {})
    assert(actions(page.recorded) === 'click', '整页跳转不该丢掉触发跳转的那一次单击')
  })

  await test('输入框：change 触发时不重复录同一次输入', async () => {
    const page = createPage()
    const input = { tagName: 'INPUT', id: 'kw', textContent: '', value: 'abc' }
    page.fire('document', 'input', { target: input })
    page.fire('document', 'change', { target: input })
    await sleep(500)
    assert(actions(page.recorded) === 'fill', 'input+change 应只采一条 fill，实际: ' + actions(page.recorded))
    assert(page.recorded[0].value === 'abc', 'fill 要带上输入值')
  })

  await test('SPA 路由：pushState 换页会补一条 navigate', async () => {
    const page = createPage()
    page.history.pushState({}, '')
    assert(actions(page.recorded) === 'navigate', '实际: ' + actions(page.recorded))
    assert(page.recorded[0].value === 'https://example.com/next', 'navigate 要带上换到的地址')
  })

  console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`)
  if (failed > 0) process.exit(1)
}

main()

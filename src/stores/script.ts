import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ipc } from '@/api'
import { DEFAULT_STEP_DELAY } from '../../shared/constants'
import { parseMonitors } from '../../shared/monitor-config'
import type {
  MonitorHit,
  MonitorStatus,
  RecordedScript,
  RecordedStep,
  RegionMonitor,
  TakeoverAction
} from '../../shared/types'

/** 单个执行中脚本的进度状态（对应 script:progress 事件） */
export interface ProgressState {
  scriptId: number
  currentRun: number
  /** -1 表示无限循环 */
  totalRuns: number
  stepIndex: number
  totalSteps: number
  stepDescription: string
  stepStartedAt: number | null
  paused: boolean
  /** 因监控命中而等待用户接管 */
  takeover: boolean
}

export const useScriptStore = defineStore('script', () => {
  const scripts = ref<RecordedScript[]>([])

  // 录制状态
  const isRecording = ref(false)
  const recordedSteps = ref<RecordedStep[]>([])
  const targetUrl = ref('')
  /** 屏幕轨（主进程起真实浏览器）录制中：与 webview 轨共用同一份步骤列表 */
  const isScreenRecording = ref(false)
  /** 还没保存的监控区域，保存脚本时一起落库 */
  const draftMonitors = ref<RegionMonitor[]>([])

  // 回放状态
  const isPlaying = ref(false)
  const playingStepIndex = ref(-1)

  // 执行进度：并发执行时按 scriptId 分别记录，界面每个脚本一张卡
  const progresses = ref(new Map<number, ProgressState>())
  const progressList = computed(() => [...progresses.value.values()])
  const isProgressing = computed(() => progresses.value.size > 0)
  /** 每个脚本最近一次监控命中：接管提示要显示是哪块区域、什么关键词变的 */
  const hits = ref(new Map<number, MonitorHit>())
  /** 每个脚本的巡检实时结果（含差异热区），执行面板画「现在长这样」 */
  const monitorStatuses = ref(new Map<number, MonitorStatus[]>())

  let stepIdCounter = 0

  let loadSeq = 0

  async function loadScripts() {
    const seq = ++loadSeq
    const res = await ipc.invoke('script:list')
    // 只采用最新一次请求的结果：进度/完成/错误事件会并发触发刷新，迟到的旧响应会覆盖成新数据
    if (seq === loadSeq && res.success && res.data) {
      scripts.value = res.data
    }
  }

  async function saveScript(
    name: string,
    url: string,
    steps: RecordedStep[],
    description?: string,
    dataJson?: string,
    monitorJson?: string
  ): Promise<RecordedScript | null> {
    const res = await ipc.invoke('script:save', {
      name,
      description,
      targetUrl: url,
      stepsJson: JSON.stringify(steps),
      dataJson,
      monitorJson,
      status: 'ready'
    })
    if (res.success && res.data) {
      await loadScripts()
      return res.data
    }
    return null
  }

  /** 按 id 取脚本（进度卡与实时改步骤都要显示脚本名，列表是唯一来源） */
  function scriptOf(id: number): RecordedScript | undefined {
    return scripts.value.find(s => s.id === id)
  }

  /** 已保存脚本的监控区域（老脚本没存过这个字段时为空列表） */
  function monitorsOf(script: RecordedScript | undefined): RegionMonitor[] {
    return script ? parseMonitors(script.monitorJson) : []
  }

  /** 覆盖已保存脚本的步骤：不传 status/runCount，主进程 COALESCE 保留原值 */
  async function updateScriptSteps(script: RecordedScript, steps: RecordedStep[]) {
    const res = await ipc.invoke('script:save', {
      id: script.id,
      name: script.name,
      description: script.description,
      targetUrl: script.targetUrl,
      stepsJson: JSON.stringify(steps)
    })
    if (res.success) {
      await loadScripts()
    }
    return res
  }

  /** 只改自定义数据表：其余字段按原值回传，避免主进程把名称/步骤写成默认值 */
  async function updateScriptData(script: RecordedScript, dataJson: string) {
    const res = await ipc.invoke('script:save', {
      id: script.id,
      name: script.name,
      description: script.description,
      targetUrl: script.targetUrl,
      stepsJson: script.stepsJson,
      dataJson
    })
    if (res.success) {
      await loadScripts()
    }
    return res
  }

  /** 保存脚本的监控区域：主进程顺带清掉被删监控的基准图 */
  async function updateScriptMonitors(script: RecordedScript, monitors: RegionMonitor[]) {
    const res = await ipc.invoke('script:monitors:save', script.id, monitors)
    if (res.success) {
      await loadScripts()
    }
    return res
  }

  /**
   * 执行中热改步骤：落库 + 正在跑的那一轮按新列表继续（当前这一步跑完生效）。
   * 脚本没在执行时主进程只落库，同样返回成功，所以这里不必区分两种情况。
   */
  async function updateLiveSteps(scriptId: number, steps: RecordedStep[]) {
    const res = await ipc.invoke('script:steps:update', scriptId, steps)
    if (res.success) await loadScripts()
    return res
  }

  /** 跳过当前步骤（含因监控命中暂停时）；脚本没在跑时返回 false，界面据此提示 */
  async function skipStep(scriptId: number) {
    return ipc.invoke('script:step:skip', scriptId)
  }

  /** 退回上一步重做 */
  async function stepBack(scriptId: number) {
    return ipc.invoke('script:step:back', scriptId)
  }

  /** 监控命中后的接管：继续 / 跳过本步 / 终止 */
  async function resolveTakeover(scriptId: number, action: TakeoverAction) {
    const res = await ipc.invoke('script:takeover', scriptId, action)
    if (res.success) hits.value.delete(scriptId)
    return res
  }

  async function deleteScript(id: number) {
    const res = await ipc.invoke('script:delete', id)
    if (res.success) {
      await loadScripts()
    }
    return res
  }

  /** defaults 为本次执行填的变量值，数据表里空的格子用它兜底 */
  async function runScript(id: number, count: number = 1, defaults?: Record<string, string>) {
    const res = await ipc.invoke('script:run', id, count, defaults)
    return res
  }

  async function pauseScript(id: number) {
    const res = await ipc.invoke('script:pause', id)
    return res
  }

  async function resumeScript(id: number) {
    const res = await ipc.invoke('script:resume', id)
    return res
  }

  async function terminateScript(id: number) {
    const res = await ipc.invoke('script:terminate', id)
    // 乐观复位：立即清除该脚本的进度卡，避免等待后端（如浏览器关闭耗时）导致界面卡在「正在执行」
    if (res.success) {
      removeProgress(id)
      loadScripts()
    }
    return res
  }

  async function stopAll() {
    const res = await ipc.invoke('script:stopAll')
    if (res.success) {
      resetProgress()
      loadScripts()
    }
    return res
  }
  /**
   * 复制脚本：连目标地址与步骤一起克隆为一条新脚本（执行次数归零）。
   * 副本命名交给调用方，避免复制出一堆同名「xxx 副本」。
   */
  async function duplicateScript(script: RecordedScript, name: string) {
    let steps: RecordedStep[] = []
    try {
      const parsed = JSON.parse(script.stepsJson || '[]') as unknown
      steps = Array.isArray(parsed) ? (parsed as RecordedStep[]) : []
    } catch {
      steps = []
    }
    if (steps.length === 0) return null
    // 数据表一起复制：副本通常是为同一系列换个填法，重新录一遍数据没必要
    return saveScript(name, script.targetUrl, steps, script.description, script.dataJson)
  }

  // ========== 录制控制 ==========

  function startRecording(url: string) {
    isRecording.value = true
    targetUrl.value = url
    recordedSteps.value = []
    stepIdCounter = 0
  }

  function stopRecording() {
    isRecording.value = false
  }

  function addStep(step: Omit<RecordedStep, 'id'>) {
    recordedSteps.value.push({
      ...step,
      id: ++stepIdCounter
    })
  }

  function clearSteps() {
    recordedSteps.value = []
  }

  /**
   * 屏幕轨录制：主进程起一个真实浏览器并注入采集脚本，
   * 步骤通过 record:step 事件流回来。窗口收成迷你窗后用户操作的正是这个浏览器，
   * 它弹出的新标签页也在这条轨上（主进程按 context.on('page') 跟着切活动页）。
   */
  async function startScreenRecording(url: string) {
    const res = await ipc.invoke('record:start', url)
    if (res.success) {
      isScreenRecording.value = true
      targetUrl.value = url
      recordedSteps.value = []
      stepIdCounter = 0
    }
    return res
  }

  async function stopScreenRecording() {
    const res = await ipc.invoke('record:stop')
    // 无论主进程返回什么都把状态收回来：否则界面一直显示「录制中」却没人真在录
    isScreenRecording.value = false
    return res
  }

  // ========== 回放控制 ==========

  async function playStepsInWebview(webview: Electron.WebviewTag) {
    if (recordedSteps.value.length === 0 || isPlaying.value) return
    isPlaying.value = true
    playingStepIndex.value = -1

    for (let i = 0; i < recordedSteps.value.length; i++) {
      if (!isPlaying.value) break
      playingStepIndex.value = i
      const step = recordedSteps.value[i]

      const js = buildReplayJs(step)
      await webview.executeJavaScript(js).catch(() => {})

      // 与真实执行保持同一节奏：本步完成后等自定义延迟，没设过就等默认值
      await new Promise(r => setTimeout(r, step.delayBefore ?? DEFAULT_STEP_DELAY))
    }

    isPlaying.value = false
    playingStepIndex.value = -1
  }

  function stopPlaying() {
    isPlaying.value = false
    playingStepIndex.value = -1
  }

  function buildReplayJs(step: RecordedStep): string {
    switch (step.action) {
      case 'click':
        return `document.querySelector(${JSON.stringify(step.selector)})?.click()`
      case 'dblclick':
        return `document.querySelector(${JSON.stringify(step.selector)})?.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))`
      case 'fill':
        return `(function(){var el=document.querySelector(${JSON.stringify(step.selector)});if(el){el.value=${JSON.stringify(step.value)};el.dispatchEvent(new Event('input',{bubbles:true}))}})()`
      case 'select':
        return `(function(){var el=document.querySelector(${JSON.stringify(step.selector)});if(el){el.value=${JSON.stringify(step.value)};el.dispatchEvent(new Event('change',{bubbles:true}))}})()`
      case 'keypress':
        return `document.querySelector(${JSON.stringify(step.selector)})?.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(step.value)},bubbles:true}))`
      case 'scroll':
        return `window.scrollBy(0, ${step.value === 'down' ? 300 : -300})`
      default:
        return 'void 0'
    }
  }

  /** 复位执行进度状态（完成/终止/停止统一调用），命中提示与巡检结果一起清掉 */
  function removeProgress(scriptId: number) {
    progresses.value.delete(scriptId)
    hits.value.delete(scriptId)
    monitorStatuses.value.delete(scriptId)
  }

  function resetProgress() {
    progresses.value.clear()
    hits.value.clear()
    monitorStatuses.value.clear()
  }

  // ========== 事件监听 ==========

  let listenersRegistered = false

  function setupEventListeners() {
    if (listenersRegistered) return
    listenersRegistered = true

    ipc.on('script:progress', (data) => {
      const isNew = !progresses.value.has(data.scriptId)
      progresses.value.set(data.scriptId, {
        scriptId: data.scriptId,
        currentRun: data.currentRun,
        totalRuns: data.totalRuns,
        stepIndex: data.stepIndex,
        totalSteps: data.totalSteps,
        stepDescription: data.stepDescription ?? '',
        stepStartedAt: data.stepStartedAt ?? null,
        paused: data.paused ?? false,
        takeover: data.takeover ?? false
      })
      // 新脚本开始执行：拉一次列表，让卡片状态同步为「运行中」
      if (isNew) loadScripts()
    })

    ipc.on('script:complete', (data) => {
      removeProgress(data.scriptId)
      loadScripts()
    })

    ipc.on('script:stepError', () => {
      loadScripts()
    })

    // 监控巡检：每轮一条，热区只在命中时带，界面按 scriptId 分卡片显示
    ipc.on('monitor:status', (data) => {
      monitorStatuses.value.set(data.scriptId, data.statuses)
    })

    ipc.on('monitor:hit', (data) => {
      hits.value.set(data.scriptId, data)
      // 命中即已暂停等接管：先把卡片标出来，不等下一次进度推送（可能隔一轮才来）
      const progress = progresses.value.get(data.scriptId)
      if (progress) progresses.value.set(data.scriptId, { ...progress, takeover: true, paused: true })
    })

    // 屏幕轨：主进程实时推来的步骤
    ipc.on('record:step', (step) => {
      if (!isScreenRecording.value) return
      addStep(step)
    })

    ipc.on('record:state', (data) => {
      isScreenRecording.value = data.recording
      if (!data.recording) loadScripts()
    })
  }

  return {
    scripts,
    isRecording, isScreenRecording, recordedSteps, targetUrl, draftMonitors,
    isPlaying, playingStepIndex,
    progresses, progressList, isProgressing, hits, monitorStatuses,
    loadScripts, scriptOf, monitorsOf, saveScript, updateScriptSteps, updateScriptData, updateScriptMonitors,
    updateLiveSteps, deleteScript, duplicateScript, runScript,
    pauseScript, resumeScript, terminateScript, stopAll,
    skipStep, stepBack, resolveTakeover,
    startRecording, stopRecording, addStep, clearSteps,
    startScreenRecording, stopScreenRecording,
    playStepsInWebview, stopPlaying,
    setupEventListeners
  }
})

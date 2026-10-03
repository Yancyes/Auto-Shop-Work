import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ipc } from '@/api'
import { DEFAULT_STEP_DELAY } from '../../shared/constants'
import type { RecordedScript, RecordedStep } from '../../shared/types'

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
}

export const useScriptStore = defineStore('script', () => {
  const scripts = ref<RecordedScript[]>([])

  // 录制状态
  const isRecording = ref(false)
  const recordedSteps = ref<RecordedStep[]>([])
  const targetUrl = ref('')

  // 回放状态
  const isPlaying = ref(false)
  const playingStepIndex = ref(-1)

  // 执行进度：并发执行时按 scriptId 分别记录，界面每个脚本一张卡
  const progresses = ref(new Map<number, ProgressState>())
  const progressList = computed(() => [...progresses.value.values()])
  const isProgressing = computed(() => progresses.value.size > 0)

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
    description?: string
  ): Promise<RecordedScript | null> {
    const res = await ipc.invoke('script:save', {
      name,
      description,
      targetUrl: url,
      stepsJson: JSON.stringify(steps),
      status: 'ready'
    })
    if (res.success && res.data) {
      await loadScripts()
      return res.data
    }
    return null
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

  async function deleteScript(id: number) {
    const res = await ipc.invoke('script:delete', id)
    if (res.success) {
      await loadScripts()
    }
    return res
  }

  async function runScript(id: number, count: number = 1) {
    const res = await ipc.invoke('script:run', id, count)
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
    return saveScript(name, script.targetUrl, steps, script.description)
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

  /** 复位执行进度状态（完成/终止/停止统一调用） */
  function removeProgress(scriptId: number) {
    progresses.value.delete(scriptId)
  }

  function resetProgress() {
    progresses.value.clear()
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
        paused: data.paused ?? false
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
  }

  return {
    scripts,
    isRecording, recordedSteps, targetUrl,
    isPlaying, playingStepIndex,
    progresses, progressList, isProgressing,
    loadScripts, saveScript, updateScriptSteps, deleteScript, duplicateScript, runScript,
    pauseScript, resumeScript, terminateScript, stopAll,
    startRecording, stopRecording, addStep, clearSteps,
    playStepsInWebview, stopPlaying,
    setupEventListeners
  }
})

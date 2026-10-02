import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ipc } from '@/api'
import type { RecordedScript, RecordedStep } from '../../shared/types'

export const useScriptStore = defineStore('script', () => {
  const scripts = ref<RecordedScript[]>([])

  // 录制状态
  const isRecording = ref(false)
  const recordedSteps = ref<RecordedStep[]>([])
  const targetUrl = ref('')

  // 回放状态
  const isPlaying = ref(false)
  const playingStepIndex = ref(-1)

  // 执行进度
  const progressScriptId = ref<number | null>(null)
  const progressCurrentRun = ref(0)
  const progressTotalRuns = ref(0)
  const progressStepIndex = ref(0)
  const progressTotalSteps = ref(0)
  const progressStepDescription = ref('')
  const progressStepStartedAt = ref<number | null>(null)
  const progressPaused = ref(false)

  const isProgressing = computed(() => progressScriptId.value !== null)

  let stepIdCounter = 0

  async function loadScripts() {
    const res = await ipc.invoke('script:list')
    if (res.success && res.data) {
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
    // 乐观复位：立即清除进度面板，避免等待后端（如浏览器关闭耗时）导致 UI 卡在「正在执行」
    if (res.success && progressScriptId.value === id) {
      resetProgress()
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

      const delay = computeStepDelay(i)
      await new Promise(r => setTimeout(r, delay))
    }

    isPlaying.value = false
    playingStepIndex.value = -1
  }

  function computeStepDelay(index: number): number {
    const steps = recordedSteps.value
    if (index <= 0) return 300
    const prev = steps[index - 1]?.delayBefore
    const curr = steps[index]?.delayBefore
    if (!prev || !curr) return 300
    const diff = curr - prev
    return diff > 0 && diff < 10000 ? diff : 300
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
  function resetProgress() {
    progressScriptId.value = null
    progressCurrentRun.value = 0
    progressTotalRuns.value = 0
    progressStepIndex.value = 0
    progressTotalSteps.value = 0
    progressStepDescription.value = ''
    progressStepStartedAt.value = null
    progressPaused.value = false
  }

  // ========== 事件监听 ==========

  let listenersRegistered = false

  function setupEventListeners() {
    if (listenersRegistered) return
    listenersRegistered = true

    ipc.on('script:progress', (data) => {
      // 换脚本（含 null → 有）说明新一轮执行开始：拉一次列表，让卡片状态同步为「运行中」
      const isNewRun = progressScriptId.value !== data.scriptId
      progressScriptId.value = data.scriptId
      progressCurrentRun.value = data.currentRun
      progressTotalRuns.value = data.totalRuns
      progressStepIndex.value = data.stepIndex
      progressTotalSteps.value = data.totalSteps
      progressStepDescription.value = data.stepDescription ?? ''
      progressStepStartedAt.value = data.stepStartedAt ?? null
      progressPaused.value = data.paused ?? false
      if (isNewRun) loadScripts()
    })

    ipc.on('script:complete', () => {
      resetProgress()
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
    progressScriptId, progressCurrentRun, progressTotalRuns,
    progressStepIndex, progressTotalSteps,
    progressStepDescription, progressStepStartedAt, progressPaused,
    isProgressing,
    loadScripts, saveScript, updateScriptSteps, deleteScript, runScript,
    pauseScript, resumeScript, terminateScript, stopAll,
    startRecording, stopRecording, addStep, clearSteps,
    playStepsInWebview, stopPlaying,
    setupEventListeners
  }
})

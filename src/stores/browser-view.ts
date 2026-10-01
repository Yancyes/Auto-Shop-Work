import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ipc } from '@/api'
import type { ElementInfo } from '../../shared/types'

export interface BrowserPage {
  id: string
  url: string
  title: string
}

export interface RecordedStep {
  id: number
  action: 'click'
  selector: string
  text: string
}

export type { ElementInfo }

export const useBrowserViewStore = defineStore('browserView', () => {
  const isVisible = ref(false)
  const pages = ref<BrowserPage[]>([])
  const selectedPageIndex = ref<number>(0)
  const screenshot = ref<string | null>(null)
  const refreshInterval = ref<number | null>(null)
  const position = ref({ x: 100, y: 100 })
  const size = ref({ width: 800, height: 600 })

  // 元素拾取
  const pickerMode = ref(false)
  const pickerElements = ref<ElementInfo[]>([])
  const hoverIndex = ref<number>(-1)

  // 红色框选
  const selectionRect = ref<{ x: number; y: number; w: number; h: number } | null>(null)

  // 录制步骤
  const recordedSteps = ref<RecordedStep[]>([])
  const isPlaying = ref(false)
  const playingStepIndex = ref<number>(-1)
  let stepIdCounter = 0

  const pickerActive = computed(() => pickerMode.value && pickerElements.value.length > 0)

  /** 加载页面列表 */
  async function loadPages() {
    const res = await ipc.invoke('browser:getPages')
    if (res.success && res.data) {
      pages.value = res.data
      if (selectedPageIndex.value >= pages.value.length) {
        selectedPageIndex.value = Math.max(0, pages.value.length - 1)
      }
    }
  }

  /** 截取当前页面截图 */
  async function captureScreenshot() {
    if (pages.value.length === 0) return
    if (pickerMode.value) {
      const res = await ipc.invoke('browser:pickElements', selectedPageIndex.value)
      if (res.success && res.data) {
        screenshot.value = res.data.screenshot
        pickerElements.value = res.data.elements
      }
    } else {
      const res = await ipc.invoke('browser:screenshot', selectedPageIndex.value)
      if (res.success) {
        screenshot.value = res.data ?? null
      }
    }
  }

  /** 开始自动刷新 */
  function startAutoRefresh(intervalMs = 2000) {
    stopAutoRefresh()
    refreshInterval.value = window.setInterval(async () => {
      await loadPages()
      if (!pickerMode.value) {
        await captureScreenshot()
      }
    }, intervalMs)
  }

  /** 停止自动刷新 */
  function stopAutoRefresh() {
    if (refreshInterval.value) {
      clearInterval(refreshInterval.value)
      refreshInterval.value = null
    }
  }

  /** 切换面板显示 */
  function toggle() {
    isVisible.value = !isVisible.value
    if (isVisible.value) {
      loadPages()
      captureScreenshot()
      startAutoRefresh()
    } else {
      stopAutoRefresh()
    }
  }

  /** 更新位置（拖拽） */
  function updatePosition(x: number, y: number) {
    position.value = { x, y }
  }

  /** 更新大小（调整） */
  function updateSize(width: number, height: number) {
    size.value = { width, height }
  }

  /** 进入元素拾取模式 */
  async function enterPickerMode() {
    pickerMode.value = true
    await captureScreenshot()
  }

  /** 退出元素拾取模式 */
  async function exitPickerMode() {
    pickerMode.value = false
    pickerElements.value = []
    hoverIndex.value = -1
    selectionRect.value = null
    await ipc.invoke('browser:pickExit', selectedPageIndex.value).catch(() => {})
    await captureScreenshot()
  }

  /** 找出框选区域内的元素 */
  function findElementsInRect(rect: { x: number; y: number; w: number; h: number }): ElementInfo[] {
    const result: ElementInfo[] = []
    for (const el of pickerElements.value) {
      const elX = el.x
      const elY = el.y
      const elRight = el.x + el.width
      const elBottom = el.y + el.height
      const rectRight = rect.x + rect.w
      const rectBottom = rect.y + rect.h
      // 检查元素是否与矩形有交集
      if (elX < rectRight && elRight > rect.x && elY < rectBottom && elBottom > rect.y) {
        result.push(el)
      }
    }
    return result
  }

  /** 确认框选，将区域内元素记录为步骤 */
  function confirmSelection(rect: { x: number; y: number; w: number; h: number }) {
    const elements = findElementsInRect(rect)
    for (const el of elements) {
      recordedSteps.value.push({
        id: ++stepIdCounter,
        action: 'click',
        selector: el.selector,
        text: el.text || el.tag
      })
    }
    selectionRect.value = null
    return elements.length
  }

  /** 录制一个点击步骤 */
  function recordStep(element: ElementInfo) {
    recordedSteps.value.push({
      id: ++stepIdCounter,
      action: 'click',
      selector: element.selector,
      text: element.text || element.tag
    })
  }

  /** 移除一个步骤 */
  function removeStep(id: number) {
    recordedSteps.value = recordedSteps.value.filter(s => s.id !== id)
  }

  /** 清空所有步骤 */
  function clearSteps() {
    recordedSteps.value = []
  }

  /** 按顺序回放所有步骤 */
  async function playSteps() {
    if (recordedSteps.value.length === 0 || isPlaying.value) return
    isPlaying.value = true
    playingStepIndex.value = -1

    for (let i = 0; i < recordedSteps.value.length; i++) {
      if (!isPlaying.value) break
      playingStepIndex.value = i
      const step = recordedSteps.value[i]
      const res = await ipc.invoke('browser:execute', selectedPageIndex.value, step.action, { selector: step.selector })
      if (!res.success) break
      await new Promise(r => setTimeout(r, 500))
    }

    isPlaying.value = false
    playingStepIndex.value = -1
  }

  /** 停止回放 */
  function stopPlaying() {
    isPlaying.value = false
    playingStepIndex.value = -1
  }

  return {
    isVisible,
    pages,
    selectedPageIndex,
    screenshot,
    position,
    size,
    pickerMode,
    pickerElements,
    hoverIndex,
    pickerActive,
    selectionRect,
    recordedSteps,
    isPlaying,
    playingStepIndex,
    loadPages,
    captureScreenshot,
    startAutoRefresh,
    stopAutoRefresh,
    toggle,
    updatePosition,
    updateSize,
    enterPickerMode,
    exitPickerMode,
    findElementsInRect,
    confirmSelection,
    recordStep,
    removeStep,
    clearSteps,
    playSteps,
    stopPlaying
  }
})

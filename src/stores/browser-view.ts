import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ipc } from '@/api'
import type { ElementInfo } from '../../shared/types'

export interface BrowserPage {
  id: string
  url: string
  title: string
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
  const selectedElements = ref<ElementInfo[]>([])
  const hoverIndex = ref<number>(-1)

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

  /** 执行浏览器操作 */
  async function executeAction(action: string, params: any) {
    if (pages.value.length === 0) return
    const res = await ipc.invoke('browser:execute', selectedPageIndex.value, action, params)
    if (res.success) {
      await captureScreenshot()
    }
    return res
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
    await ipc.invoke('browser:pickExit', selectedPageIndex.value).catch(() => {})
    await captureScreenshot()
  }

  /** 选中一个元素 */
  function selectElement(element: ElementInfo) {
    if (!selectedElements.value.some(e => e.index === element.index)) {
      selectedElements.value.push(element)
    }
  }

  /** 移除已选元素 */
  function removeElement(index: number) {
    selectedElements.value = selectedElements.value.filter(e => e.index !== index)
  }

  /** 清空已选 */
  function clearSelectedElements() {
    selectedElements.value = []
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
    selectedElements,
    hoverIndex,
    pickerActive,
    loadPages,
    captureScreenshot,
    executeAction,
    startAutoRefresh,
    stopAutoRefresh,
    toggle,
    updatePosition,
    updateSize,
    enterPickerMode,
    exitPickerMode,
    selectElement,
    removeElement,
    clearSelectedElements
  }
})

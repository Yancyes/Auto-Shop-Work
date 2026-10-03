/**
 * 系统设置表单逻辑：读写存档、浏览器探测与手动选择。
 * 从 logs.vue 抽出，视图只负责排版，避免单文件承载状态机 + 探测节流 + IPC 调用。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useLogStore } from '@/stores/log'
import { ipc } from '@/api'
import type { SystemSettings, BrowserDetectResult } from '../../shared/types'

const DEFAULT_SETTINGS: SystemSettings = {
  browser: {
    headless: false,
    viewport: { width: 1440, height: 900 },
    timeout: 30000,
    executablePath: ''
  },
  antiDetection: { enabled: true, typingDelay: true, mouseTrace: true, randomDelay: true },
  notification: { soundEnabled: true, manualIntervention: true, taskComplete: true },
  storage: { logDir: '' },
  script: { maxConcurrency: 1, runInterval: 3, retryCount: 3, hudEnabled: true }
}

const SOURCE_TEXT: Record<string, string> = {
  custom: '手动指定的浏览器',
  bundled: '随包自带的 Chromium',
  system: '系统已装的 Chrome/Edge'
}

/** 纯 JSON 配置的深拷贝：表单与 store 存档必须隔离，取消编辑才不会污染已保存值 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function useSettingsForm() {
  const logStore = useLogStore()

  const settingsForm = ref<SystemSettings>(clone(DEFAULT_SETTINGS))

  // 执行浏览器：留空自动探测，探测结果实时展示，方便用户确认「到底用的是哪个浏览器」
  const browserInfo = ref<BrowserDetectResult | null>(null)

  const browserHint = computed(() => {
    const info = browserInfo.value
    if (!info) return '保存设置后可自动探测要使用的浏览器'
    if (info.problem) return info.problem
    return `当前将使用：${SOURCE_TEXT[info.source] ?? info.source}　${info.executablePath ?? ''}`
  })

  let detectSeq = 0
  let detectTimer: number | null = null

  async function refreshBrowserInfo() {
    const seq = ++detectSeq
    const res = await ipc.invoke('browser:detect', settingsForm.value.browser.executablePath)
    // 边输入边探测时，迟到的旧结果不能覆盖最新提示
    if (seq === detectSeq && res.success && res.data) browserInfo.value = res.data
  }

  /** 输入路径时防抖探测，避免每敲一个字符都发一次 IPC */
  function refreshBrowserInfoDebounced() {
    if (detectTimer !== null) clearTimeout(detectTimer)
    detectTimer = window.setTimeout(() => {
      detectTimer = null
      void refreshBrowserInfo()
    }, 400)
  }

  async function pickBrowser() {
    const res = await ipc.invoke('dialog:pickBrowser')
    if (!res.success) {
      ElMessage.error(res.error || '打开文件选择框失败')
      return
    }
    if (res.data) {
      settingsForm.value.browser.executablePath = res.data
      await refreshBrowserInfo()
      ElMessage.success('已选择浏览器，点击「保存设置」生效')
    }
  }

  async function saveSettings() {
    const res = await logStore.saveSettings(settingsForm.value)
    if (res.success && res.data) {
      // 回填主进程存档：合并默认值后的真实生效配置，避免界面显示没写进去的假值
      settingsForm.value = clone(res.data)
      ElMessage.success('设置已保存')
      await refreshBrowserInfo()
    } else {
      ElMessage.error(res.error || '保存失败')
    }
  }

  async function init() {
    try {
      await logStore.loadSettings()
      if (logStore.settings) settingsForm.value = clone(logStore.settings)
      await refreshBrowserInfo()
    } catch (e) {
      console.warn('设置初始化失败:', e)
    }
  }

  onMounted(init)
  onUnmounted(() => {
    if (detectTimer !== null) clearTimeout(detectTimer)
  })

  return {
    settingsForm,
    browserInfo,
    browserHint,
    pickBrowser,
    refreshBrowserInfo,
    refreshBrowserInfoDebounced,
    saveSettings
  }
}

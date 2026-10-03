/**
 * Webview 录制组合式逻辑：地址栏导航、录制注入脚本的时机、以及页面回传步骤的解析。
 * 从 dashboard.vue 抽出，视图只负责布局与按钮，降低单文件复杂度。
 */
import { ref, computed, nextTick } from 'vue'
import { useScriptStore } from '@/stores/script'
import { RECORDER_INJECT_SCRIPT } from '@/assets/recorder-inject'
import type { RecordedStep, RecordedAction } from '../../shared/types'

const HOME_URL = 'https://www.baidu.com'

export function useWebviewRecorder() {
  const scriptStore = useScriptStore()

  const webviewRef = ref<any>(null)
  const urlInput = ref(HOME_URL)
  /** 仅用于 webview 首次渲染的 src；后续导航一律走 loadURL，避免 :src 变化引发二次加载 */
  const webviewSrc = ref(HOME_URL)
  const currentUrl = ref('')
  const webviewLoaded = ref(false)
  const webviewError = ref('')

  const isRecording = computed(() => scriptStore.isRecording)
  const recordedSteps = computed(() => scriptStore.recordedSteps)

  function normalizeUrl(raw: string): string {
    return /^https?:\/\//i.test(raw) ? raw : 'https://' + raw
  }

  function navigateTo() {
    const url = urlInput.value.trim()
    if (!url) {
      ElMessage.warning('请输入网址')
      return
    }
    const wv = webviewRef.value
    if (!wv || !wv.loadURL) return
    const finalUrl = normalizeUrl(url)
    urlInput.value = finalUrl
    webviewError.value = ''
    webviewLoaded.value = false
    // 只调 loadURL，不再改 :src —— 两处同时赋值会让页面被加载两次（闪白，并可能打断录制注入）
    wv.loadURL(finalUrl).catch(() => {})
  }

  function injectCaptureScript() {
    if (!webviewRef.value) return
    webviewRef.value.executeJavaScript(RECORDER_INJECT_SCRIPT).catch(() => {})
  }

  function onDidFinishLoad() {
    webviewLoaded.value = true
    currentUrl.value = webviewRef.value?.getURL() || ''
    urlInput.value = currentUrl.value
    if (isRecording.value) injectCaptureScript()
  }

  function onDidNavigate() {
    currentUrl.value = webviewRef.value?.getURL() || ''
    nextTick(() => {
      urlInput.value = currentUrl.value
      // 录制中导航后立即重新注入脚本，避免 500ms 空窗
      if (isRecording.value) injectCaptureScript()
    })
  }

  function onDidFailLoad(e: any) {
    // 子框架（广告、第三方嵌入）加载失败很常见，不代表页面打不开，不应该在整页上盖一条错误
    if (!e?.isMainFrame) return
    const code = e?.errorCode
    // -3 = ERR_ABORTED：主动取消/重定向造成的中断，不是故障
    if (code && code !== -3) {
      webviewError.value = `页面加载失败: ${e?.errorDescription || code}`
    }
  }

  /** 注入脚本用 console.log('__RECORD__:' + JSON) 回传步骤，这里解析并入列 */
  function onConsoleMessage(e: any) {
    const message = e?.message || ''
    if (!message.startsWith('__RECORD__:')) return
    if (!isRecording.value) return

    try {
      const data = JSON.parse(message.slice('__RECORD__:'.length))
      if (!data.__record || !data.action) return

      const step: Omit<RecordedStep, 'id'> = {
        action: data.action as RecordedAction,
        selector: data.selector || '',
        value: data.value,
        description: data.description || '',
        tagName: data.tagName,
        elementText: data.elementText
      }
      scriptStore.addStep(step)
    } catch {
      // 忽略非录制来源或被截断的日志
    }
  }

  async function startRecording() {
    if (!webviewRef.value || !webviewLoaded.value) {
      ElMessage.warning('请先加载页面')
      return
    }
    // 开始录制会清空当前步骤列表：有未保存成果时先确认，避免一键丢掉几十步录制
    if (recordedSteps.value.length > 0) {
      try {
        await ElMessageBox.confirm(
          `当前有 ${recordedSteps.value.length} 个未保存的步骤，开始新录制会把它们清空。是否继续？`,
          '确认开始录制',
          { type: 'warning', confirmButtonText: '清空并录制', cancelButtonText: '取消' }
        )
      } catch {
        return
      }
    }
    scriptStore.startRecording(currentUrl.value || urlInput.value)
    injectCaptureScript()
    ElMessage.success('开始录制，请操作页面')
  }

  function stopRecording() {
    scriptStore.stopRecording()
    ElMessage.info('录制已停止')
  }

  return {
    webviewRef, urlInput, webviewSrc, currentUrl, webviewLoaded, webviewError,
    isRecording, recordedSteps,
    navigateTo, startRecording, stopRecording,
    onDidFinishLoad, onDidNavigate, onDidFailLoad, onConsoleMessage
  }
}

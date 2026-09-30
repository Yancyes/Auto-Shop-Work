import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ipc } from '@/api'
import type { UpdaterState, UpdaterStatus } from '../../shared/types'

export const useUpdaterStore = defineStore('updater', () => {
  const status = ref<UpdaterStatus>('idle')
  const currentVersion = ref('')
  const availableVersion = ref('')
  const releaseDate = ref('')
  const releaseNotes = ref('')
  const progress = ref<UpdaterState['progress'] | null>(null)
  const error = ref('')
  const dialogVisible = ref(false)

  const isAvailable = computed(() => status.value === 'available')
  const isDownloading = computed(() => status.value === 'downloading')
  const isDownloaded = computed(() => status.value === 'downloaded')
  const downloadPercent = computed(() => progress.value?.percent ?? 0)

  /** 应用主进程推送的状态快照 */
  function applyState(s: UpdaterState) {
    status.value = s.status
    currentVersion.value = s.currentVersion
    availableVersion.value = s.availableVersion ?? ''
    releaseDate.value = s.releaseDate ?? ''
    releaseNotes.value = s.releaseNotes ?? ''
    progress.value = s.progress ?? null
    error.value = s.error ?? ''
  }

  /** 初始化：拉取当前状态并订阅主进程事件，全局只调用一次 */
  async function init() {
    try {
      const res = await ipc.invoke('updater:state')
      if (res.success && res.data) {
        applyState(res.data)
        if (res.data.status === 'available') {
          dialogVisible.value = true
        }
      }
    } catch (e) {
      console.error('[updater] 初始化失败:', e)
    }
    ipc.on('updater:event', (data: { type: string; state: UpdaterState }) => {
      applyState(data.state)
      if (data.state.status === 'available') dialogVisible.value = true
    })
  }

  /** 手动检查更新 */
  async function check() {
    const res = await ipc.invoke('updater:check')
    if (res.success && res.data) {
      applyState(res.data)
      if (res.data.status === 'available') dialogVisible.value = true
      if (res.data.status === 'error' || res.data.status === 'not-available') dialogVisible.value = true
    } else {
      error.value = (res as { error?: string }).error ?? '检查更新失败'
      dialogVisible.value = true
    }
    return res
  }

  /** 开始下载新版本 */
  async function download() {
    dialogVisible.value = true
    const res = await ipc.invoke('updater:download')
    if (res.success && res.data === false) {
      error.value = '当前没有可下载的更新'
      dialogVisible.value = true
    }
    return res
  }

  /** 退出并安装 */
  async function install() {
    const res = await ipc.invoke('updater:install')
    return res
  }

  return {
    status, currentVersion, availableVersion, releaseDate, releaseNotes,
    progress, error, dialogVisible,
    isAvailable, isDownloading, isDownloaded, downloadPercent,
    init, check, download, install
  }
})

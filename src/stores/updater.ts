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
  const bannerVisible = ref(false)
  const releaseDialogVisible = ref(false)

  const isAvailable = computed(() => status.value === 'available')
  const isDownloading = computed(() => status.value === 'downloading')
  const isDownloaded = computed(() => status.value === 'downloaded')
  const downloadPercent = computed(() => progress.value?.percent ?? 0)

  function applyState(s: UpdaterState) {
    status.value = s.status
    currentVersion.value = s.currentVersion
    availableVersion.value = s.availableVersion ?? ''
    releaseDate.value = s.releaseDate ?? ''
    releaseNotes.value = s.releaseNotes ?? ''
    progress.value = s.progress ?? null
    error.value = s.error ?? ''
  }

  async function init() {
    try {
      const res = await ipc.invoke('updater:state')
      if (res.success && res.data) {
        applyState(res.data)
        if (res.data.status === 'available') {
          bannerVisible.value = true
          download()
        }
        if (res.data.status === 'downloaded') {
          bannerVisible.value = true
        }
      }
    } catch (e) {
      console.error('[updater] 初始化失败:', e)
    }
    ipc.on('updater:event', (data: { type: string; state: UpdaterState }) => {
      const prevStatus = status.value
      applyState(data.state)
      if (data.state.status === 'available' && prevStatus !== 'available' && !dialogVisible.value) {
        bannerVisible.value = true
        download()
      }
      if (data.state.status === 'downloaded' && prevStatus === 'downloading') {
        releaseDialogVisible.value = true
      }
    })
  }

  async function check() {
    const res = await ipc.invoke('updater:check')
    if (res.success && res.data) {
      applyState(res.data)
      if (res.data.status === 'available') {
        bannerVisible.value = true
        download()
      }
      if (res.data.status === 'not-available') {
        dialogVisible.value = true
      }
      if (res.data.status === 'error') {
        dialogVisible.value = true
      }
    } else {
      error.value = (res as { error?: string }).error ?? '检查更新失败'
      dialogVisible.value = true
    }
    return res
  }

  async function checkThrottled() {
    const res = await ipc.invoke('updater:check-throttled')
    if (res.success && res.data) {
      applyState(res.data)
      if (res.data.status === 'available') {
        bannerVisible.value = true
        if (!isDownloading.value && !isDownloaded.value) {
          download()
        }
      }
    }
    return res
  }

  async function download() {
    const res = await ipc.invoke('updater:download')
    if (res.success && res.data === false) {
      error.value = '当前没有可下载的更新'
    }
    return res
  }

  async function install() {
    const res = await ipc.invoke('updater:install')
    return res
  }

  function dismissBanner() {
    bannerVisible.value = false
  }

  return {
    status, currentVersion, availableVersion, releaseDate, releaseNotes,
    progress, error, dialogVisible, bannerVisible, releaseDialogVisible,
    isAvailable, isDownloading, isDownloaded, downloadPercent,
    init, check, checkThrottled, download, install, dismissBanner
  }
})

/**
 * 屏幕区域监控的编辑逻辑：框选、基准图（截屏或上传本地图片）、立即试测一次。
 * 从面板组件抽出，视图只负责排版，同一套操作在录制页与脚本管理页都能用。
 */
import { ref } from 'vue'
import { ipc } from '@/api'
import { normalizeMonitor } from '../../shared/monitor-config'
import type { MonitorStatus, RegionMonitor } from '../../shared/types'

/** 监控项 id 只要唯一且能拼进文件名，不需要可读；用递增序号避免同毫秒碰撞 */
let monitorSeq = Date.now() % 1e6

export function newMonitorId(): string {
  return 'm' + ++monitorSeq
}

/** 接受 ref 或 computed，两者都只需一个 value 槽 */
export function useMonitorPanel(monitors: { value: RegionMonitor[] }) {
  /** 正在抓屏 / 等用户框选的监控项 id */
  const picking = ref(false)
  const busy = ref<Record<string, boolean>>({})
  const probing = ref<Record<string, boolean>>({})
  /** 基准图预览（本地读回的图）与试测快照（当前画面），两者要能并排看 */
  const baselinePreview = ref<Record<string, string>>({})
  const shotPreview = ref<Record<string, string>>({})
  const probeResults = ref<Record<string, MonitorStatus>>({})

  function add() {
    const created = normalizeMonitor({ id: newMonitorId(), label: `区域 ${monitors.value.length + 1}` })
    if (created) monitors.value.push(created)
  }

  function removeAt(index: number) {
    const target = monitors.value[index]
    if (!target) return
    delete baselinePreview.value[target.id]
    delete shotPreview.value[target.id]
    delete probeResults.value[target.id]
    monitors.value.splice(index, 1)
  }

  /** 全屏遮罩框选：取消返回 null，不改已有区域 */
  async function pickRect(monitor: RegionMonitor) {
    if (picking.value) return
    picking.value = true
    try {
      const res = await ipc.invoke('region:pick')
      if (res.success && res.data) {
        monitor.rect = res.data
        ElMessage.success(`已选区域 ${res.data.width} × ${res.data.height}`)
      } else if (!res.success) {
        ElMessage.error(res.error || '框选失败')
      }
    } finally {
      picking.value = false
    }
  }

  /** 把当前框选区域存成基准图：之后每轮都和这张图比 */
  async function captureBaseline(monitor: RegionMonitor) {
    if (!monitor.rect) {
      ElMessage.warning('请先框选区域')
      return
    }
    const key = monitor.id
    busy.value[key] = true
    try {
      const res = await ipc.invoke('monitor:baseline:save', monitor.id, monitor.rect)
      if (res.success && res.data) {
        monitor.baselineFile = res.data
        delete probeResults.value[key]
        ElMessage.success('基准图已保存')
      } else {
        ElMessage.error(res.error || '基准图保存失败')
      }
    } finally {
      busy.value[key] = false
    }
  }

  /** 上传一张本地图片当基准：不用非得到那个画面上截，手上有截图就能比对 */
  async function uploadBaseline(monitor: RegionMonitor, file: File) {
    const key = monitor.id
    busy.value[key] = true
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const res = await ipc.invoke('monitor:baseline:upload', monitor.id, dataUrl)
      if (res.success && res.data) {
        monitor.baselineFile = res.data
        baselinePreview.value[key] = dataUrl
        delete probeResults.value[key]
        ElMessage.success('已用这张图片作为基准')
      } else {
        ElMessage.error(res.success ? '图片没能解码，换一张 PNG 或 JPG 试试' : res.error || '上传失败')
      }
    } finally {
      busy.value[key] = false
    }
  }

  async function loadBaseline(monitor: RegionMonitor) {
    const key = monitor.id
    if (!monitor.baselineFile) {
      delete baselinePreview.value[key]
      return
    }
    busy.value[key] = true
    try {
      const res = await ipc.invoke('monitor:baseline:read', monitor.id)
      if (res.success && res.data) baselinePreview.value[key] = res.data.png
      else ElMessage.warning('读不到基准图，可能需要重新截取')
    } finally {
      busy.value[key] = false
    }
  }

  /** 立刻按当前设置比对一次：保存前就能看到会不会命中、热区在哪 */
  async function probe(monitor: RegionMonitor) {
    const key = monitor.id
    probing.value[key] = true
    try {
      const res = await ipc.invoke('monitor:probe', monitor)
      if (res.success && res.data) {
        probeResults.value[key] = res.data
        if (res.data.snapshot) shotPreview.value[key] = res.data.snapshot
      } else {
        ElMessage.error(res.error || '试测失败')
      }
    } finally {
      probing.value[key] = false
    }
  }

  return {
    picking, busy, probing, baselinePreview, shotPreview, probeResults,
    add, removeAt, pickRect, captureBaseline, uploadBaseline, loadBaseline, probe
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

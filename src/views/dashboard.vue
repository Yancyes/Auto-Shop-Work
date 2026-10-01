<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useDashboardStore } from '@/stores/log'
import { useTaskStore } from '@/stores/task'
import { useLogStore } from '@/stores/log'
import { useBrowserViewStore } from '@/stores/browser-view'
import { ElMessage } from 'element-plus'
import { STEP_LABELS, screenshotUrl } from '@/utils'
import { parseNlCommand } from '@/utils/nl-parser'
import { ipc } from '@/api'
import type { RunLog, ProgressStep } from '../../shared/types'

const router = useRouter()
const dashboardStore = useDashboardStore()
const taskStore = useTaskStore()
const logStore = useLogStore()
const browserViewStore = useBrowserViewStore()

const screenshotDialogVisible = ref(false)
const nlInput = ref('')

// 元素拾取 canvas
const canvasRef = ref<HTMLCanvasElement>()
const monitorContainerRef = ref<HTMLDivElement>()

// 框选拖拽状态
const isDrawing = ref(false)
const drawStart = ref({ x: 0, y: 0 })
const drawEnd = ref({ x: 0, y: 0 })

// 最近错误日志
const recentErrors = computed<RunLog[]>(() => logStore.logs.filter(l => l.level === 'error').slice(0, 3))

// 当前运行中任务的步骤
const currentTaskSteps = computed<ProgressStep[]>(() => {
  const running = taskStore.tasks.find(t => t.status === 'running')
  if (!running) return []
  return Object.keys(STEP_LABELS).map(s => ({
    step: s as ProgressStep['step'],
    label: STEP_LABELS[s],
    status: getStepStatus(running.currentStep, s)
  }))
})

const runningTask = computed(() => taskStore.tasks.find(t => t.status === 'running'))

// 实时显示的截图：运行中任务时显示任务截图，否则显示浏览器监控截图
const displayScreenshot = computed(() => {
  if (runningTask.value && taskStore.latestScreenshot) return screenshotUrl(taskStore.latestScreenshot)
  return browserViewStore.screenshot
})

watch(() => logStore.currentScreenshot, (val) => {
  if (val) screenshotDialogVisible.value = true
})

const quickActions = [
  { label: '快速上架', icon: 'Rocket', desc: '选择模板，一键启动', path: '/tasks', color: '#ff6b35' },
  { label: '批量导入', icon: 'Upload', desc: '批量生成任务', path: '/tasks', color: '#409eff' },
  { label: '停止所有', icon: 'VideoPause', desc: '终止运行中任务', action: 'stopAll', color: '#f56c6c' }
]

let pollTimer: ReturnType<typeof setInterval> | null = null

async function loadData() {
  await Promise.all([
    dashboardStore.loadStats(),
    taskStore.loadTasks(),
    logStore.loadLogs({ level: 'error' })
  ])
}

function getStepStatus(current: string | null, step: string): ProgressStep['status'] {
  if (!current) return 'wait'
  const order = Object.keys(STEP_LABELS)
  const ci = order.indexOf(current)
  const si = order.indexOf(step)
  if (si < ci) return 'finish'
  if (si === ci) return 'process'
  return 'wait'
}

async function handleAction(action?: string, path?: string) {
  if (action === 'stopAll') await taskStore.stopAll()
  if (path) router.push(path)
}

// ========== 浏览器监控 ==========
async function refreshBrowserView() {
  await browserViewStore.loadPages()
  await browserViewStore.captureScreenshot()
}

// ========== 红色框选录制 ==========
function drawOverlay() {
  const canvas = canvasRef.value
  if (!canvas || !browserViewStore.pickerActive) return
  const container = monitorContainerRef.value
  if (!container) return
  const img = container.querySelector('img')
  if (!img) return

  canvas.width = img.clientWidth
  canvas.height = img.clientHeight
  canvas.style.left = img.offsetLeft + 'px'
  canvas.style.top = img.offsetTop + 'px'

  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 绘制已录制步骤的红色标记
  for (let i = 0; i < browserViewStore.recordedSteps.length; i++) {
    const step = browserViewStore.recordedSteps[i]
    const el = browserViewStore.pickerElements.find(e => e.selector === step.selector)
    if (!el) continue
    const x = el.x * canvas.width
    const y = el.y * canvas.height
    const w = el.width * canvas.width
    const h = el.height * canvas.height

    const isCurrentPlaying = browserViewStore.isPlaying && browserViewStore.playingStepIndex === i

    // 红色边框
    ctx.strokeStyle = isCurrentPlaying ? '#ff0000' : '#e63946'
    ctx.lineWidth = isCurrentPlaying ? 3 : 2
    ctx.setLineDash(isCurrentPlaying ? [] : [5, 3])
    ctx.strokeRect(x, y, w, h)
    ctx.setLineDash([])

    // 步骤序号
    const label = String(i + 1)
    ctx.font = 'bold 12px sans-serif'
    const tw = ctx.measureText(label).width + 10
    ctx.fillStyle = '#e63946'
    ctx.fillRect(x, y - 18, tw, 18)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, x + 5, y - 5)
  }

  // 绘制正在拖拽的红色框选矩形
  if (isDrawing.value) {
    const rx = Math.min(drawStart.value.x, drawEnd.value.x)
    const ry = Math.min(drawStart.value.y, drawEnd.value.y)
    const rw = Math.abs(drawEnd.value.x - drawStart.value.x)
    const rh = Math.abs(drawEnd.value.y - drawStart.value.y)
    ctx.strokeStyle = '#e63946'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 3])
    ctx.strokeRect(rx, ry, rw, rh)
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(230, 57, 70, 0.1)'
    ctx.fillRect(rx, ry, rw, rh)
  }
}

function handleCanvasMouseDown(e: MouseEvent) {
  if (!browserViewStore.pickerActive || !canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  drawStart.value = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  drawEnd.value = { ...drawStart.value }
  isDrawing.value = true
}

function handleCanvasMouseMove(e: MouseEvent) {
  if (!browserViewStore.pickerActive || !canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  if (isDrawing.value) {
    drawEnd.value = { x: mx, y: my }
    drawOverlay()
    return
  }

  let found = -1
  for (const el of browserViewStore.pickerElements) {
    const x = el.x * canvasRef.value.width
    const y = el.y * canvasRef.value.height
    const w = el.width * canvasRef.value.width
    const h = el.height * canvasRef.value.height
    if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
      found = el.index
      break
    }
  }
  if (found !== browserViewStore.hoverIndex) {
    browserViewStore.hoverIndex = found
    drawOverlay()
  }
}

function handleCanvasMouseUp() {
  if (!isDrawing.value || !canvasRef.value) return
  isDrawing.value = false

  const cw = canvasRef.value.width
  const ch = canvasRef.value.height
  const rx = Math.min(drawStart.value.x, drawEnd.value.x) / cw
  const ry = Math.min(drawStart.value.y, drawEnd.value.y) / ch
  const rw = Math.abs(drawEnd.value.x - drawStart.value.x) / cw
  const rh = Math.abs(drawEnd.value.y - drawStart.value.y) / ch

  if (rw < 0.01 || rh < 0.01) {
    drawOverlay()
    return
  }

  const count = browserViewStore.confirmSelection({ x: rx, y: ry, w: rw, h: rh })
  if (count > 0) {
    ElMessage.success(`已录制 ${count} 个步骤`)
  } else {
    ElMessage.warning('框选区域内未找到可操作元素')
  }
  drawOverlay()
}

function handleCanvasMouseLeave() {
  if (isDrawing.value) {
    isDrawing.value = false
    drawOverlay()
    return
  }
  if (browserViewStore.hoverIndex !== -1) {
    browserViewStore.hoverIndex = -1
    drawOverlay()
  }
}

async function togglePicker() {
  if (browserViewStore.pickerMode) {
    await browserViewStore.exitPickerMode()
  } else {
    await browserViewStore.enterPickerMode()
  }
  await nextTick()
  drawOverlay()
}

async function handlePlaySteps() {
  if (browserViewStore.recordedSteps.length === 0) {
    ElMessage.warning('请先录制操作步骤')
    return
  }
  ElMessage.info('开始执行录制步骤...')
  await browserViewStore.playSteps()
  ElMessage.success('步骤执行完成')
  await browserViewStore.captureScreenshot()
}

watch(
  [() => browserViewStore.pickerElements, () => browserViewStore.pickerMode, () => browserViewStore.screenshot, () => browserViewStore.recordedSteps],
  () => {
    if (browserViewStore.pickerActive) nextTick(() => drawOverlay())
  }
)

// ========== 自然语言指令 ==========
async function sendNlCommand() {
  const text = nlInput.value.trim()
  if (!text) return
  nlInput.value = ''

  const parsed = parseNlCommand(text)
  if (!parsed) {
    ElMessage.warning('无法识别该指令，请尝试如：点击发布按钮、填写商品名称为xxx')
    return
  }

  try {
    const res = await ipc.invoke('browser:execute', browserViewStore.selectedPageIndex, parsed.action, parsed.params)
    if (res.success) {
      ElMessage.success(parsed.description)
      if (parsed.action === 'screenshot' && res.data) {
        browserViewStore.screenshot = res.data
      } else {
        await browserViewStore.captureScreenshot()
      }
    } else {
      ElMessage.error(res.error || '指令执行失败')
    }
  } catch (e) {
    ElMessage.error(`执行失败: ${(e as Error).message}`)
  }
}

onMounted(() => {
  loadData()
  refreshBrowserView()
  browserViewStore.startAutoRefresh(3000)
  pollTimer = setInterval(loadData, 3000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  browserViewStore.stopAutoRefresh()
})
</script>

<template>
  <div class="dashboard">
    <!-- 核心数据卡片 -->
    <div class="stats-cards">
      <div class="stat-card" style="--accent: #67c23a">
        <div class="stat-icon"><el-icon size="32"><CircleCheck /></el-icon></div>
        <div class="stat-body">
          <div class="stat-label">今日上架成功</div>
          <div class="stat-value">{{ dashboardStore.stats.todaySuccess }}</div>
        </div>
      </div>
      <div class="stat-card" style="--accent: #409eff">
        <div class="stat-icon"><el-icon size="32"><TrendCharts /></el-icon></div>
        <div class="stat-body">
          <div class="stat-label">上架成功率</div>
          <div class="stat-value">{{ dashboardStore.stats.successRate }}%</div>
        </div>
      </div>
      <div class="stat-card" style="--accent: #ff6b35">
        <div class="stat-icon"><el-icon size="32"><Money /></el-icon></div>
        <div class="stat-body">
          <div class="stat-label">预估总收益</div>
          <div class="stat-value">¥{{ dashboardStore.stats.estimatedRevenue.toFixed(2) }}</div>
        </div>
      </div>
      <div class="stat-card" style="--accent: #e6a23c">
        <div class="stat-icon"><el-icon size="32"><Loading /></el-icon></div>
        <div class="stat-body">
          <div class="stat-label">运行中任务</div>
          <div class="stat-value">{{ dashboardStore.stats.runningCount }}</div>
        </div>
      </div>
    </div>

    <!-- 主工作区：浏览器监控 + 执行进度 -->
    <div class="workspace mt-24">
      <!-- 左侧：浏览器监控 -->
      <div class="monitor-section card">
        <div class="section-title">
          <el-icon><Monitor /></el-icon>
          <span>窗口识别</span>
          <div class="section-actions">
            <el-button text size="small" @click="refreshBrowserView">
              <el-icon><Refresh /></el-icon>
            </el-button>
            <el-button text size="small" :type="browserViewStore.pickerMode ? 'warning' : undefined" @click="togglePicker">
              <el-icon><Pointer /></el-icon>
              <span style="margin-left: 4px; font-size: 12px; font-weight: normal">
                {{ browserViewStore.pickerMode ? '退出框选' : '框选录制' }}
              </span>
            </el-button>
          </div>
        </div>

        <!-- 页面选择 -->
        <div class="page-selector">
          <el-select
            v-model="browserViewStore.selectedPageIndex"
            placeholder="选择监控窗口"
            size="small"
            style="width: 100%"
            @change="browserViewStore.captureScreenshot()"
          >
            <el-option
              v-for="(page, index) in browserViewStore.pages"
              :key="page.id"
              :label="page.title || page.url"
              :value="index"
            />
          </el-select>
        </div>

        <!-- 截图显示 -->
        <div ref="monitorContainerRef" class="monitor-view">
          <div v-if="displayScreenshot" class="screenshot-wrap">
            <img :src="displayScreenshot" class="screenshot-img" @load="drawOverlay" />
            <canvas
              v-if="browserViewStore.pickerActive"
              ref="canvasRef"
              class="picker-overlay"
              @mousedown="handleCanvasMouseDown"
              @mousemove="handleCanvasMouseMove"
              @mouseup="handleCanvasMouseUp"
              @mouseleave="handleCanvasMouseLeave"
            />
            <div
              v-if="browserViewStore.hoverIndex >= 0 && browserViewStore.pickerActive"
              class="picker-tooltip"
            >
              <div class="tooltip-tag">{{ browserViewStore.pickerElements[browserViewStore.hoverIndex]?.tag }}</div>
              <div class="tooltip-text">{{ browserViewStore.pickerElements[browserViewStore.hoverIndex]?.text || '(无文本)' }}</div>
              <div class="tooltip-sel">{{ browserViewStore.pickerElements[browserViewStore.hoverIndex]?.selector }}</div>
            </div>
          </div>
          <el-empty v-else description="暂无窗口，请先选择页面" :image-size="60" />
        </div>

        <!-- 录制步骤列表 -->
        <div v-if="browserViewStore.pickerMode" class="recorded-steps">
          <div class="steps-header">
            <span>录制步骤 ({{ browserViewStore.recordedSteps.length }})</span>
            <div>
              <el-button size="small" type="success" @click="handlePlaySteps" :disabled="browserViewStore.recordedSteps.length === 0 || browserViewStore.isPlaying">
                <el-icon><VideoPlay /></el-icon>
                {{ browserViewStore.isPlaying ? '执行中...' : '执行' }}
              </el-button>
              <el-button size="small" text type="danger" @click="browserViewStore.clearSteps" :disabled="browserViewStore.recordedSteps.length === 0 || browserViewStore.isPlaying">清空</el-button>
            </div>
          </div>
          <div class="steps-list">
            <div
              v-for="(step, index) in browserViewStore.recordedSteps"
              :key="step.id"
              class="step-item"
              :class="{ 'is-playing': browserViewStore.isPlaying && browserViewStore.playingStepIndex === index }"
            >
              <span class="step-num">{{ index + 1 }}</span>
              <el-tag size="small" type="danger" effect="plain">点击</el-tag>
              <span class="step-text">{{ step.text }}</span>
              <el-button text size="small" type="danger" @click="browserViewStore.removeStep(step.id)" :disabled="browserViewStore.isPlaying">
                <el-icon><Close /></el-icon>
              </el-button>
            </div>
            <div v-if="browserViewStore.recordedSteps.length === 0" class="steps-empty">
              在页面上拖拽红色框选区域以录制操作步骤
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：执行进度 -->
      <div class="progress-section">
        <div class="card">
          <div class="section-title">
            <el-icon><VideoPlay /></el-icon>
            <span>执行进度</span>
            <el-tag v-if="runningTask" type="primary" size="small" effect="plain" style="margin-left: auto">
              #{{ runningTask.id }} {{ runningTask.productName }}
            </el-tag>
          </div>
          <div v-if="currentTaskSteps.length" class="steps-area">
            <el-steps direction="vertical" :active="currentTaskSteps.findIndex(s => s.status === 'process')">
              <el-step
                v-for="item in currentTaskSteps"
                :key="item.step"
                :title="item.label"
                :status="item.status === 'finish' ? 'success' : item.status === 'process' ? 'process' : 'wait'"
              />
            </el-steps>
          </div>
          <el-empty v-else description="当前无运行中任务" :image-size="60" />
        </div>

        <!-- 最近异常 -->
        <div class="card mt-16">
          <div class="section-title">
            <el-icon><WarningFilled /></el-icon>
            <span>最近异常</span>
          </div>
          <div v-if="recentErrors.length" class="error-list">
            <div v-for="item in recentErrors" :key="item.id" class="error-item" @click="logStore.currentScreenshot = item.screenshotPath ?? null">
              <el-tag type="danger" size="small" effect="dark">错误</el-tag>
              <span class="error-msg">{{ item.message }}</span>
            </div>
          </div>
          <el-empty v-else description="暂无异常" :image-size="50" />
        </div>
      </div>
    </div>

    <!-- 快捷操作 -->
    <div class="card mt-24">
      <div class="section-title">
        <el-icon><Operation /></el-icon>
        <span>快捷操作</span>
      </div>
      <div class="quick-actions">
        <div
          v-for="action in quickActions"
          :key="action.label"
          class="quick-action-card"
          :style="{ '--action-color': action.color }"
          @click="handleAction(action.action, action.path)"
        >
          <el-icon size="28" :color="action.color"><component :is="action.icon" /></el-icon>
          <div class="action-info">
            <div class="action-label">{{ action.label }}</div>
            <div class="action-desc">{{ action.desc }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 自然语言指令输入栏 -->
    <div class="nl-bar card mt-24">
      <el-input
        v-model="nlInput"
        placeholder="输入指令，如：点击发布 / 双击编辑 / 填写标题为xxx / 后退 / 截图 / 向下滚动..."
        size="large"
        clearable
        @keyup.enter="sendNlCommand"
      >
        <template #prefix>
          <el-icon><ChatDotRound /></el-icon>
        </template>
        <template #append>
          <el-button type="primary" @click="sendNlCommand">
            <el-icon><Promotion /></el-icon>
            发送
          </el-button>
        </template>
      </el-input>
    </div>

    <!-- 截图预览弹窗 -->
    <el-dialog v-model="screenshotDialogVisible" title="异常截图" width="60%" @close="logStore.currentScreenshot = null">
      <img v-if="logStore.currentScreenshot" :src="screenshotUrl(logStore.currentScreenshot)" style="width: 100%" />
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.dashboard { padding-bottom: 20px; }

.stats-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.stat-card {
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  border-left: 4px solid var(--accent);

  .stat-icon {
    width: 56px;
    height: 56px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
  }

  .stat-label { font-size: 13px; color: #909399; margin-bottom: 4px; }
  .stat-value { font-size: 26px; font-weight: 700; color: #303133; }
}

.workspace {
  display: flex;
  gap: 20px;
}

.monitor-section {
  flex: 3;
  display: flex;
  flex-direction: column;
}

.progress-section {
  flex: 2;
  display: flex;
  flex-direction: column;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;

  .section-actions {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }
}

.page-selector {
  margin-bottom: 12px;
}

.monitor-view {
  flex: 1;
  min-height: 300px;
  background: #f5f7fa;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

.screenshot-wrap {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  position: relative;
}

.screenshot-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
}

.picker-overlay {
  position: absolute;
  cursor: crosshair;
  z-index: 10;
  user-select: none;
}

.picker-tooltip {
  position: absolute;
  bottom: 12px;
  left: 12px;
  background: rgba(0, 0, 0, 0.85);
  color: #fff;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  z-index: 20;
  max-width: 300px;
  pointer-events: none;

  .tooltip-tag { color: #409eff; font-weight: bold; margin-bottom: 2px; }
  .tooltip-text { color: #ccc; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tooltip-sel { color: #67c23a; font-family: monospace; font-size: 11px; word-break: break-all; }
}

.recorded-steps {
  border-top: 1px solid #f0f0f0;
  margin-top: 12px;
  padding-top: 12px;

  .steps-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .steps-list {
    max-height: 160px;
    overflow-y: auto;
  }

  .step-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    transition: background 0.2s;

    &:hover { background: #f5f7fa; }
    &.is-playing {
      background: #fef0f0;
      border: 1px solid #fde2e2;
    }
  }

  .step-num {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #e63946;
    color: #fff;
    font-size: 12px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .step-text {
    flex: 1;
    font-size: 12px;
    color: #606266;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .steps-empty {
    text-align: center;
    color: #909399;
    font-size: 13px;
    padding: 12px;
  }
}

.steps-area {
  padding: 8px 0;
}

.error-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.error-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #fef0f0;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;

  &:hover { background: #fde2e2; }
  .error-msg { flex: 1; color: #606266; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}

.quick-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.quick-action-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border-radius: 10px;
  border: 1px solid #ebeef5;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--action-color);
    box-shadow: 0 2px 12px color-mix(in srgb, var(--action-color) 20%, transparent);
  }

  .action-label { font-size: 15px; font-weight: 600; color: #303133; margin-bottom: 4px; }
  .action-desc { font-size: 12px; color: #909399; }
}

.nl-bar {
  .el-input-group__append {
    padding: 0;
  }
}
</style>

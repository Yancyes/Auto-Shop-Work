<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDashboardStore } from '@/stores/log'
import { useTaskStore } from '@/stores/task'
import { useLogStore } from '@/stores/log'
import { STEP_LABELS, screenshotUrl } from '@/utils'
import type { RunLog, ProgressStep } from '../../shared/types'

const router = useRouter()
const dashboardStore = useDashboardStore()
const taskStore = useTaskStore()
const logStore = useLogStore()

const screenshotDialogVisible = ref(false)

// 最近错误日志（响应式）
const recentErrors = computed<RunLog[]>(() => logStore.logs.filter(l => l.level === 'error').slice(0, 3))

// 当前运行中任务的步骤
const currentTaskSteps = computed<ProgressStep[]>(() => {
  const running = taskStore.tasks.find(t => t.status === 'running')
  if (!running) return []

  const steps = Object.keys(STEP_LABELS)
  return steps.map(s => ({
    step: s as ProgressStep['step'],
    label: STEP_LABELS[s],
    status: getStepStatus(running.currentStep, s)
  }))
})

// 当 currentScreenshot 变化时控制弹窗
watch(() => logStore.currentScreenshot, (val) => {
  if (val) screenshotDialogVisible.value = true
})

// 快捷操作
const quickActions = [
  { label: '快速上架', icon: 'Rocket', desc: '选择模板，一键启动上架', path: '/tasks', color: '#ff6b35' },
  { label: '批量导入', icon: 'Upload', desc: '批量生成上架任务', path: '/tasks', color: '#409eff' },
  { label: '停止所有', icon: 'VideoPause', desc: '终止所有运行中任务', action: 'stopAll', color: '#f56c6c' }
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
  if (action === 'stopAll') {
    await taskStore.stopAll()
  }
  if (path) router.push(path)
}

onMounted(() => {
  loadData()
  // 每 3 秒刷新一次数据
  pollTimer = setInterval(loadData, 3000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="dashboard">
    <!-- 核心数据卡片区 -->
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

    <!-- 实时进度区 -->
    <div class="card mt-24">
      <div class="section-title">
        <el-icon><VideoPlay /></el-icon>
        <span>实时执行进度</span>
      </div>
      <div v-if="currentTaskSteps.length" class="progress-area">
        <el-steps :active="currentTaskSteps.findIndex(s => s.status === 'process')" align-center>
          <el-step
            v-for="item in currentTaskSteps"
            :key="item.step"
            :title="item.label"
            :status="item.status === 'finish' ? 'success' : item.status === 'process' ? 'process' : 'wait'"
          />
        </el-steps>
      </div>
      <el-empty v-else description="当前无运行中任务" :image-size="80" />
    </div>

    <!-- 最近异常记录区 -->
    <div class="card mt-24">
      <div class="section-title">
        <el-icon><WarningFilled /></el-icon>
        <span>最近异常记录</span>
      </div>
      <div v-if="recentErrors.length" class="error-list">
        <div v-for="item in recentErrors" :key="item.id" class="error-item" @click="logStore.currentScreenshot = item.screenshotPath ?? null">
          <el-tag type="danger" size="small" effect="dark">错误</el-tag>
          <span class="error-msg">{{ item.message }}</span>
          <span class="error-time">{{ item.createdAt }}</span>
        </div>
      </div>
      <el-empty v-else description="暂无异常记录" :image-size="80" />
    </div>

    <!-- 快捷操作区 -->
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

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
}

.progress-area { padding: 12px 0; }

.error-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.error-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: #fef0f0;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;

  &:hover { background: #fde2e2; }

  .error-msg { flex: 1; color: #606266; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .error-time { color: #c0c4cc; font-size: 12px; }
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
</style>

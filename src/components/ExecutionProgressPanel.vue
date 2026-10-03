<script setup lang="ts">
/**
 * 执行进度面板：并发执行时每个脚本一张卡，展示当前步骤/轮次/耗时，
 * 并可单独暂停、恢复、终止。进度状态由 script store 单一来源驱动。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useScriptStore, type ProgressState } from '@/stores/script'
import { fmtDuration } from '@/utils'

const scriptStore = useScriptStore()

// 实时计时器：每秒刷新当前步骤已耗时
const nowTick = ref(Date.now())
let tickTimer: number | null = null
/** 每个脚本进入暂停态那一刻的已耗时：暂停期间冻结显示，恢复后继续走 */
const frozenElapsed = new Map<number, number>()

const items = computed(() =>
  scriptStore.progressList.map(progress => ({
    progress,
    name: scriptStore.scripts.find(s => s.id === progress.scriptId)?.name ?? `脚本 ${progress.scriptId}`
  }))
)

function rawElapsed(progress: ProgressState, now: number): number {
  if (!progress.stepStartedAt) return 0
  return Math.max(0, Math.floor((now - progress.stepStartedAt) / 1000))
}

function elapsedSec(progress: ProgressState): number {
  // 暂停时冻结计时：否则「已耗时」会一路涨，看不出步骤本身到底花了多久
  if (progress.paused) return frozenElapsed.get(progress.scriptId) ?? rawElapsed(progress, Date.now())
  return rawElapsed(progress, nowTick.value)
}

function percentage(progress: ProgressState): number {
  if (progress.totalSteps <= 0 || progress.stepIndex < 0) return 0
  return Math.round(((progress.stepIndex + 1) / progress.totalSteps) * 100)
}

function runsLabel(progress: ProgressState): string {
  // -1 表示无限循环
  return progress.totalRuns < 0
    ? `第 ${progress.currentRun} 次（无限）`
    : `第 ${progress.currentRun}/${progress.totalRuns} 次`
}

function stepLabel(progress: ProgressState): string {
  return `步骤 ${Math.max(progress.stepIndex + 1, 0)}/${progress.totalSteps}`
}

async function pause(progress: ProgressState) {
  const res = await scriptStore.pauseScript(progress.scriptId)
  if (!res.success) ElMessage.error(res.error || '暂停失败')
}

async function resume(progress: ProgressState) {
  const res = await scriptStore.resumeScript(progress.scriptId)
  if (!res.success) ElMessage.error(res.error || '恢复失败')
}

async function terminate(progress: ProgressState, name: string) {
  try {
    await ElMessageBox.confirm(`确定终止「${name}」的执行？`, '提示', { type: 'warning' })
    const res = await scriptStore.terminateScript(progress.scriptId)
    if (res.success) ElMessage.success('脚本已终止')
    else ElMessage.error(res.error || '终止失败')
  } catch {
    // cancelled
  }
}

onMounted(() => {
  tickTimer = window.setInterval(() => {
    const now = Date.now()
    for (const progress of scriptStore.progressList) {
      if (progress.paused) {
        if (!frozenElapsed.has(progress.scriptId)) {
          frozenElapsed.set(progress.scriptId, rawElapsed(progress, now))
        }
      } else {
        frozenElapsed.delete(progress.scriptId)
      }
    }
    nowTick.value = now
  }, 1000)
})

onUnmounted(() => {
  if (tickTimer !== null) {
    clearInterval(tickTimer)
    tickTimer = null
  }
})
</script>

<template>
  <div class="progress-stack">
    <div v-for="{ progress, name } in items" :key="progress.scriptId" class="progress-bar card">
      <div class="progress-header">
        <div class="progress-info">
          <el-icon class="is-loading" v-if="!progress.paused"><Loading /></el-icon>
          <el-icon v-else color="#909399"><VideoPause /></el-icon>
          <span class="progress-name">{{ name }}</span>
          <span>
            {{ progress.paused ? '已暂停' : '正在执行' }}
            · {{ runsLabel(progress) }}
            · {{ stepLabel(progress) }}
          </span>
        </div>
        <div class="progress-actions">
          <el-button v-if="!progress.paused" type="warning" size="small" plain @click="pause(progress)">
            <el-icon><VideoPause /></el-icon>
            暂停
          </el-button>
          <el-button v-else type="success" size="small" @click="resume(progress)">
            <el-icon><VideoPlay /></el-icon>
            恢复
          </el-button>
          <el-button type="danger" size="small" plain @click="terminate(progress, name)">
            <el-icon><Close /></el-icon>
            终止
          </el-button>
        </div>
      </div>
      <el-progress
        :percentage="percentage(progress)"
        :stroke-width="8"
        :status="progress.paused ? 'warning' : undefined"
        style="margin-top: 8px;"
      />
      <div class="progress-detail">
        <span class="step-desc" :title="progress.stepDescription">
          {{ progress.stepDescription || '—' }}
        </span>
        <span class="step-elapsed">
          <el-icon><Timer /></el-icon>
          已耗时 {{ fmtDuration(elapsedSec(progress)) }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.progress-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.progress-bar {
  padding: 14px 16px;
  background: #fdf6ec;
  border: 1px solid #f5dab1;

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .progress-info {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #e6a23c;
    font-weight: 500;
    white-space: nowrap;
  }

  .progress-name {
    color: #303133;
    font-weight: 600;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .progress-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .progress-detail {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
    font-size: 12px;

    .step-desc {
      flex: 1;
      color: #606266;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .step-elapsed {
      display: flex;
      align-items: center;
      gap: 4px;
      color: #909399;
      flex-shrink: 0;
    }
  }
}
</style>

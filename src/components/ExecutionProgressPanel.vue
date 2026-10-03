<script setup lang="ts">
/**
 * 执行进度面板：并发执行时每个脚本一张卡，展示当前步骤/轮次/耗时。
 * 除了暂停恢复，这里还能跳过/回退步骤；监控命中时卡片变成接管面板，
 * 直接把「哪块区域、什么关键词变的」和当时的画面热区摆出来，用户看完就能决定怎么走。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import MonitorDiffView from './MonitorDiffView.vue'
import { useScriptStore, type ProgressState } from '@/stores/script'
import { fmtDuration } from '@/utils'
import { describeHit } from '../../shared/monitor-config'

const scriptStore = useScriptStore()

/** 「改步骤」由父级决定用哪个编辑器打开：脚本管理页与录制页各自的弹窗状态不同 */
const emit = defineEmits<{ edit: [scriptId: number] }>()

// 实时计时器：每秒刷新当前步骤已耗时
const nowTick = ref(Date.now())
let tickTimer: number | null = null
/** 每个脚本进入暂停态那一刻的已耗时：暂停期间冻结显示，恢复后继续走 */
const frozenElapsed = new Map<number, number>()

const items = computed(() =>
  scriptStore.progressList.map(progress => ({
    progress,
    name: scriptStore.scriptOf(progress.scriptId)?.name ?? `脚本 ${progress.scriptId}`
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

function phaseLabel(progress: ProgressState): string {
  if (progress.takeover) return '等待接管'
  return progress.paused ? '已暂停' : '正在执行'
}

function hitText(scriptId: number): string {
  const hit = scriptStore.hits.get(scriptId)
  if (!hit) return '区域数据发生变化，脚本已停在当前步骤等你'
  const monitor = scriptStore.monitorsOf(scriptStore.scriptOf(scriptId)).find(m => m.id === hit.monitorId)
  if (!monitor) return `${hit.label} 画面变化占比 ${Math.round(hit.ratio * 100)}%`
  return describeHit(monitor, hit.appeared, hit.disappeared)
}

function hitSnapshot(scriptId: number): string {
  return scriptStore.hits.get(scriptId)?.snapshot ?? ''
}

function hitBlocks(scriptId: number): number[] {
  return scriptStore.hits.get(scriptId)?.blocks ?? []
}

async function pause(progress: ProgressState) {
  const res = await scriptStore.pauseScript(progress.scriptId)
  if (!res.success) ElMessage.error(res.error || '暂停失败')
}

async function resume(progress: ProgressState) {
  const res = await scriptStore.resumeScript(progress.scriptId)
  if (!res.success) ElMessage.error(res.error || '恢复失败')
}

/** 跳过当前步：监控命中暂停时用的就是这一步，跳过即「这个变化我不打算处理，往下走」 */
async function skip(progress: ProgressState) {
  const res = progress.takeover
    ? await scriptStore.resolveTakeover(progress.scriptId, 'skip')
    : await scriptStore.skipStep(progress.scriptId)
  if (!res.success) ElMessage.error(res.error || '跳过失败')
  else if (!progress.takeover) ElMessage.info('已跳过当前步骤')
}

async function back(progress: ProgressState) {
  const res = await scriptStore.stepBack(progress.scriptId)
  if (!res.success) ElMessage.error(res.error || '回退失败，可能已经是最前一步')
}

/** 接管时的「继续执行」：接着跑等待中的那一步，改过的内容就按新样子执行 */
async function continueRun(progress: ProgressState) {
  const res = await scriptStore.resolveTakeover(progress.scriptId, 'resume')
  if (!res.success) ElMessage.error(res.error || '继续失败')
}

async function terminate(progress: ProgressState, name: string) {
  try {
    await ElMessageBox.confirm(`确定终止「${name}」的执行？`, '提示', { type: 'warning' })
    const res = progress.takeover
      ? await scriptStore.resolveTakeover(progress.scriptId, 'abort')
      : await scriptStore.terminateScript(progress.scriptId)
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
    <div
      v-for="{ progress, name } in items"
      :key="progress.scriptId"
      class="progress-bar card"
      :class="{ 'is-takeover': progress.takeover }"
    >
      <div class="progress-header">
        <div class="progress-info">
          <el-icon class="is-loading" v-if="!progress.paused"><Loading /></el-icon>
          <el-icon v-else color="#909399"><VideoPause /></el-icon>
          <span class="progress-name">{{ name }}</span>
          <span>
            {{ phaseLabel(progress) }}
            · {{ runsLabel(progress) }}
            · {{ stepLabel(progress) }}
          </span>
        </div>
        <div class="progress-actions">
          <template v-if="!progress.takeover">
            <el-button v-if="!progress.paused" type="warning" size="small" plain @click="pause(progress)">
              <el-icon><VideoPause /></el-icon>
              暂停
            </el-button>
            <el-button v-else type="success" size="small" @click="resume(progress)">
              <el-icon><VideoPlay /></el-icon>
              恢复
            </el-button>
            <el-button size="small" plain title="跳过当前步骤，直接执行下一步" @click="skip(progress)">
              <el-icon><Right /></el-icon>
              跳过本步
            </el-button>
            <el-button size="small" plain title="退回上一步重做" @click="back(progress)">
              <el-icon><Back /></el-icon>
              回退
            </el-button>
          </template>
          <template v-else>
            <el-button type="success" size="small" @click="continueRun(progress)">
              <el-icon><VideoPlay /></el-icon>
              继续执行
            </el-button>
            <el-button type="warning" size="small" plain @click="skip(progress)">
              <el-icon><Right /></el-icon>
              跳过本步
            </el-button>
          </template>
          <el-button size="small" plain title="边跑边改步骤，当前这一步跑完生效" @click="emit('edit', progress.scriptId)">
            <el-icon><Edit /></el-icon>
            改步骤
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
        :status="progress.takeover ? 'exception' : progress.paused ? 'warning' : undefined"
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

      <!-- 接管面板：说清楚是哪块区域因为什么停的，并给出当时的画面 -->
      <div v-if="progress.takeover" class="takeover-box">
        <div class="takeover-text">
          <el-icon color="#f56c6c"><WarningFilled /></el-icon>
          {{ hitText(progress.scriptId) }}
        </div>
        <MonitorDiffView
          v-if="hitSnapshot(progress.scriptId)"
          :snapshot="hitSnapshot(progress.scriptId)"
          :blocks="hitBlocks(progress.scriptId)"
          :blocks-x="scriptStore.hits.get(progress.scriptId)?.blocksX"
          :blocks-y="scriptStore.hits.get(progress.scriptId)?.blocksY"
        />
        <div class="takeover-tip">可以先改下面的步骤再点「继续执行」，等待中的那一步会按改后的内容执行。</div>
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

  &.is-takeover {
    background: #fef0f0;
    border-color: #fbc4c4;
  }

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

.takeover-box {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #fbc4c4;
  display: flex;
  flex-direction: column;
  gap: 8px;

  .takeover-text {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #f56c6c;
    font-weight: 600;
  }

  .takeover-tip {
    font-size: 12px;
    color: #909399;
  }
}
</style>

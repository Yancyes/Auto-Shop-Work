<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useScriptStore } from '@/stores/script'
import { SCRIPT_STATUS_MAP, formatDate } from '@/utils'
import StepListEditor from '@/components/StepListEditor.vue'
import type { RecordedScript, RecordedStep } from '../../shared/types'

const scriptStore = useScriptStore()

const runDialogVisible = ref(false)
const runTarget = ref<RecordedScript | null>(null)
const runCount = ref(1)
const runInfinite = ref(false)

// 实时计时器：每秒刷新当前步骤已耗时
const nowTick = ref(Date.now())
let tickTimer: number | null = null
const elapsedSec = computed(() => {
  const started = scriptStore.progressStepStartedAt
  if (!started) return 0
  return Math.max(0, Math.floor((nowTick.value - started) / 1000))
})
function fmtSec(s: number): string {
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}分${r}秒` : `${r}秒`
}
function fmtPct(idx: number, total: number): number {
  if (total <= 0) return 0
  if (idx < 0) return 0
  return Math.round(((idx + 1) / total) * 100)
}

/** 显示执行次数：-1 表示无限循环 */
function fmtRuns(current: number, total: number): string {
  return total < 0 ? `第 ${current} 次（无限）` : `第 ${current}/${total} 次`
}

function openRunDialog(script: RecordedScript) {
  runTarget.value = script
  runCount.value = 1
  runInfinite.value = false
  runDialogVisible.value = true
}

async function confirmRun() {
  if (!runTarget.value) return
  // 无限循环用 0 表示，主进程转换为 Infinity
  const count = runInfinite.value ? 0 : runCount.value
  const res = await scriptStore.runScript(runTarget.value.id, count)
  if (res.success) {
    ElMessage.success(runInfinite.value ? '脚本已开始无限循环执行' : `脚本已开始执行（${runCount.value} 次）`)
  } else {
    ElMessage.error(res.error || '启动失败')
  }
  runDialogVisible.value = false
}

async function handleDelete(script: RecordedScript) {
  try {
    await ElMessageBox.confirm(`确定删除脚本「${script.name}」？删除后不可恢复`, '提示', { type: 'warning' })
    const res = await scriptStore.deleteScript(script.id)
    if (res.success) {
      ElMessage.success('脚本已删除')
    } else {
      ElMessage.error(res.error || '删除失败')
    }
  } catch {
    // cancelled
  }
}

async function stopAll() {
  try {
    await ElMessageBox.confirm('确定停止所有正在执行的脚本？', '提示', { type: 'warning' })
    const res = await scriptStore.stopAll()
    if (res.success) ElMessage.success('已停止所有脚本')
    else ElMessage.error(res.error || '停止失败')
  } catch {
    // cancelled
  }
}

async function pauseCurrent() {
  if (scriptStore.progressScriptId === null) return
  const res = await scriptStore.pauseScript(scriptStore.progressScriptId)
  if (!res.success) ElMessage.error(res.error || '暂停失败')
}

async function resumeCurrent() {
  if (scriptStore.progressScriptId === null) return
  const res = await scriptStore.resumeScript(scriptStore.progressScriptId)
  if (!res.success) ElMessage.error(res.error || '恢复失败')
}

async function terminateCurrent() {
  if (scriptStore.progressScriptId === null) return
  try {
    await ElMessageBox.confirm('确定终止当前脚本执行？', '提示', { type: 'warning' })
    const res = await scriptStore.terminateScript(scriptStore.progressScriptId)
    if (res.success) ElMessage.success('脚本已终止')
    else ElMessage.error(res.error || '终止失败')
  } catch {
    // cancelled
  }
}

function parseSteps(script: RecordedScript): RecordedStep[] {
  try {
    const steps = JSON.parse(script.stepsJson || '[]')
    return Array.isArray(steps) ? steps : []
  } catch {
    return []
  }
}

function getStepCount(script: RecordedScript): number {
  return parseSteps(script).length
}

// ========== 步骤编辑 ==========

const editDialogVisible = ref(false)
const editTarget = ref<RecordedScript | null>(null)
const editSteps = ref<RecordedStep[]>([])
const editSaving = ref(false)

function openEditDialog(script: RecordedScript) {
  editTarget.value = script
  // 深拷贝：改动只在点「保存」后才写回数据库，取消即丢弃
  editSteps.value = parseSteps(script).map(s => ({ ...s }))
  editDialogVisible.value = true
}

async function confirmEdit() {
  if (!editTarget.value) return
  if (editSteps.value.length === 0) {
    ElMessage.warning('脚本至少需要保留一个步骤')
    return
  }
  editSaving.value = true
  const res = await scriptStore.updateScriptSteps(editTarget.value, editSteps.value)
  editSaving.value = false
  if (res.success) {
    ElMessage.success('步骤已保存，下次执行即生效')
    editDialogVisible.value = false
  } else {
    ElMessage.error(res.error || '保存失败')
  }
}

onMounted(() => {
  scriptStore.loadScripts()
  tickTimer = window.setInterval(() => { nowTick.value = Date.now() }, 1000)
})

onUnmounted(() => {
  if (tickTimer !== null) {
    clearInterval(tickTimer)
    tickTimer = null
  }
})
</script>

<template>
  <div class="scripts-page">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <h3 class="page-subtitle">已保存的脚本</h3>
        <el-tag size="small" round>{{ scriptStore.scripts.length }}</el-tag>
      </div>
      <div class="toolbar-right">
        <el-button v-if="scriptStore.isProgressing" type="danger" plain @click="stopAll">
          <el-icon><VideoPause /></el-icon>
          停止全部
        </el-button>
        <el-button @click="scriptStore.loadScripts()">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <!-- 执行进度条 -->
    <div v-if="scriptStore.isProgressing" class="progress-bar card">
      <div class="progress-header">
        <div class="progress-info">
          <el-icon class="is-loading" v-if="!scriptStore.progressPaused"><Loading /></el-icon>
          <el-icon v-else color="#909399"><VideoPause /></el-icon>
          <span>
            {{ scriptStore.progressPaused ? '已暂停' : '正在执行' }}
            · {{ fmtRuns(scriptStore.progressCurrentRun, scriptStore.progressTotalRuns) }}
            · 步骤 {{ Math.max(scriptStore.progressStepIndex + 1, 0) }}/{{ scriptStore.progressTotalSteps }}
          </span>
        </div>
        <div class="progress-actions">
          <el-button v-if="!scriptStore.progressPaused" type="warning" size="small" plain @click="pauseCurrent">
            <el-icon><VideoPause /></el-icon>
            暂停
          </el-button>
          <el-button v-else type="success" size="small" @click="resumeCurrent">
            <el-icon><VideoPlay /></el-icon>
            恢复
          </el-button>
          <el-button type="danger" size="small" plain @click="terminateCurrent">
            <el-icon><Close /></el-icon>
            终止
          </el-button>
        </div>
      </div>
      <el-progress
        :percentage="fmtPct(scriptStore.progressStepIndex, scriptStore.progressTotalSteps)"
        :stroke-width="8"
        :status="scriptStore.progressPaused ? 'warning' : undefined"
        style="margin-top: 8px;"
      />
      <div class="progress-detail">
        <span class="step-desc" :title="scriptStore.progressStepDescription">
          {{ scriptStore.progressStepDescription || '—' }}
        </span>
        <span class="step-elapsed">
          <el-icon><Timer /></el-icon>
          已耗时 {{ fmtSec(elapsedSec) }}
        </span>
      </div>
    </div>

    <!-- 脚本列表 -->
    <div v-if="scriptStore.scripts.length" class="script-list">
      <div
        v-for="script in scriptStore.scripts"
        :key="script.id"
        class="script-card card"
      >
        <div class="script-header">
          <div class="script-title">
            <span class="script-name">{{ script.name }}</span>
            <el-tag :type="SCRIPT_STATUS_MAP[script.status]?.type" size="small">
              {{ SCRIPT_STATUS_MAP[script.status]?.label }}
            </el-tag>
          </div>
          <div class="script-actions">
            <el-button type="primary" size="small" @click="openRunDialog(script)" :disabled="scriptStore.isProgressing">
              <el-icon><VideoPlay /></el-icon>
              执行
            </el-button>
            <el-button size="small" plain :disabled="scriptStore.progressScriptId === script.id" @click="openEditDialog(script)">
              <el-icon><Edit /></el-icon>
              编辑步骤
            </el-button>
            <el-button type="danger" text size="small" @click="handleDelete(script)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
        </div>

        <div class="script-meta">
          <span class="meta-item">
            <el-icon><Link /></el-icon>
            {{ script.targetUrl }}
          </span>
          <span class="meta-item">
            <el-icon><List /></el-icon>
            {{ getStepCount(script) }} 个步骤
          </span>
          <span class="meta-item">
            <el-icon><Timer /></el-icon>
            已执行 {{ script.runCount }} 次
          </span>
          <span class="meta-item">
            <el-icon><Clock /></el-icon>
            {{ formatDate(script.createdAt) }}
          </span>
        </div>

        <div v-if="script.description" class="script-desc">
          {{ script.description }}
        </div>
      </div>
    </div>

    <el-empty v-else description="暂无脚本，请在操作录制页面录制并保存" :image-size="100" />

    <!-- 执行对话框 -->
    <el-dialog v-model="runDialogVisible" title="执行脚本" width="380px">
      <el-form label-width="80px">
        <el-form-item label="脚本">
          <span>{{ runTarget?.name }}</span>
        </el-form-item>
        <el-form-item label="步骤数">
          <span>{{ runTarget ? getStepCount(runTarget) : 0 }}</span>
        </el-form-item>
        <el-form-item label="无限循环">
          <el-switch v-model="runInfinite" />
          <span style="margin-left: 8px; color: #909399; font-size: 12px;">
            开启后将持续执行直到手动终止
          </span>
        </el-form-item>
        <el-form-item label="执行次数" v-if="!runInfinite">
          <el-input-number v-model="runCount" :min="1" :max="100" />
        </el-form-item>
        <el-form-item label="执行次数" v-else>
          <span style="color: #e6a23c; font-weight: 500;">∞ 无限循环</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="runDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmRun">开始执行</el-button>
      </template>
    </el-dialog>

    <!-- 步骤编辑弹窗 -->
    <el-dialog
      v-model="editDialogVisible"
      :title="`编辑步骤 · ${editTarget?.name ?? ''}`"
      width="720px"
      top="8vh"
    >
      <div class="edit-meta">
        <span class="edit-url" :title="editTarget?.targetUrl">
          <el-icon><Link /></el-icon>
          {{ editTarget?.targetUrl }}
        </span>
        <el-tag size="small" round>{{ editSteps.length }} 个步骤</el-tag>
      </div>
      <div class="edit-body">
        <StepListEditor v-model="editSteps" confirm-remove />
      </div>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="confirmEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.scripts-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #fff;
  border-radius: 8px;
  margin-bottom: 12px;

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .toolbar-right {
    display: flex;
    gap: 8px;
  }
}

.page-subtitle {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.progress-bar {
  padding: 14px 16px;
  margin-bottom: 12px;
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

.script-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.script-card {
  padding: 16px 20px;
}

.script-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;

  .script-title {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .script-name {
    font-size: 16px;
    font-weight: 600;
    color: #303133;
  }

  .script-actions {
    display: flex;
    gap: 6px;
  }
}

.script-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;

  .meta-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #909399;
  }
}

.script-desc {
  margin-top: 10px;
  font-size: 13px;
  color: #606266;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 6px;
}

.edit-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #f0f0f0;

  .edit-url {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #909399;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.edit-body {
  display: flex;
  flex-direction: column;
  height: 52vh;
  margin: 0 -20px;
}
</style>

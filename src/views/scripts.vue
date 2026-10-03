<script setup lang="ts">
import { ref, computed } from 'vue'
import { useScriptStore } from '@/stores/script'
import ExecutionProgressPanel from '@/components/ExecutionProgressPanel.vue'
import ScriptCard from '@/components/ScriptCard.vue'
import RunScriptDialog from '@/components/RunScriptDialog.vue'
import EditStepsDialog from '@/components/EditStepsDialog.vue'
import ScriptDataDialog from '@/components/ScriptDataDialog.vue'
import MonitorDialog from '@/components/MonitorDialog.vue'
import type { RecordedScript, RecordedStep, RegionMonitor } from '../../shared/types'

const scriptStore = useScriptStore()

const runDialogVisible = ref(false)
const runTarget = ref<RecordedScript | null>(null)

const editDialogVisible = ref(false)
const editTarget = ref<RecordedScript | null>(null)
const editSaving = ref(false)

const dataDialogVisible = ref(false)
const dataTarget = ref<RecordedScript | null>(null)
const dataSaving = ref(false)

const monitorDialogVisible = ref(false)
const monitorTarget = ref<RecordedScript | null>(null)
const monitorSaving = ref(false)

/** 正在执行时才走热更新：普通保存不会影响已经在跑的那一轮 */
const editProgress = computed(() =>
  editTarget.value ? scriptStore.progresses.get(editTarget.value.id) : undefined
)

function openRunDialog(script: RecordedScript) {
  runTarget.value = script
  runDialogVisible.value = true
}

/** count 为 0 表示无限循环，主进程转换为 Infinity；defaults 是本次执行填的变量值 */
async function confirmRun(count: number, defaults: Record<string, string>) {
  if (!runTarget.value) return
  const res = await scriptStore.runScript(runTarget.value.id, count, defaults)
  if (res.success) {
    ElMessage.success(count === 0 ? '脚本已开始无限循环执行' : `脚本已开始执行（${count} 次）`)
  } else {
    ElMessage.error(res.error || '启动失败')
  }
  runDialogVisible.value = false
}

function openEditDialog(script: RecordedScript) {
  editTarget.value = script
  editDialogVisible.value = true
}

/** 进度卡上的「改步骤」：执行中的脚本走热更新，保存即影响下一轮 */
function openLiveEdit(scriptId: number) {
  const script = scriptStore.scriptOf(scriptId)
  if (!script) {
    ElMessage.warning('脚本列表还没刷新出来，稍等一下再试')
    return
  }
  editTarget.value = script
  editDialogVisible.value = true
}

function openDataDialog(script: RecordedScript) {
  dataTarget.value = script
  dataDialogVisible.value = true
}

function openMonitorDialog(script: RecordedScript) {
  monitorTarget.value = script
  monitorDialogVisible.value = true
}

async function confirmData(dataJson: string) {
  if (!dataTarget.value) return
  dataSaving.value = true
  const res = await scriptStore.updateScriptData(dataTarget.value, dataJson)
  dataSaving.value = false
  if (res.success) {
    ElMessage.success('数据已保存，执行时按行取用')
    dataDialogVisible.value = false
  } else {
    ElMessage.error(res.error || '保存失败')
  }
}

async function confirmMonitors(monitors: RegionMonitor[]) {
  if (!monitorTarget.value) return
  monitorSaving.value = true
  const res = await scriptStore.updateScriptMonitors(monitorTarget.value, monitors)
  monitorSaving.value = false
  if (res.success) {
    ElMessage.success(monitors.length ? '监控区域已保存' : '已清空监控区域')
    monitorDialogVisible.value = false
  } else {
    ElMessage.error(res.error || '保存失败')
  }
}

async function confirmEdit(steps: RecordedStep[]) {
  if (!editTarget.value) return
  editSaving.value = true
  const running = editProgress.value !== undefined
  const res = running
    ? await scriptStore.updateLiveSteps(editTarget.value.id, steps)
    : await scriptStore.updateScriptSteps(editTarget.value, steps)
  editSaving.value = false
  if (res.success) {
    ElMessage.success(running ? '步骤已热更新，当前这一步跑完即生效' : '步骤已保存，下次执行即生效')
    editDialogVisible.value = false
  } else {
    ElMessage.error(res.error || '保存失败')
  }
}

/**
 * 复制脚本：先让用户给副本命名（预填「原名 副本」），再落库。
 * 复制出来的副本执行次数归零，与原脚本互不影响。
 */
async function handleCopy(script: RecordedScript) {
  let name = ''
  try {
    const res = await ElMessageBox.prompt('给副本起个名字，建议按系列统一命名（如「日常下单 · 店铺A」）', '复制脚本', {
      inputValue: `${script.name} 副本`,
      confirmButtonText: '创建副本',
      cancelButtonText: '取消',
      inputValidator: (value: string) => (value && value.trim() ? true : '名称不能为空')
    })
    name = String(res.value ?? '').trim()
  } catch {
    return // cancelled
  }
  if (!name) return
  if (scriptStore.scripts.some(s => s.name === name)) {
    ElMessage.warning('已有同名脚本，请换一个名字')
    return
  }
  const created = await scriptStore.duplicateScript(script, name)
  if (created) ElMessage.success(`已创建副本「${created.name}」`)
  else ElMessage.error('复制失败：原脚本没有可复制的步骤')
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

scriptStore.loadScripts()
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

    <!-- 执行进度 -->
    <ExecutionProgressPanel v-if="scriptStore.isProgressing" @edit="openLiveEdit" />

    <!-- 脚本列表 -->
    <div v-if="scriptStore.scripts.length" class="script-list">
      <ScriptCard
        v-for="script in scriptStore.scripts"
        :key="script.id"
        :script="script"
        :is-progressing="scriptStore.isProgressing"
        @run="openRunDialog"
        @edit="openEditDialog"
        @data="openDataDialog"
        @monitor="openMonitorDialog"
        @copy="handleCopy"
        @remove="handleDelete"
      />
    </div>

    <el-empty v-else description="暂无脚本，请在操作录制页面录制并保存" :image-size="100" />

    <RunScriptDialog
      v-model:visible="runDialogVisible"
      :script="runTarget"
      @confirm="confirmRun"
    />

    <EditStepsDialog
      v-model:visible="editDialogVisible"
      :script="editTarget"
      :saving="editSaving"
      :live="!!editProgress"
      :active-index="editProgress?.stepIndex ?? -1"
      @save="confirmEdit"
    />

    <ScriptDataDialog
      v-model:visible="dataDialogVisible"
      :script="dataTarget"
      :saving="dataSaving"
      @save="confirmData"
    />

    <MonitorDialog
      v-model:visible="monitorDialogVisible"
      :script="monitorTarget"
      :saving="monitorSaving"
      @save="confirmMonitors"
    />
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

.script-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>

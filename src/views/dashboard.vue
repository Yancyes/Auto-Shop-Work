<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useScriptStore } from '@/stores/script'
import { ipc } from '@/api'
import StepListEditor from '@/components/StepListEditor.vue'
import SaveScriptDialog from '@/components/SaveScriptDialog.vue'
import MonitorPanel from '@/components/MonitorPanel.vue'
import EditStepsDialog from '@/components/EditStepsDialog.vue'
import ExecutionProgressPanel from '@/components/ExecutionProgressPanel.vue'
import { useWebviewRecorder } from '@/composables/useWebviewRecorder'
import { collectStepVars } from '../../shared/script-vars'
import { monitorProblems, serializeMonitors } from '../../shared/monitor-config'
import type { RecordedStep } from '../../shared/types'

const route = useRoute()
const scriptStore = useScriptStore()

// 地址栏、webview 事件与录制注入统一由 composable 管理，视图只做布局与操作入口
const {
  webviewRef, urlInput, webviewSrc, currentUrl, webviewLoaded, webviewError,
  isRecording, recordedSteps,
  navigateTo, startRecording, stopRecording, resolveTargetUrl,
  onDidFinishLoad, onDidNavigate, onDidFailLoad, onConsoleMessage
} = useWebviewRecorder()

const isPlaying = computed(() => scriptStore.isPlaying)
const stepsPanelVisible = ref(true)
const saveDialogVisible = ref(false)

/**
 * 左侧主区两种看法：监控区域（截图比对）与网页页面（内嵌浏览器）。
 * webview 必须一直挂在 DOM 里（被移出就会重新加载），所以用 v-show 切换，
 * 这就是「隐藏 webview」的实现方式，而不是把它销毁。
 */
const pane = ref<'monitor' | 'browser'>('monitor')
const monitorOptions = computed(() =>
  scriptStore.draftMonitors.map(m => ({ id: m.id, label: m.label }))
)

/** 执行中脚本的巡检结果：面板上直接显示当前实时状态，不必等命中 */
const focusedScriptId = computed(() => scriptStore.progressList[0]?.scriptId ?? -1)
const liveStatuses = computed(() => scriptStore.monitorStatuses.get(focusedScriptId.value) ?? [])

/** 执行中实时改步骤：改的是脚本本体，不是录制草稿 */
const liveEditVisible = ref(false)
const liveEditSaving = ref(false)
const liveEditId = ref<number | null>(null)
const liveEditScript = computed(() => (liveEditId.value === null ? null : scriptStore.scriptOf(liveEditId.value) ?? null))
const liveEditProgress = computed(() =>
  liveEditId.value === null ? undefined : scriptStore.progresses.get(liveEditId.value)
)

function openLiveEdit(scriptId: number) {
  if (!scriptStore.scriptOf(scriptId)) {
    ElMessage.warning('还没在脚本列表里找到这个脚本，稍等或点刷新')
    return
  }
  liveEditId.value = scriptId
  // EditStepsDialog 按传入脚本解析步骤，这里只要把目标切过去
  liveEditVisible.value = true
}

async function confirmLiveEdit(steps: RecordedStep[]) {
  const script = liveEditScript.value
  if (!script) return
  liveEditSaving.value = true
  const res = await scriptStore.updateLiveSteps(script.id, steps)
  liveEditSaving.value = false
  if (res.success) {
    ElMessage.success('步骤已热更新，当前这一步跑完即生效')
    liveEditVisible.value = false
  } else {
    ElMessage.error(res.error || '保存失败')
  }
}

/** 主窗口收成置顶迷你控制窗：只留操作按钮，可以拖到屏幕任意位置 */
async function collapseToMini() {
  const res = await ipc.invoke('window:setMode', 'mini')
  if (!res.success) ElMessage.error(res.error || '收起窗口失败')
}

async function restoreWindow() {
  await ipc.invoke('window:setMode', 'normal')
}

/** 打断正在执行的脚本（无确认，立即终止） */
async function interruptScript(scriptId: number) {
  const res = await scriptStore.terminateScript(scriptId)
  if (res.success) {
    ElMessage.success('脚本已打断')
  } else {
    ElMessage.error(res.error || '打断失败')
  }
}

/**
 * 屏幕轨录制：主进程起一个真实浏览器注入采集器，步骤实时回传。
 * 这条轨能被框选区域监控到（包括它弹出的新窗口），所以配合迷你窗使用。
 */
async function startScreenTrack() {
  // 屏幕轨由主进程起浏览器，只吃完整网址：地址栏里输的关键词得先转成搜索页，
  // 否则 goto 直接失败，开出来的是一片空白
  const raw = currentUrl.value || urlInput.value.trim()
  if (!raw) {
    ElMessage.warning('请先在地址栏输入要录制的网址')
    return
  }
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
  const res = await scriptStore.startScreenRecording(resolveTargetUrl(raw))
  if (!res.success) {
    ElMessage.error(res.error || '录制启动失败')
    return
  }
  ElMessage.success('已在独立浏览器窗口开始录制')
  // 录制时要操作的是那个真实窗口，主界面挡在中间没法框选，收成迷你窗最顺手
  try {
    await ElMessageBox.confirm(
      '要不要把主界面收成迷你控制窗？只保留「停止录制」等按钮，可拖到屏幕任意位置。',
      '开始录制',
      { type: 'info', confirmButtonText: '收成迷你窗', cancelButtonText: '保持完整窗口' }
    )
    await collapseToMini()
  } catch {
    // 用户选择保持完整窗口
  }
}

async function stopScreenTrack() {
  const res = await scriptStore.stopScreenRecording()
  if (!res.success) ElMessage.error(res.error || '停止录制失败')
  else ElMessage.info('录制已停止')
  // 从完整窗口这边停止时顺手把窗口恢复原状
  await restoreWindow()
}

function saveCurrentScript() {
  if (recordedSteps.value.length === 0) {
    ElMessage.warning('没有录制的步骤')
    return
  }
  saveDialogVisible.value = true
}

async function handleSave(payload: { name: string; url: string; description?: string }) {
  const problems = scriptStore.draftMonitors.flatMap(monitorProblems)
  if (problems.length > 0) {
    try {
      await ElMessageBox.confirm(
        `有监控区域还没配置完整：${problems[0]}。这些区域执行时不会生效，仍要保存吗？`,
        '监控区域未配置完整',
        { type: 'warning', confirmButtonText: '仍然保存', cancelButtonText: '返回补全' }
      )
    } catch {
      return
    }
  }
  const varCount = collectStepVars(recordedSteps.value).length
  const result = await scriptStore.saveScript(
    payload.name,
    payload.url,
    recordedSteps.value,
    payload.description,
    undefined,
    serializeMonitors(scriptStore.draftMonitors)
  )
  if (result) {
    // 含变量的脚本没有数据跑不起来，保存成功的下一步动作直接说清楚
    ElMessage.success(varCount > 0 ? `脚本已保存，含 ${varCount} 个变量，去「脚本管理 · 自定义数据」填数据` : '脚本已保存')
    saveDialogVisible.value = false
    scriptStore.clearSteps()
    scriptStore.draftMonitors = []
  } else {
    ElMessage.error('保存失败')
  }
}

async function playSteps() {
  if (recordedSteps.value.length === 0) {
    ElMessage.warning('请先录制操作步骤')
    return
  }
  if (!webviewRef.value) {
    ElMessage.warning('页面未加载')
    return
  }
  ElMessage.info('开始回放步骤...')
  await scriptStore.playStepsInWebview(webviewRef.value)
  ElMessage.success('回放完成')
}

function stopPlaying() {
  scriptStore.stopPlaying()
}

async function clearAllSteps() {
  if (isPlaying.value) return
  try {
    await ElMessageBox.confirm('确定清空所有录制的步骤？', '确认', { type: 'warning' })
    scriptStore.clearSteps()
  } catch {
    // cancelled
  }
}

/** 本页常驻不销毁（webview 一被移出 DOM 就会重新加载），所以用路由变化来收尾录制与预览回放 */
watch(
  () => route.path,
  (path) => {
    if (path === '/dashboard') return
    if (isRecording.value) scriptStore.stopRecording()
    if (scriptStore.isScreenRecording) scriptStore.stopScreenRecording()
    if (isPlaying.value) scriptStore.stopPlaying()
  }
)
</script>

<template>
  <div class="dashboard">
    <!-- 地址栏与工作区切换 -->
    <div class="url-bar card">
      <el-input
        v-model="urlInput"
        placeholder="输入网址或搜索内容，回车前往"
        size="large"
        clearable
        @keyup.enter="navigateTo"
      >
        <template #prefix>
          <el-icon><Link /></el-icon>
        </template>
      </el-input>
      <el-button type="primary" size="large" @click="navigateTo" :loading="!webviewLoaded && !webviewError">
        前往
      </el-button>

      <div class="url-actions">
        <template v-if="!isRecording && !scriptStore.isScreenRecording">
          <el-button type="danger" size="large" plain :disabled="!webviewLoaded" @click="startRecording">
            <el-icon><VideoCamera /></el-icon>
            页面录制
          </el-button>
          <el-button type="danger" size="large" plain @click="startScreenTrack">
            <el-icon><Monitor /></el-icon>
            屏幕录制
          </el-button>
        </template>
        <template v-else>
          <el-button type="danger" size="large" @click="isRecording ? stopRecording() : stopScreenTrack()">
            <el-icon><VideoPause /></el-icon>
            停止录制
          </el-button>
          <span class="recording-indicator">
            <span class="rec-dot"></span>
            {{ isRecording ? '页面录制中' : '屏幕录制中' }}
          </span>
        </template>
        <el-button size="large" plain @click="collapseToMini" title="只保留操作按钮，可拖到屏幕任意位置">
          <el-icon><Fold /></el-icon>
          收起
        </el-button>
      </div>
    </div>

    <!-- 执行中的实时控制：暂停/跳过/回退/接管都在这里 -->
    <ExecutionProgressPanel
      v-if="scriptStore.isProgressing"
      class="mt-16"
      @edit="openLiveEdit"
    />

    <!-- 主工作区 -->
    <div class="workspace mt-16">
      <div class="left-area">
        <div class="pane-switch">
          <el-radio-group v-model="pane" size="small">
            <el-radio-button value="monitor">
              <el-icon><View /></el-icon>
              监控区域
            </el-radio-button>
            <el-radio-button value="browser">
              <el-icon><Link /></el-icon>
              网页页面
            </el-radio-button>
          </el-radio-group>
          <span class="switch-tip">
            {{ pane === 'monitor'
              ? '框选屏幕区域或上传一张截图当基准，执行时按这块画面的变化判断数据是否动了'
              : '内嵌页面用于录制操作；切到这里不会重新加载页面' }}
          </span>
        </div>

        <!-- 监控面板：原来放浏览器的位置 -->
        <div v-show="pane === 'monitor'" class="monitor-section">
          <MonitorPanel v-model="scriptStore.draftMonitors" :statuses="liveStatuses" />
        </div>

        <!-- Webview 常驻 DOM，只切换显示 -->
        <div
          v-show="pane === 'browser'"
          class="webview-section"
          :class="{ 'is-recording': isRecording }"
        >
          <div class="webview-container">
            <webview
              ref="webviewRef"
              :src="webviewSrc"
              style="width:100%;height:100%;border:none;"
              partition="persist:recording"
              allowpopups
              @did-finish-load="onDidFinishLoad"
              @did-navigate="onDidNavigate"
              @did-fail-load="onDidFailLoad"
              @console-message="onConsoleMessage"
            />
            <div v-if="webviewError" class="webview-error">
              <el-icon><WarningFilled /></el-icon>
              {{ webviewError }}
            </div>
            <!-- 脚本执行中：并发时每个脚本一条徽章，可分别打断 -->
            <div v-if="scriptStore.isProgressing" class="script-running-stack">
              <div
                v-for="progress in scriptStore.progressList"
                :key="progress.scriptId"
                class="script-running-badge"
              >
                <el-icon class="is-loading" v-if="!progress.paused"><Loading /></el-icon>
                <el-icon v-else><VideoPause /></el-icon>
                <span class="badge-text">
                  {{ progress.takeover ? '等待接管' : progress.paused ? '已暂停' : '执行中' }}
                  · 步骤 {{ Math.max(progress.stepIndex + 1, 0) }}/{{ progress.totalSteps }}
                </span>
                <el-button
                  type="danger"
                  size="small"
                  circle
                  @click="interruptScript(progress.scriptId)"
                  title="打断脚本执行"
                >
                  <el-icon><Close /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：步骤面板 -->
      <div class="steps-panel" v-show="stepsPanelVisible">
        <div class="panel-header">
          <span class="panel-title">
            <el-icon><List /></el-icon>
            操作步骤
            <el-tag v-if="recordedSteps.length" size="small" round>{{ recordedSteps.length }}</el-tag>
          </span>
          <div class="panel-actions">
            <el-button
              v-if="!isRecording && !scriptStore.isScreenRecording && !isPlaying && recordedSteps.length > 0"
              type="success"
              size="small"
              @click="playSteps"
            >
              <el-icon><VideoPlay /></el-icon>
              回放
            </el-button>
            <el-button
              v-if="isPlaying"
              type="warning"
              size="small"
              @click="stopPlaying"
            >
              <el-icon><VideoPause /></el-icon>
              停止
            </el-button>
          </div>
        </div>

        <!-- 步骤列表（编辑/排序/删除逻辑见 StepListEditor） -->
        <StepListEditor
          v-model="scriptStore.recordedSteps"
          :locked="isRecording || scriptStore.isScreenRecording || isPlaying"
          :allow-remove="isRecording && !isPlaying"
          :active-index="isPlaying ? scriptStore.playingStepIndex : -1"
          :monitors="monitorOptions"
          :empty-text="isRecording || scriptStore.isScreenRecording
            ? '在页面上操作以录制步骤'
            : '点击「页面录制」或「屏幕录制」后操作页面，或点击下方「添加步骤」手动新建'"
        />

        <!-- 底部操作 -->
        <div v-if="recordedSteps.length > 0 && !isRecording && !scriptStore.isScreenRecording" class="panel-footer">
          <el-button type="primary" @click="saveCurrentScript" style="width: 100%">
            <el-icon><Check /></el-icon>
            保存为脚本
          </el-button>
          <el-button text type="danger" size="small" @click="clearAllSteps" style="width: 100%; margin-top: 8px; margin-left: 0">
            清空步骤
          </el-button>
        </div>
      </div>
    </div>

    <!-- 保存脚本弹窗 -->
    <SaveScriptDialog
      v-model:visible="saveDialogVisible"
      :step-count="recordedSteps.length"
      :default-url="scriptStore.targetUrl || currentUrl"
      @save="handleSave"
    />

    <!-- 执行中实时改步骤：当前这一步跑完就按新列表继续 -->
    <EditStepsDialog
      v-model:visible="liveEditVisible"
      :script="liveEditScript"
      :saving="liveEditSaving"
      live
      :active-index="liveEditProgress?.stepIndex ?? -1"
      @save="confirmLiveEdit"
    />
  </div>
</template>

<style scoped lang="scss">
.dashboard {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.url-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;

  .el-input {
    flex: 1;
  }

  .url-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-left: 8px;
  }
}

.recording-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #f56c6c;
  font-size: 13px;
  font-weight: 600;

  .rec-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #f56c6c;
    animation: pulse 1.2s ease-in-out infinite;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
}

.workspace {
  flex: 1;
  display: flex;
  gap: 16px;
  min-height: 0;
}

.left-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pane-switch {
  display: flex;
  align-items: center;
  gap: 12px;

  .switch-tip {
    font-size: 12px;
    color: #909399;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.monitor-section {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #f5f7fa;
  border-radius: 10px;
}

.webview-section {
  flex: 1;
  min-height: 0;
  border-radius: 10px;
  overflow: hidden;
  border: 3px solid transparent;
  transition: border-color 0.3s;

  &.is-recording {
    border-color: #f56c6c;
    border-style: dashed;
    animation: recordBorder 2s ease-in-out infinite;
  }
}

@keyframes recordBorder {
  0%, 100% { border-color: #f56c6c; }
  50% { border-color: #f9a8a8; }
}

.webview-container {
  width: 100%;
  height: 100%;
  position: relative;
  background: #f5f7fa;
  border-radius: 8px;
  overflow: hidden;

  .script-running-stack {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    z-index: 10;
  }

  .script-running-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(245, 108, 108, 0.92);
    color: #fff;
    border-radius: 18px;
    box-shadow: 0 2px 8px rgba(245, 108, 108, 0.4);
    font-size: 13px;
    font-weight: 500;
    backdrop-filter: blur(4px);

    .badge-text {
      white-space: nowrap;
    }

    .el-button.is-circle {
      width: 24px;
      height: 24px;
      padding: 0;
    }
  }
}

.webview-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 8px;
  color: #f56c6c;
  font-size: 14px;
  background: #fef0f0;
  padding: 12px 20px;
  border-radius: 8px;
}

.steps-panel {
  width: 340px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #f0f0f0;

  .panel-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 15px;
    font-weight: 600;
    color: #303133;
  }

  .panel-actions {
    display: flex;
    gap: 6px;
  }
}

.panel-footer {
  padding: 12px 16px;
  border-top: 1px solid #f0f0f0;
}
</style>

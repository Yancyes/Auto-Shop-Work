<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useScriptStore } from '@/stores/script'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { RecordedStep } from '../../shared/types'
import StepListEditor from '@/components/StepListEditor.vue'
import SaveScriptDialog from '@/components/SaveScriptDialog.vue'
import { useWebviewRecorder } from '@/composables/useWebviewRecorder'

const scriptStore = useScriptStore()

// 地址栏、webview 事件与录制注入统一由 composable 管理，视图只做布局与操作入口
const {
  webviewRef, urlInput, webviewSrc, currentUrl, webviewLoaded, webviewError,
  isRecording, recordedSteps,
  navigateTo, startRecording, stopRecording,
  onDidFinishLoad, onDidNavigate, onDidFailLoad, onConsoleMessage
} = useWebviewRecorder()

const isPlaying = computed(() => scriptStore.isPlaying)
const stepsPanelVisible = ref(true)
const saveDialogVisible = ref(false)


/** 打断正在执行的脚本（无确认，立即终止） */
async function interruptScript(scriptId: number) {
  const res = await scriptStore.terminateScript(scriptId)
  if (res.success) {
    ElMessage.success('脚本已打断')
  } else {
    ElMessage.error(res.error || '打断失败')
  }
}

function saveCurrentScript() {
  if (recordedSteps.value.length === 0) {
    ElMessage.warning('没有录制的步骤')
    return
  }
  saveDialogVisible.value = true
}

/** 录制期间 delayBefore 存的是绝对时间戳，保存时换算成「与上一步的间隔」 */
function toStepDelays(source: typeof recordedSteps.value): RecordedStep[] {
  return source.map((s, i) => {
    const prev = i > 0 ? source[i - 1] : null
    const delay = prev && s.delayBefore && prev.delayBefore ? s.delayBefore - prev.delayBefore : 300
    return { ...s, delayBefore: Math.min(Math.max(delay, 100), 10000) }
  }) as RecordedStep[]
}

async function handleSave(payload: { name: string; url: string; description?: string }) {
  const result = await scriptStore.saveScript(
    payload.name,
    payload.url,
    toStepDelays(recordedSteps.value),
    payload.description
  )
  if (result) {
    ElMessage.success('脚本已保存')
    saveDialogVisible.value = false
    scriptStore.clearSteps()
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

onUnmounted(() => {
  if (isRecording.value) {
    scriptStore.stopRecording()
  }
  if (isPlaying.value) {
    scriptStore.stopPlaying()
  }
})
</script>

<template>
  <div class="dashboard">
    <!-- 地址栏 -->
    <div class="url-bar card">
      <el-input
        v-model="urlInput"
        placeholder="输入网址，如 https://www.example.com"
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
        <el-button
          v-if="!isRecording"
          type="danger"
          size="large"
          plain
          @click="startRecording"
          :disabled="!webviewLoaded"
        >
          <el-icon><VideoCamera /></el-icon>
          开始录制
        </el-button>
        <template v-else>
          <el-button type="danger" size="large" @click="stopRecording">
            <el-icon><VideoPause /></el-icon>
            停止录制
          </el-button>
          <span class="recording-indicator">
            <span class="rec-dot"></span>
            录制中
          </span>
        </template>
      </div>
    </div>

    <!-- 主工作区 -->
    <div class="workspace mt-16">
      <!-- 左侧：Webview -->
      <div class="webview-section" :class="{ 'is-recording': isRecording }">
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
                {{ progress.paused ? '已暂停' : '执行中' }}
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
              v-if="!isRecording && !isPlaying && recordedSteps.length > 0"
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
          :locked="isRecording || isPlaying"
          :allow-remove="isRecording && !isPlaying"
          :active-index="isPlaying ? scriptStore.playingStepIndex : -1"
          :empty-text="isRecording
            ? '在左侧页面上操作以录制步骤'
            : '点击「开始录制」后操作页面，或点击下方「添加步骤」手动新建'"
        />

        <!-- 底部操作 -->
        <div v-if="recordedSteps.length > 0 && !isRecording" class="panel-footer">
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

.webview-section {
  flex: 1;
  min-width: 0;
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

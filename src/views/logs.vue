<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useLogStore } from '@/stores/log'
import { useUpdaterStore } from '@/stores/updater'
import { screenshotUrl, LOG_LEVEL_TAG } from '@/utils'
import type { LogLevel } from '../../shared/types'

const logStore = useLogStore()
const updaterStore = useUpdaterStore()
const activeTab = ref('logs')

function handleCheckUpdate() {
  updaterStore.check()
}

// 日志筛选
const logFilter = ref<{
  level: LogLevel | ''
  taskId: number | ''
}>({
  level: '',
  taskId: ''
})

const filteredLogs = computed(() => {
  return logStore.logs.filter(log => {
    if (logFilter.value.level && log.level !== logFilter.value.level) return false
    if (logFilter.value.taskId && log.taskId !== Number(logFilter.value.taskId)) return false
    return true
  })
})

async function refreshLogs() {
  await logStore.loadLogs()
}

async function handleDeleteLog(log: any, e: Event) {
  e.stopPropagation()
  const res = await logStore.deleteLog(log.id)
  if (res.success) {
    ElMessage.success('日志已删除')
  } else {
    ElMessage.error('删除失败')
  }
}

async function handleClearLogs() {
  try {
    await ElMessageBox.confirm('确定要清空所有日志吗？此操作不可恢复。', '清空日志', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    const res = await logStore.clearLogs()
    if (res.success) {
      ElMessage.success('日志已清空')
      logStore.currentScreenshot = null
    } else {
      ElMessage.error('清空失败')
    }
  } catch {
    // cancelled
  }
}

function selectLog(log: any) {
  logStore.currentScreenshot = log.screenshotPath
}

// 设置表单
const settingsForm = ref({
  browser: {
    headless: false,
    viewport: { width: 1440, height: 900 },
    timeout: 30000
  },
  antiDetection: {
    enabled: true,
    typingDelay: true,
    mouseTrace: true,
    randomDelay: true
  },
  notification: {
    soundEnabled: true,
    manualIntervention: true,
    taskComplete: true
  },
  storage: {
    screenshotDir: '',
    logDir: ''
  },
  task: {
    maxConcurrency: 2,
    taskInterval: 5,
    retryCount: 3
  }
})

async function saveSettings() {
  const res = await logStore.saveSettings(settingsForm.value)
  if (res.success) {
    ElMessage.success('设置已保存')
  } else {
    ElMessage.error(res.error || '保存失败')
  }
}

onMounted(async () => {
  try {
    await logStore.loadLogs()
    await logStore.loadSettings()
    if (logStore.settings) {
      settingsForm.value = JSON.parse(JSON.stringify(logStore.settings))
    }
  } catch (e) {
    console.warn('日志页面初始化失败:', e)
  }
})
</script>

<template>
  <div class="logs-page">
    <el-tabs v-model="activeTab" class="page-tabs">
      <!-- 运行日志 -->
      <el-tab-pane label="运行日志" name="logs">
        <div class="logs-layout">
          <!-- 左侧日志列表 -->
          <div class="logs-list">
            <div class="log-filter">
              <el-select v-model="logFilter.level" placeholder="日志级别" clearable size="small" style="width: 100px">
                <el-option label="Info" value="info" />
                <el-option label="Warn" value="warn" />
                <el-option label="Error" value="error" />
                <el-option label="Debug" value="debug" />
              </el-select>
              <el-input v-model="logFilter.taskId" placeholder="任务ID" size="small" style="width: 100px" />
              <el-button size="small" @click="refreshLogs">
                <el-icon><Refresh /></el-icon>
              </el-button>
              <div class="log-filter-spacer" />
              <el-button size="small" type="danger" plain :disabled="!filteredLogs.length" @click="handleClearLogs">
                <el-icon><Delete /></el-icon>
                <span>清空日志</span>
              </el-button>
            </div>
            <div class="log-items">
              <div
                v-for="log in filteredLogs"
                :key="log.id"
                class="log-item"
                :class="`log-${log.level}`"
                @click="selectLog(log)"
              >
                <el-tag :type="LOG_LEVEL_TAG[log.level]" size="small" effect="dark">{{ log.level.toUpperCase() }}</el-tag>
                <span class="log-time">{{ log.createdAt }}</span>
                <span class="log-task" v-if="log.taskId">[{{ log.taskId }}]</span>
                <span class="log-msg">{{ log.message }}</span>
                <el-icon v-if="log.screenshotPath" class="log-screenshot-icon"><Picture /></el-icon>
                <el-icon class="log-delete-btn" @click="handleDeleteLog(log, $event)"><Close /></el-icon>
              </div>
              <el-empty v-if="!filteredLogs.length" description="暂无日志" :image-size="60" />
            </div>
          </div>

          <!-- 右侧截图预览 -->
          <div class="screenshot-preview">
            <div class="preview-header">
              <span>截图预览</span>
            </div>
            <div class="preview-body">
              <img v-if="logStore.currentScreenshot" :src="screenshotUrl(logStore.currentScreenshot)" class="screenshot-img" />
              <el-empty v-else description="点击带截图图标的日志查看截图" :image-size="80" />
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- 系统设置 -->
      <el-tab-pane label="系统设置" name="settings">
        <div class="settings-form">
          <!-- 浏览器设置 -->
          <div class="settings-section">
            <div class="settings-title">
              <el-icon><Monitor /></el-icon><span>浏览器设置</span>
            </div>
            <el-form :model="settingsForm.browser" label-width="140px">
              <el-form-item label="无头模式">
                <el-switch v-model="settingsForm.browser.headless" />
                <span class="form-hint">关闭后浏览器窗口可见</span>
              </el-form-item>
              <el-form-item label="视口宽度">
                <el-input-number v-model="settingsForm.browser.viewport.width" :min="1024" :max="2560" />
              </el-form-item>
              <el-form-item label="视口高度">
                <el-input-number v-model="settingsForm.browser.viewport.height" :min="720" :max="1440" />
              </el-form-item>
              <el-form-item label="超时时间(ms)">
                <el-input-number v-model="settingsForm.browser.timeout" :min="5000" :max="60000" :step="1000" />
              </el-form-item>
            </el-form>
          </div>

          <!-- 反检测设置 -->
          <div class="settings-section">
            <div class="settings-title">
              <el-icon><Hide /></el-icon><span>反检测设置</span>
            </div>
            <el-form :model="settingsForm.antiDetection" label-width="140px">
              <el-form-item label="启用反检测">
                <el-switch v-model="settingsForm.antiDetection.enabled" />
              </el-form-item>
              <el-form-item label="逐字输入">
                <el-switch v-model="settingsForm.antiDetection.typingDelay" />
              </el-form-item>
              <el-form-item label="鼠标轨迹模拟">
                <el-switch v-model="settingsForm.antiDetection.mouseTrace" />
              </el-form-item>
              <el-form-item label="随机延迟">
                <el-switch v-model="settingsForm.antiDetection.randomDelay" />
              </el-form-item>
            </el-form>
          </div>

          <!-- 任务设置 -->
          <div class="settings-section">
            <div class="settings-title">
              <el-icon><List /></el-icon><span>任务设置</span>
            </div>
            <el-form :model="settingsForm.task" label-width="140px">
              <el-form-item label="最大并发数">
                <el-input-number v-model="settingsForm.task.maxConcurrency" :min="1" :max="5" />
              </el-form-item>
              <el-form-item label="任务间隔(秒)">
                <el-input-number v-model="settingsForm.task.taskInterval" :min="0" :max="60" />
              </el-form-item>
              <el-form-item label="重试次数">
                <el-input-number v-model="settingsForm.task.retryCount" :min="0" :max="10" />
              </el-form-item>
            </el-form>
          </div>

          <!-- 通知设置 -->
          <div class="settings-section">
            <div class="settings-title">
              <el-icon><Bell /></el-icon><span>通知设置</span>
            </div>
            <el-form :model="settingsForm.notification" label-width="140px">
              <el-form-item label="声音提醒">
                <el-switch v-model="settingsForm.notification.soundEnabled" />
              </el-form-item>
              <el-form-item label="人工介入提醒">
                <el-switch v-model="settingsForm.notification.manualIntervention" />
              </el-form-item>
              <el-form-item label="任务完成提醒">
                <el-switch v-model="settingsForm.notification.taskComplete" />
              </el-form-item>
            </el-form>
          </div>

          <!-- 版本与更新 -->
          <div class="settings-section">
            <div class="settings-title">
              <el-icon><Refresh /></el-icon><span>版本与更新</span>
            </div>
            <el-form label-width="140px">
              <el-form-item label="当前版本">
                <span class="version-text">v{{ updaterStore.currentVersion || '--' }}</span>
              </el-form-item>
              <el-form-item label="检查更新">
                <el-button type="primary" @click="handleCheckUpdate">
                  <el-icon><Refresh /></el-icon>
                  <span>检查更新</span>
                </el-button>
              </el-form-item>
            </el-form>
          </div>

          <!-- 存储路径设置 -->
          <div class="settings-section">
            <div class="settings-title">
              <el-icon><FolderOpened /></el-icon><span>存储路径设置</span>
            </div>
            <el-form :model="settingsForm.storage" label-width="140px">
              <el-form-item label="截图目录">
                <el-input v-model="settingsForm.storage.screenshotDir" />
              </el-form-item>
              <el-form-item label="日志目录">
                <el-input v-model="settingsForm.storage.logDir" />
              </el-form-item>
            </el-form>
          </div>

          <div class="settings-actions">
            <el-button type="primary" size="large" @click="saveSettings">
              <el-icon><Check /></el-icon> 保存设置
            </el-button>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped lang="scss">
.logs-page { height: 100%; }

.page-tabs {
  height: 100%;
  background: #fff;
  border-radius: 8px;
  padding: 0 20px 20px;

  :deep(.el-tabs__content) { height: calc(100% - 50px); overflow: hidden; }
  :deep(.el-tab-pane) { height: 100%; }
}

.logs-layout {
  display: flex;
  gap: 16px;
  height: 100%;
}

.logs-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.log-filter {
  display: flex;
  gap: 8px;
  padding: 8px 0;
  align-items: center;
}

.log-filter-spacer {
  flex: 1;
}

.log-items {
  flex: 1;
  overflow-y: auto;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}

.log-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #f5f5f5;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s;

  &:hover { background: #f5f7fa; }

  &.log-error { background: #fef0f0; }
  &.log-warn { background: #fdf6ec; }

  .log-time { color: #c0c4cc; font-family: monospace; white-space: nowrap; }
  .log-task { color: #409eff; font-weight: 600; }
  .log-msg { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .log-screenshot-icon { color: #409eff; flex-shrink: 0; }
  .log-delete-btn {
    color: #c0c4cc;
    flex-shrink: 0;
    cursor: pointer;
    opacity: 0;
    transition: all 0.15s;
    &:hover { color: #f56c6c; }
  }

  &:hover .log-delete-btn { opacity: 1; }
}

.screenshot-preview {
  width: 400px;
  display: flex;
  flex-direction: column;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  overflow: hidden;

  .preview-header {
    padding: 10px 12px;
    background: #f5f7fa;
    font-weight: 600;
    font-size: 14px;
  }

  .preview-body {
    flex: 1;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
  }

  .screenshot-img { width: 100%; border-radius: 4px; }
}

.settings-form { max-width: 700px; padding: 20px 0; height: 100%; overflow-y: auto; }

.settings-section {
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid #f0f0f0;

  &:last-child { border-bottom: none; }
}

.settings-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
}

.form-hint { margin-left: 12px; color: #909399; font-size: 12px; }

.version-text {
  font-weight: 600;
  color: #667eea;
  font-size: 14px;
}

.settings-actions {
  text-align: center;
  padding-top: 12px;
}
</style>

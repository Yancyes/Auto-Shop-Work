<script setup lang="ts">
import { useUpdaterStore } from '@/stores/updater'

const updaterStore = useUpdaterStore()

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function handleDownload() {
  updaterStore.download()
}

function handleInstall() {
  updaterStore.install()
}

function handleRetry() {
  updaterStore.check()
}
</script>

<template>
  <el-dialog
    v-model="updaterStore.dialogVisible"
    title=""
    width="460px"
    :close-on-click-modal="false"
    :show-close="!updaterStore.isDownloading"
    class="update-dialog"
  >
    <div class="update-content">
      <!-- 检查中 -->
      <div v-if="updaterStore.status === 'checking'" class="update-state">
        <div class="state-icon checking">
          <el-icon class="is-loading" size="32"><Loading /></el-icon>
        </div>
        <h3>正在检查更新</h3>
        <p class="state-desc">正在连接更新服务器...</p>
      </div>

      <!-- 发现新版本 -->
      <div v-else-if="updaterStore.status === 'available'" class="update-state">
        <div class="state-icon available">
          <el-icon size="36"><Promotion /></el-icon>
        </div>
        <h3>发现新版本</h3>
        <div class="version-info">
          <span class="current">v{{ updaterStore.currentVersion }}</span>
          <el-icon size="14"><ArrowRight /></el-icon>
          <span class="new">v{{ updaterStore.availableVersion }}</span>
        </div>
        <div v-if="updaterStore.releaseNotes" class="release-notes">
          <div class="notes-title">更新内容</div>
          <div class="notes-body">{{ updaterStore.releaseNotes }}</div>
        </div>
      </div>

      <!-- 下载中 -->
      <div v-else-if="updaterStore.status === 'downloading'" class="update-state downloading-state">
        <el-progress
          type="circle"
          :percentage="Math.round(updaterStore.downloadPercent)"
          :width="100"
          :stroke-width="8"
          color="#667eea"
        />
        <h3>正在下载 v{{ updaterStore.availableVersion }}</h3>
        <div class="progress-bar-wrapper">
          <el-progress
            :percentage="Math.round(updaterStore.downloadPercent)"
            :stroke-width="6"
            :show-text="false"
            color="#667eea"
          />
        </div>
        <div class="download-detail">
          <span>{{ formatBytes(updaterStore.progress?.transferred ?? 0) }} / {{ formatBytes(updaterStore.progress?.total ?? 0) }}</span>
          <span v-if="updaterStore.progress?.bytesPerSecond" class="speed">
            {{ formatBytes(updaterStore.progress.bytesPerSecond) }}/s
          </span>
        </div>
      </div>

      <!-- 下载完成 -->
      <div v-else-if="updaterStore.status === 'downloaded'" class="update-state">
        <div class="state-icon downloaded">
          <el-icon size="36"><CircleCheck /></el-icon>
        </div>
        <h3>下载完成</h3>
        <p class="state-desc">新版本 v{{ updaterStore.availableVersion }} 已准备就绪</p>
      </div>

      <!-- 已是最新 -->
      <div v-else-if="updaterStore.status === 'not-available'" class="update-state">
        <div class="state-icon latest">
          <el-icon size="36"><CircleCheck /></el-icon>
        </div>
        <h3>已是最新版本</h3>
        <p class="state-desc">当前版本 v{{ updaterStore.currentVersion }} 已是最新</p>
      </div>

      <!-- 错误 -->
      <div v-else-if="updaterStore.status === 'error'" class="update-state">
        <div class="state-icon error">
          <el-icon size="36"><WarningFilled /></el-icon>
        </div>
        <h3>检查更新失败</h3>
        <p class="state-desc error-text">{{ updaterStore.error }}</p>
      </div>
    </div>

    <template #footer>
      <template v-if="updaterStore.status === 'available'">
        <el-button @click="updaterStore.dialogVisible = false">稍后再说</el-button>
        <el-button type="primary" class="btn-primary" @click="handleDownload">立即更新</el-button>
      </template>

      <template v-else-if="updaterStore.status === 'downloaded'">
        <el-button @click="updaterStore.dialogVisible = false">稍后</el-button>
        <el-button type="primary" class="btn-primary" @click="handleInstall">重启并安装</el-button>
      </template>

      <template v-else-if="updaterStore.status === 'not-available'">
        <el-button type="primary" class="btn-primary" @click="updaterStore.dialogVisible = false">知道了</el-button>
      </template>

      <template v-else-if="updaterStore.status === 'error'">
        <el-button @click="updaterStore.dialogVisible = false">关闭</el-button>
        <el-button type="primary" class="btn-primary" @click="handleRetry">重试</el-button>
      </template>

      <template v-else-if="updaterStore.status === 'downloading'">
        <el-button disabled type="info">下载中 {{ Math.round(updaterStore.downloadPercent) }}%</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
:deep(.el-dialog) {
  border-radius: 16px;
  overflow: hidden;

  .el-dialog__header {
    display: none;
  }

  .el-dialog__body {
    padding: 0;
  }

  .el-dialog__footer {
    padding: 0 24px 24px;
  }
}

.update-content {
  min-height: 200px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 32px 24px 24px;
  background: linear-gradient(135deg, #f5f7fa 0%, #e8eaed 100%);
}

.update-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #1a1a1a;
  }

  .state-desc {
    margin: 0;
    font-size: 13px;
    color: #909399;

    &.error-text {
      color: #f56c6c;
      word-break: break-all;
      max-width: 360px;
    }
  }
}

.state-icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;

  &.checking {
    background: rgba(64, 158, 255, 0.1);
    color: #409eff;
  }

  &.available {
    background: linear-gradient(135deg, #ff6b35 0%, #ff8f5e 100%);
    color: #fff;
    box-shadow: 0 8px 24px rgba(255, 107, 53, 0.3);
  }

  &.downloaded,
  &.latest {
    background: rgba(103, 194, 58, 0.1);
    color: #67c23a;
  }

  &.error {
    background: rgba(245, 108, 108, 0.1);
    color: #f56c6c;
  }
}

.downloading-state {
  gap: 16px;
}

.progress-bar-wrapper {
  width: 100%;
  max-width: 320px;

  :deep(.el-progress-bar__outer) {
    border-radius: 4px;
  }

  :deep(.el-progress-bar__inner) {
    border-radius: 4px;
  }
}

.version-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;

  .current {
    color: #909399;
  }

  .new {
    color: #ff6b35;
    font-weight: 600;
  }
}

.release-notes {
  margin-top: 8px;
  width: 100%;
  max-width: 380px;
  background: #fff;
  border-radius: 10px;
  padding: 12px 16px;
  text-align: left;

  .notes-title {
    font-size: 12px;
    font-weight: 600;
    color: #606266;
    margin-bottom: 6px;
  }

  .notes-body {
    font-size: 13px;
    color: #303133;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 160px;
    overflow-y: auto;
  }
}

.download-detail {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #909399;

  .speed {
    color: #667eea;
    font-weight: 500;
  }
}
</style>

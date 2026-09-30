<script setup lang="ts">
import { useUpdaterStore } from '@/stores/updater'
import { formatDate } from '@/utils'

const updaterStore = useUpdaterStore()

const emit = defineEmits<{ showVersionInfo: [] }>()

/** 字节数格式化 */
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
    width="480px"
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
        <div v-if="updaterStore.releaseDate" class="release-date">
          <el-icon size="12"><Calendar /></el-icon>
          <span>{{ formatDate(updaterStore.releaseDate) }}</span>
        </div>
        <div v-if="updaterStore.releaseNotes" class="release-notes">
          <div class="notes-title">更新内容</div>
          <div class="notes-body">{{ updaterStore.releaseNotes }}</div>
        </div>
      </div>

      <!-- 下载中 -->
      <div v-else-if="updaterStore.status === 'downloading'" class="update-state">
        <div class="state-icon downloading">
          <div class="download-ring">
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#e8eaed" stroke-width="8" />
              <circle
                cx="50" cy="50" r="42"
                fill="none"
                stroke="url(#gradient)"
                stroke-width="8"
                stroke-linecap="round"
                :stroke-dasharray="264"
                :stroke-dashoffset="264 - (264 * updaterStore.downloadPercent) / 100"
                transform="rotate(-90 50 50)"
              />
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#667eea" />
                  <stop offset="100%" stop-color="#764ba2" />
                </linearGradient>
              </defs>
            </svg>
            <span class="percent-text">{{ Math.round(updaterStore.downloadPercent) }}%</span>
          </div>
        </div>
        <h3>正在下载 v{{ updaterStore.availableVersion }}</h3>
        <div class="download-detail">
          <span>{{ formatBytes(updaterStore.progress?.transferred ?? 0) }}</span>
          <span>/</span>
          <span>{{ formatBytes(updaterStore.progress?.total ?? 0) }}</span>
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
        <p class="state-desc sub">重启应用后将自动完成安装</p>
      </div>

      <!-- 已是最新 -->
      <div v-else-if="updaterStore.status === 'not-available'" class="update-state">
        <div class="state-icon latest">
          <el-icon size="36"><CircleCheck /></el-icon>
        </div>
        <h3>已是最新版本</h3>
        <p class="state-desc">当前版本 v{{ updaterStore.currentVersion }} 已是最新</p>
        <button class="view-changelog" @click="emit('showVersionInfo')">查看当前版本更新内容</button>
      </div>

      <!-- 错误 -->
      <div v-else-if="updaterStore.status === 'error'" class="update-state">
        <div class="state-icon error">
          <el-icon size="36"><WarningFilled /></el-icon>
        </div>
        <h3>检查更新失败</h3>
        <p class="state-desc error-text">{{ updaterStore.error }}</p>
      </div>

      <!-- 默认/空闲 -->
      <div v-else class="update-state">
        <div class="state-icon idle">
          <el-icon size="36"><InfoFilled /></el-icon>
        </div>
        <h3>当前版本 v{{ updaterStore.currentVersion }}</h3>
      </div>
    </div>

    <template #footer>
      <template v-if="updaterStore.status === 'checking'"></template>

      <template v-else-if="updaterStore.status === 'available'">
        <el-button @click="updaterStore.dialogVisible = false">稍后再说</el-button>
        <el-button type="primary" class="btn-primary" @click="handleDownload">立即更新</el-button>
      </template>

      <template v-else-if="updaterStore.status === 'downloading'">
        <el-button disabled>下载中...</el-button>
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

      <template v-else>
        <el-button type="primary" class="btn-primary" @click="updaterStore.dialogVisible = false">关闭</el-button>
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

    &.sub {
      font-size: 12px;
      color: #b0b3b8;
    }

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

  &.downloading {
    background: transparent;
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

  &.idle {
    background: rgba(144, 147, 153, 0.1);
    color: #909399;
  }
}

.download-ring {
  position: relative;
  width: 72px;
  height: 72px;

  svg {
    width: 100%;
    height: 100%;
  }

  .percent-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 16px;
    font-weight: 700;
    color: #667eea;
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

.release-date {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #b0b3b8;
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
  gap: 4px;
  font-size: 12px;
  color: #909399;

  .speed {
    margin-left: 4px;
    color: #667eea;
    font-weight: 500;
  }
}

.view-changelog {
  background: none;
  border: none;
  color: #667eea;
  font-size: 13px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.15s;

  &:hover {
    background: rgba(102, 126, 234, 0.08);
    color: #764ba2;
  }
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;

  &:hover {
    opacity: 0.9;
  }
}
</style>

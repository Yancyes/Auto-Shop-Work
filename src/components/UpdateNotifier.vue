<script setup lang="ts">
import { useUpdaterStore } from '@/stores/updater'

const updaterStore = useUpdaterStore()

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function handleInstall() {
  updaterStore.install()
}

function handleRetry() {
  updaterStore.dialogVisible = false
  updaterStore.check()
}
</script>

<template>
  <!-- 顶部更新横幅 -->
  <Transition name="banner-slide">
    <div v-if="updaterStore.bannerVisible && (updaterStore.isDownloading || updaterStore.isDownloaded)" class="update-banner">
      <template v-if="updaterStore.isDownloading">
        <div class="banner-progress-bg" :style="{ width: updaterStore.downloadPercent + '%' }" />
        <div class="banner-inner">
          <div class="banner-left">
            <el-icon class="is-loading" size="16"><Loading /></el-icon>
            <span class="banner-text">
              新版本 v{{ updaterStore.availableVersion }} 下载中
              <span class="banner-detail">
                {{ Math.round(updaterStore.downloadPercent) }}%
                · {{ formatBytes(updaterStore.progress?.bytesPerSecond ?? 0) }}/s
              </span>
            </span>
          </div>
          <el-button size="small" text class="banner-close" @click="updaterStore.dismissBanner">
            <el-icon size="14"><Close /></el-icon>
          </el-button>
        </div>
      </template>

      <template v-else-if="updaterStore.isDownloaded">
        <div class="banner-inner banner-done" @click="handleInstall">
          <div class="banner-left">
            <el-icon size="16" color="#fff"><CircleCheck /></el-icon>
            <span class="banner-text">
              v{{ updaterStore.availableVersion }} 已准备就绪
              <span class="banner-link">点击重启更新</span>
            </span>
          </div>
          <el-button size="small" text class="banner-close" @click.stop="updaterStore.dismissBanner">
            <el-icon size="14"><Close /></el-icon>
          </el-button>
        </div>
      </template>
    </div>
  </Transition>

  <!-- 新版本更新内容弹窗 -->
  <el-dialog
    v-model="updaterStore.releaseDialogVisible"
    title=""
    width="440px"
    :close-on-click-modal="false"
    class="release-dialog"
  >
    <div class="release-content">
      <div class="release-icon">
        <el-icon size="40"><Promotion /></el-icon>
      </div>
      <h3>新版本已就绪</h3>
      <div class="release-version">
        <span class="current">v{{ updaterStore.currentVersion }}</span>
        <el-icon size="14"><ArrowRight /></el-icon>
        <span class="new">v{{ updaterStore.availableVersion }}</span>
      </div>
      <div v-if="updaterStore.releaseNotes" class="release-notes">
        <div class="notes-title">更新内容</div>
        <div class="notes-body">{{ updaterStore.releaseNotes }}</div>
      </div>
    </div>
    <template #footer>
      <el-button @click="updaterStore.releaseDialogVisible = false">稍后</el-button>
      <el-button type="primary" class="btn-primary" @click="handleInstall">重启并安装</el-button>
    </template>
  </el-dialog>

  <!-- 手动检查结果弹窗（已是最新 / 错误） -->
  <el-dialog
    v-model="updaterStore.dialogVisible"
    title=""
    width="400px"
    :close-on-click-modal="false"
    class="check-dialog"
  >
    <div class="check-content">
      <div v-if="updaterStore.status === 'not-available'" class="check-state">
        <div class="state-icon latest">
          <el-icon size="36"><CircleCheck /></el-icon>
        </div>
        <h3>已是最新版本</h3>
        <p class="state-desc">当前版本 v{{ updaterStore.currentVersion }} 已是最新</p>
      </div>
      <div v-else-if="updaterStore.status === 'error'" class="check-state">
        <div class="state-icon error">
          <el-icon size="36"><WarningFilled /></el-icon>
        </div>
        <h3>检查更新失败</h3>
        <p class="state-desc error-text">{{ updaterStore.error }}</p>
      </div>
    </div>
    <template #footer>
      <template v-if="updaterStore.status === 'not-available'">
        <el-button type="primary" class="btn-primary" @click="updaterStore.dialogVisible = false">知道了</el-button>
      </template>
      <template v-else-if="updaterStore.status === 'error'">
        <el-button @click="updaterStore.dialogVisible = false">关闭</el-button>
        <el-button type="primary" class="btn-primary" @click="handleRetry">重试</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
.update-banner {
  position: relative;
  z-index: 100;
  overflow: hidden;
}

.banner-progress-bg {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: linear-gradient(90deg, rgba(102, 126, 234, 0.12) 0%, rgba(118, 75, 162, 0.08) 100%);
  transition: width 0.4s ease;
}

.banner-inner {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding: 0 16px;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  color: #fff;
}

.banner-done {
  cursor: pointer;
  transition: opacity 0.2s;
  &:hover { opacity: 0.92; }
}

.banner-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.banner-text {
  display: flex;
  align-items: center;
  gap: 6px;
}

.banner-detail {
  opacity: 0.75;
  font-size: 12px;
}

.banner-link {
  margin-left: 4px;
  padding: 2px 10px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
}

.banner-close {
  color: rgba(255, 255, 255, 0.7) !important;
  padding: 4px !important;
  min-height: unset;
  &:hover {
    color: #fff !important;
    background: rgba(255, 255, 255, 0.15) !important;
  }
}

.banner-slide-enter-active,
.banner-slide-leave-active {
  transition: all 0.35s ease;
}

.banner-slide-enter-from,
.banner-slide-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}

.release-dialog,
.check-dialog {
  :deep(.el-dialog) {
    border-radius: 16px;
    overflow: hidden;

    .el-dialog__header { display: none; }
    .el-dialog__body { padding: 0; }
    .el-dialog__footer { padding: 0 24px 24px; }
  }
}

.release-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 24px 20px;
  background: linear-gradient(135deg, #f5f7fa 0%, #e8eaed 100%);

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #1a1a1a;
  }
}

.release-icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
}

.release-version {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;

  .current { color: #909399; }
  .new { color: #667eea; font-weight: 600; }
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
    max-height: 180px;
    overflow-y: auto;
  }
}

.check-content {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 32px 24px 20px;
  background: linear-gradient(135deg, #f5f7fa 0%, #e8eaed 100%);
}

.check-state {
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
      max-width: 320px;
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

  &.latest {
    background: rgba(103, 194, 58, 0.1);
    color: #67c23a;
  }

  &.error {
    background: rgba(245, 108, 108, 0.1);
    color: #f56c6c;
  }
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
}
</style>

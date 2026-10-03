<script setup lang="ts">
/** 系统设置面板：浏览器 / 反检测 / 脚本 / 通知 / 更新 / 存储路径 */
import { useUpdaterStore } from '@/stores/updater'
import { useSettingsForm } from '@/composables/useSettingsForm'

const updaterStore = useUpdaterStore()
const {
  settingsForm, browserInfo, browserHint,
  pickBrowser, refreshBrowserInfo, refreshBrowserInfoDebounced, saveSettings
} = useSettingsForm()
</script>

<template>
  <div class="settings-form">
    <!-- 浏览器设置 -->
    <div class="settings-section">
      <div class="settings-title">
        <el-icon><Monitor /></el-icon><span>浏览器设置</span>
      </div>
      <el-form :model="settingsForm.browser" label-width="140px">
        <el-form-item label="执行浏览器">
          <div class="browser-picker">
            <el-input
              v-model="settingsForm.browser.executablePath"
              placeholder="留空则自动查找（自带 Chromium / 系统 Chrome / Edge）"
              clearable
              @input="refreshBrowserInfoDebounced"
              @clear="refreshBrowserInfo"
            />
            <el-button @click="pickBrowser">选择浏览器…</el-button>
          </div>
          <div class="form-hint browser-hint" :class="{ 'is-error': browserInfo?.problem }">
            {{ browserHint }}
          </div>
        </el-form-item>
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
          <span class="form-hint">总开关，关闭后下面三项都不生效</span>
        </el-form-item>
        <el-form-item label="逐字输入">
          <el-switch v-model="settingsForm.antiDetection.typingDelay" />
          <span class="form-hint">输入框内容按人打字速度逐字敲入</span>
        </el-form-item>
        <el-form-item label="鼠标轨迹模拟">
          <el-switch v-model="settingsForm.antiDetection.mouseTrace" />
          <span class="form-hint">点击前移动鼠标到目标位置，而不是瞬移</span>
        </el-form-item>
        <el-form-item label="随机延迟">
          <el-switch v-model="settingsForm.antiDetection.randomDelay" />
          <span class="form-hint">步骤间隔与轨迹加入随机抖动，避免每轮节奏完全一致</span>
        </el-form-item>
      </el-form>
    </div>

    <!-- 脚本设置 -->
    <div class="settings-section">
      <div class="settings-title">
        <el-icon><List /></el-icon><span>脚本设置</span>
      </div>
      <el-form :model="settingsForm.script" label-width="140px">
        <el-form-item label="最大并发数">
          <el-input-number v-model="settingsForm.script.maxConcurrency" :min="1" :max="5" />
          <span class="form-hint">同时执行的脚本数量，多出来的排队等待空位</span>
        </el-form-item>
        <el-form-item label="执行间隔(秒)">
          <el-input-number v-model="settingsForm.script.runInterval" :min="0" :max="60" />
          <span class="form-hint">同一脚本两轮执行之间的等待时间</span>
        </el-form-item>
        <el-form-item label="重试次数">
          <el-input-number v-model="settingsForm.script.retryCount" :min="0" :max="10" />
          <span class="form-hint">单个步骤失败后的重试次数，0 表示失败即停止</span>
        </el-form-item>
        <el-form-item label="执行进度浮窗">
          <el-switch v-model="settingsForm.script.hudEnabled" />
          <span class="form-hint">在执行的浏览器上显示当前步骤，避免误以为卡死</span>
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
          <span class="form-hint">通知弹出时是否带声音</span>
        </el-form-item>
        <el-form-item label="人工介入提醒">
          <el-switch v-model="settingsForm.notification.manualIntervention" />
          <span class="form-hint">某步骤重试后仍失败时提示，页面多半需要人接手</span>
        </el-form-item>
        <el-form-item label="任务完成提醒">
          <el-switch v-model="settingsForm.notification.taskComplete" />
          <span class="form-hint">脚本执行结束（含失败、被停止）时提示</span>
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
          <el-button type="primary" @click="updaterStore.check()">
            <el-icon><Refresh /></el-icon>
            <span>检查更新</span>
          </el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 存储设置 -->
    <div class="settings-section">
      <div class="settings-title">
        <el-icon><FolderOpened /></el-icon><span>存储设置</span>
      </div>
      <el-form :model="settingsForm.storage" label-width="140px">
        <el-form-item label="运行日志目录">
          <el-input v-model="settingsForm.storage.logDir" placeholder="留空则使用应用数据目录下的 logs" />
          <span class="form-hint">保存后立即生效，新的运行日志写入该目录</span>
        </el-form-item>
      </el-form>
    </div>

    <div class="settings-actions">
      <el-button type="primary" size="large" @click="saveSettings">
        <el-icon><Check /></el-icon> 保存设置
      </el-button>
    </div>
  </div>
</template>

<style scoped lang="scss">
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

.browser-picker { display: flex; gap: 8px; width: 100%; }
.browser-picker :deep(.el-input) { flex: 1; min-width: 0; }
.browser-picker :deep(.el-button) { flex-shrink: 0; }
.browser-hint {
  width: 100%;
  margin-left: 0;
  line-height: 1.6;
  word-break: break-all;

  &.is-error { color: #f56c6c; }
}

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

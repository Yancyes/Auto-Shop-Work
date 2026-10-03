<script setup lang="ts">
import { ref, computed } from 'vue'
import { formatDate } from '@/utils'

const visible = ref(false)
const loading = ref(false)
const version = ref('')
const releaseDate = ref('')
const releaseNotes = ref('')
const loadError = ref(false)

/**
 * 更新说明按行解析成结构化数据，模板直接渲染。
 * 不拼 HTML 字符串再 v-html：说明文本里出现 < > & 时不会被当成标签解析（也不给注入留口子）。
 */
const noteLines = computed(() =>
  releaseNotes.value
    .split('\n')
    .map(raw => {
      const line = raw.trim()
      if (!line) return null
      if (line.startsWith('【') && line.endsWith('】')) {
        return { kind: 'category' as const, text: line }
      }
      return { kind: 'item' as const, text: line.startsWith('- ') ? line.slice(2).trim() : line }
    })
    .filter((line): line is { kind: 'category' | 'item'; text: string } => line !== null)
)

async function loadVersionInfo() {
  loading.value = true
  loadError.value = false
  try {
    const res = await fetch('./version-info.json')
    if (!res.ok) throw new Error('fetch failed')
    const data = await res.json()
    version.value = data.version || ''
    releaseDate.value = data.releaseDate || ''
    releaseNotes.value = data.releaseNotes || ''
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function open() {
  visible.value = true
  loadVersionInfo()
}

defineExpose({ open })
</script>

<template>
  <el-dialog
    v-model="visible"
    title="版本信息"
    width="520px"
    :close-on-click-modal="true"
    class="version-info-dialog"
  >
    <div v-if="loading" class="version-loading">
      <el-icon class="is-loading" size="24"><Loading /></el-icon>
      <span>加载中...</span>
    </div>

    <div v-else-if="loadError" class="version-error">
      <el-icon size="24" color="#f56c6c"><WarningFilled /></el-icon>
      <span>加载失败，请稍后重试</span>
    </div>

    <div v-else class="version-content">
      <div class="version-header">
        <div class="version-badge">v{{ version }}</div>
        <div v-if="releaseDate" class="version-date">
          <el-icon size="12"><Calendar /></el-icon>
          <span>{{ formatDate(releaseDate) }}</span>
        </div>
      </div>

      <div v-if="noteLines.length" class="version-notes">
        <div class="notes-section-title">更新内容</div>
        <div class="notes-body">
          <div v-for="(line, i) in noteLines" :key="i" :class="line.kind === 'category' ? 'note-category' : 'note-item'">
            {{ line.text }}
          </div>
        </div>
      </div>

      <div class="version-footer-info">
        <span>影随 TraceFlow</span>
        <span class="dot">·</span>
        <span>Developer: Yancy</span>
      </div>
    </div>

    <template #footer>
      <el-button type="primary" class="btn-primary" @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
:deep(.el-dialog) {
  border-radius: 16px;
  overflow: hidden;

  .el-dialog__header {
    padding: 20px 24px 0;
    margin: 0;
  }

  .el-dialog__body {
    padding: 0 24px 16px;
  }

  .el-dialog__footer {
    padding: 0 24px 24px;
  }
}

.version-loading,
.version-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 0;
  color: #909399;
  font-size: 14px;
}

.version-content {
  .version-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }

  .version-badge {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff;
    padding: 6px 16px;
    border-radius: 20px;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }

  .version-date {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #b0b3b8;
  }

  .version-notes {
    background: #f8f9fb;
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 16px;
    max-height: 360px;
    overflow-y: auto;

    .notes-section-title {
      font-size: 13px;
      font-weight: 600;
      color: #606266;
      margin-bottom: 12px;
    }

    .notes-body {
      :deep(.note-category) {
        font-size: 14px;
        font-weight: 600;
        color: #303133;
        margin-top: 12px;
        margin-bottom: 6px;

        &:first-child { margin-top: 0; }
      }

      :deep(.note-item) {
        font-size: 13px;
        color: #606266;
        line-height: 1.8;
        padding-left: 12px;
        position: relative;

        &::before {
          content: '';
          position: absolute;
          left: 0;
          top: 10px;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #667eea;
        }
      }
    }
  }

  .version-footer-info {
    text-align: center;
    font-size: 12px;
    color: #c0c4cc;

    .dot {
      margin: 0 4px;
    }
  }
}
</style>

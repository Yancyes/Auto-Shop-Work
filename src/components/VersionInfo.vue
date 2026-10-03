<script setup lang="ts">
import { ref, computed } from 'vue'
import { formatDate } from '@/utils'
import { ipc } from '@/api'
import type { ChangelogEntry } from '../../shared/types'

const visible = ref(false)
const loading = ref(false)
const version = ref('')
const releaseDate = ref('')
const releaseNotes = ref('')
const loadError = ref(false)

const historyOpen = ref(false)
const history = ref<ChangelogEntry[]>([])
const historyLoading = ref(false)
const historyError = ref('')
/** el-collapse 的展开项，默认全部收起 */
const expandedVersions = ref<string[]>([])

type NoteLine = { kind: 'category' | 'item'; text: string }

/**
 * 更新说明按行解析成结构化数据，模板直接渲染。
 * 不拼 HTML 字符串再 v-html：说明文本里出现 < > & 时不会被当成标签解析（也不给注入留口子）。
 * 历史版本的说明写在 GitHub Release 正文里，早期用 markdown 标题（## 新功能），
 * 这里一并归到分组行，避免界面上露出「## 」「- 」这类原始符号。
 */
function parseNotes(text: string): NoteLine[] {
  return text
    .split('\n')
    .map(raw => {
      const line = raw.trim()
      if (!line) return null
      if (line.startsWith('【') && line.endsWith('】')) {
        return { kind: 'category' as const, text: line }
      }
      const heading = line.match(/^#{1,6}\s+(.+)$/)
      if (heading) return { kind: 'category' as const, text: heading[1].trim() }
      const bullet = line.replace(/^[-*]\s+/, '').trim()
      return { kind: 'item' as const, text: bullet }
    })
    .filter((line): line is NoteLine => line !== null)
}

const noteLines = computed(() => parseNotes(releaseNotes.value))

async function loadHistory() {
  if (history.value.length || historyLoading.value) return
  historyLoading.value = true
  historyError.value = ''
  try {
    const res = await ipc.invoke('changelog:list')
    if (res.success && res.data) history.value = res.data
    else historyError.value = res.error || '获取历史更新记录失败'
  } catch (e) {
    historyError.value = (e as Error).message
  } finally {
    historyLoading.value = false
  }
}

function toggleHistory() {
  historyOpen.value = !historyOpen.value
  if (historyOpen.value) loadHistory()
}

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
    align-center
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

      <div class="version-history">
        <button type="button" class="history-toggle" @click="toggleHistory">
          <span>{{ historyOpen ? '收起历史更新记录' : '查看历史更新记录' }}</span>
          <el-icon size="12"><component :is="historyOpen ? 'Top' : 'Bottom'" /></el-icon>
        </button>

        <div v-if="historyOpen" class="history-body">
          <div v-if="historyLoading" class="history-hint">
            <el-icon class="is-loading" size="14"><Loading /></el-icon>
            <span>正在获取历史记录...</span>
          </div>
          <div v-else-if="historyError" class="history-hint error">
            <span>{{ historyError }}</span>
            <el-button size="small" text class="retry-btn" @click="loadHistory">重试</el-button>
          </div>
          <el-collapse v-else v-model="expandedVersions">
            <el-collapse-item
              v-for="item in history"
              :key="item.version"
              :name="item.version"
              :title="`v${item.version}　${formatDate(item.date)}`"
            >
              <div class="notes-body">
                <div
                  v-for="(line, i) in parseNotes(item.notes)"
                  :key="i"
                  :class="line.kind === 'category' ? 'note-category' : 'note-item'"
                >
                  {{ line.text }}
                </div>
              </div>
            </el-collapse-item>
          </el-collapse>
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

    .notes-section-title {
      font-size: 13px;
      font-weight: 600;
      color: #606266;
      margin-bottom: 12px;
    }
  }

  /* 当前版本说明与历史记录说明共用同一套行样式 */
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

  .version-history {
    margin-bottom: 16px;

    .history-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 10px 12px;
      border: none;
      border-radius: 10px;
      background: #f2f3f7;
      color: #606266;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.2s;

      &:hover { background: #e9ebf2; }
    }

    .history-body {
      margin-top: 10px;
      border: 1px solid #ebeef5;
      border-radius: 10px;
      padding: 0 14px;
    }

    .history-hint {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 0;
      font-size: 13px;
      color: #909399;

      &.error { color: #f56c6c; }

      .retry-btn { margin-left: auto; }
    }

    :deep(.el-collapse) {
      border: none;

      .el-collapse-item__header {
        font-size: 13px;
        color: #303133;
      }

      .el-collapse-item__wrap {
        border: none;
      }

      .el-collapse-item__content {
        padding: 4px 0 14px;
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

<style lang="scss">
/* el-dialog 会用 teleport 渲染到 body 下，组件根节点拿不到本组件的 data-v 作用域属性，
   因此弹窗内部（header/body/footer）的样式必须写在全局块里，用专属类名限定作用域 */
.version-info-dialog {
  border-radius: 16px;
  overflow: hidden;

  .el-dialog__header {
    padding: 20px 24px 0;
    margin: 0;
  }

  .el-dialog__body {
    padding: 0 24px 16px;
    /* 正文整体可滚动，长更新说明不会被裁掉。
       上限比更新弹窗更保守：本弹窗还有标题栏、历史列表和底部按钮，
       太高会把「关闭」按钮顶出窗口 */
    max-height: min(50vh, 440px);
    overflow-y: auto;
  }

  .el-dialog__footer {
    padding: 0 24px 24px;
  }
}
</style>

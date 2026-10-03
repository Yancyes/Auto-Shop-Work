<script setup lang="ts">
/** 运行日志面板：筛选、列表与删除/清空 */
import { ref, computed, onMounted } from 'vue'
import { useLogStore } from '@/stores/log'
import { LOG_LEVEL_TAG } from '@/utils'
import type { LogLevel, RunLog } from '../../shared/types'

const logStore = useLogStore()

const logFilter = ref<{
  level: LogLevel | ''
  scriptId: number | ''
}>({
  level: '',
  scriptId: ''
})

const filteredLogs = computed(() => {
  return logStore.logs.filter(log => {
    if (logFilter.value.level && log.level !== logFilter.value.level) return false
    if (logFilter.value.scriptId && log.scriptId !== Number(logFilter.value.scriptId)) return false
    return true
  })
})

async function handleDeleteLog(log: RunLog, e: Event) {
  e.stopPropagation()
  const res = await logStore.deleteLog(log.id)
  if (res.success) {
    ElMessage.success('日志已删除')
  } else {
    ElMessage.error('删除失败')
  }
}

async function handleClearLogs() {
  const shown = filteredLogs.value.length
  const total = logStore.logs.length
  // 筛选状态下「清空」实际清的是全部，必须说清楚，不能让数量不符的提示骗过用户
  const scope = shown < total ? `当前筛选出 ${shown} 条，实际会清空全部 ${total} 条` : `共 ${total} 条`
  try {
    await ElMessageBox.confirm(`确定清空所有运行日志吗？${scope}。此操作不可恢复。`, '清空日志', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    const res = await logStore.clearLogs()
    if (res.success) ElMessage.success('日志已清空')
    else ElMessage.error('清空失败')
  } catch {
    // cancelled
  }
}

onMounted(() => {
  logStore.loadLogs()
})
</script>

<template>
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
        <el-input v-model="logFilter.scriptId" placeholder="脚本ID" size="small" style="width: 100px" />
        <el-button size="small" @click="logStore.loadLogs()">
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
        >
          <el-tag :type="LOG_LEVEL_TAG[log.level]" size="small" effect="dark">{{ log.level.toUpperCase() }}</el-tag>
          <span class="log-time">{{ log.createdAt }}</span>
          <span class="log-script" v-if="log.scriptId">[{{ log.scriptId }}]</span>
          <span class="log-msg">{{ log.message }}</span>
          <el-icon class="log-delete-btn" @click="handleDeleteLog(log, $event)"><Close /></el-icon>
        </div>
        <el-empty v-if="!filteredLogs.length" description="暂无日志" :image-size="60" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
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
  font-size: 12px;
  transition: background 0.15s;

  &:hover { background: #f5f7fa; }

  &.log-error { background: #fef0f0; }
  &.log-warn { background: #fdf6ec; }

  .log-time { color: #c0c4cc; font-family: monospace; white-space: nowrap; }
  .log-script { color: #409eff; font-weight: 600; }
  .log-msg { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
</style>

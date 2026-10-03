<script setup lang="ts">
/** 脚本管理页的单个脚本卡片：展示元信息，操作入口交给父级处理 */
import { computed } from 'vue'
import type { RecordedScript } from '../../shared/types'
import { SCRIPT_STATUS_MAP, formatDate, parseScriptSteps } from '@/utils'

const props = defineProps<{
  script: RecordedScript
  /** 有脚本正在执行或排队时禁止再次启动 */
  isProgressing: boolean
}>()

const emit = defineEmits<{
  run: [script: RecordedScript]
  edit: [script: RecordedScript]
  copy: [script: RecordedScript]
  remove: [script: RecordedScript]
}>()

const stepCount = computed(() => parseScriptSteps(props.script.stepsJson).length)
</script>

<template>
  <div class="script-card card">
    <div class="script-header">
      <div class="script-title">
        <span class="script-name">{{ script.name }}</span>
        <el-tag :type="SCRIPT_STATUS_MAP[script.status]?.type" size="small">
          {{ SCRIPT_STATUS_MAP[script.status]?.label }}
        </el-tag>
      </div>
      <div class="script-actions">
        <el-button type="primary" size="small" :disabled="isProgressing" @click="emit('run', script)">
          <el-icon><VideoPlay /></el-icon>
          执行
        </el-button>
        <el-button size="small" plain :disabled="script.status === 'running'" @click="emit('edit', script)">
          <el-icon><Edit /></el-icon>
          编辑步骤
        </el-button>
        <el-button size="small" plain title="复制一份，可改成本系列统一的命名" @click="emit('copy', script)">
          <el-icon><CopyDocument /></el-icon>
          复制
        </el-button>
        <el-button
          type="danger"
          text
          size="small"
          :disabled="script.status === 'running'"
          title="执行或排队中的脚本需先终止才能删除"
          @click="emit('remove', script)"
        >
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
    </div>

    <div class="script-meta">
      <span class="meta-item">
        <el-icon><Link /></el-icon>
        {{ script.targetUrl }}
      </span>
      <span class="meta-item">
        <el-icon><List /></el-icon>
        {{ stepCount }} 个步骤
      </span>
      <span class="meta-item">
        <el-icon><Timer /></el-icon>
        已执行 {{ script.runCount }} 次
      </span>
      <span class="meta-item">
        <el-icon><Clock /></el-icon>
        {{ formatDate(script.createdAt) }}
      </span>
    </div>

    <div v-if="script.description" class="script-desc">
      {{ script.description }}
    </div>
  </div>
</template>

<style scoped lang="scss">
.script-card {
  padding: 16px 20px;
}

.script-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;

  .script-title {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .script-name {
    font-size: 16px;
    font-weight: 600;
    color: #303133;
  }

  .script-actions {
    display: flex;
    gap: 6px;
  }
}

.script-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;

  .meta-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #909399;
  }
}

.script-desc {
  margin-top: 10px;
  font-size: 13px;
  color: #606266;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 6px;
}
</style>

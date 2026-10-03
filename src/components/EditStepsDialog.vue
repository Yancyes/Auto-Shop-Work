<script setup lang="ts">
/** 已保存脚本的步骤编辑弹窗：深拷贝副本编辑，落库由父级完成，取消即丢弃 */
import { ref, watch } from 'vue'
import type { RecordedStep, RecordedScript } from '../../shared/types'
import { parseScriptSteps } from '@/utils'
import StepListEditor from '@/components/StepListEditor.vue'

const props = defineProps<{
  visible: boolean
  script: RecordedScript | null
  saving: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: [steps: RecordedStep[]]
}>()

const steps = ref<RecordedStep[]>([])

watch(() => props.visible, opened => {
  if (!opened) return
  steps.value = parseScriptSteps(props.script?.stepsJson).map(s => ({ ...s }))
})

function submit() {
  if (steps.value.length === 0) {
    ElMessage.warning('脚本至少需要保留一个步骤')
    return
  }
  emit('save', steps.value)
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`编辑步骤 · ${script?.name ?? ''}`"
    width="720px"
    top="8vh"
    @update:model-value="emit('update:visible', $event as boolean)"
  >
    <div class="edit-meta">
      <span class="edit-url" :title="script?.targetUrl">
        <el-icon><Link /></el-icon>
        {{ script?.targetUrl }}
      </span>
      <el-tag size="small" round>{{ steps.length }} 个步骤</el-tag>
    </div>
    <div class="edit-body">
      <StepListEditor v-model="steps" confirm-remove />
    </div>
    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
.edit-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #f0f0f0;

  .edit-url {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #909399;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.edit-body {
  display: flex;
  flex-direction: column;
  height: 52vh;
  margin: 0 -20px;
}
</style>

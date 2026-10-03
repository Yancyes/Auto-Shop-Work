<script setup lang="ts">
/** 已保存脚本的步骤编辑弹窗：深拷贝副本编辑，落库由父级完成，取消即丢弃 */
import { ref, computed, watch } from 'vue'
import type { RecordedStep, RecordedScript } from '../../shared/types'
import { parseMonitors } from '../../shared/monitor-config'
import { parseScriptSteps } from '@/utils'
import StepListEditor from '@/components/StepListEditor.vue'

const props = defineProps<{
  visible: boolean
  script: RecordedScript | null
  saving: boolean
  /** 该脚本正在执行：保存走热更新，当前这一步跑完就按新列表继续 */
  live?: boolean
  /** 执行中当前步骤下标，用于高亮 */
  activeIndex?: number
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: [steps: RecordedStep[]]
}>()

const steps = ref<RecordedStep[]>([])

/** 「监控检查点」步骤要引用区域 id：这里把脚本已配好的区域交给步骤编辑器 */
const monitorOptions = computed(() =>
  parseMonitors(props.script?.monitorJson).map(m => ({ id: m.id, label: m.label }))
)

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
    <el-alert
      v-if="live"
      type="warning"
      :closable="false"
      show-icon
      class="live-alert"
      title="该脚本正在执行：保存后当前这一步跑完就按新步骤继续，不会中断浏览器"
    />
    <div class="edit-body">
      <StepListEditor
        v-model="steps"
        confirm-remove
        :monitors="monitorOptions"
        :active-index="activeIndex ?? -1"
      />
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

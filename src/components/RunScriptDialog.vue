<script setup lang="ts">
/** 执行脚本弹窗：收集执行次数（0 表示无限循环），启动逻辑由父级处理 */
import { ref, watch } from 'vue'
import type { RecordedScript } from '../../shared/types'
import { parseScriptSteps } from '@/utils'

const props = defineProps<{
  visible: boolean
  script: RecordedScript | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: [count: number]
}>()

const count = ref(1)
const infinite = ref(false)

watch(() => props.visible, opened => {
  if (!opened) return
  count.value = 1
  infinite.value = false
})
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="执行脚本"
    width="380px"
    @update:model-value="emit('update:visible', $event as boolean)"
  >
    <el-form label-width="80px">
      <el-form-item label="脚本">
        <span>{{ script?.name }}</span>
      </el-form-item>
      <el-form-item label="步骤数">
        <span>{{ script ? parseScriptSteps(script.stepsJson).length : 0 }}</span>
      </el-form-item>
      <el-form-item label="无限循环">
        <el-switch v-model="infinite" />
        <span style="margin-left: 8px; color: #909399; font-size: 12px;">
          开启后将持续执行直到手动终止
        </span>
      </el-form-item>
      <el-form-item v-if="!infinite" label="执行次数">
        <el-input-number v-model="count" :min="1" :max="100" />
      </el-form-item>
      <el-form-item v-else label="执行次数">
        <span style="color: #e6a23c; font-weight: 500;">∞ 无限循环</span>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" @click="emit('confirm', infinite ? 0 : count || 1)">开始执行</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/** 保存录制结果为脚本的弹窗：只收集元信息，步骤换算与落库由调用方完成 */
import { ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  stepCount: number
  /** 打开时预填的目标网址：录制起点，或当前页面地址 */
  defaultUrl: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: [payload: { name: string; url: string; description?: string }]
}>()

const name = ref('')
const url = ref('')
const desc = ref('')

watch(() => props.visible, opened => {
  if (!opened) return
  name.value = ''
  desc.value = ''
  url.value = props.defaultUrl
})

function submit() {
  const trimmedName = name.value.trim()
  if (!trimmedName) {
    ElMessage.warning('请输入脚本名称')
    return
  }
  const trimmedUrl = url.value.trim()
  if (!trimmedUrl) {
    ElMessage.warning('请填写目标网址（执行脚本时从这里开始）')
    return
  }
  emit('save', {
    name: trimmedName,
    url: trimmedUrl,
    description: desc.value.trim() || undefined
  })
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="保存脚本"
    width="420px"
    @update:model-value="emit('update:visible', $event as boolean)"
  >
    <el-form label-width="80px">
      <el-form-item label="脚本名称" required>
        <el-input v-model="name" placeholder="如：商品搜索下单流程" maxlength="50" />
      </el-form-item>
      <el-form-item label="目标网址" required>
        <el-input v-model="url" placeholder="执行脚本时首先打开的页面" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="desc" type="textarea" :rows="2" placeholder="可选，脚本用途说明" maxlength="200" />
      </el-form-item>
      <el-form-item label="步骤数">
        <span>{{ stepCount }} 个操作步骤</span>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

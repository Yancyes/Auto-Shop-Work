<script setup lang="ts">
/** 执行脚本弹窗：收集执行次数（0 表示无限循环）与本次的变量值，启动逻辑由父级处理 */
import { computed, reactive, ref, watch } from 'vue'
import type { RecordedScript } from '../../shared/types'
import { collectStepVars, missingScriptVars, parseDataSheet, varNamesIn } from '../../shared/script-vars'
import { parseScriptSteps } from '@/utils'

const props = defineProps<{
  visible: boolean
  script: RecordedScript | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: [count: number, defaults: Record<string, string>]
}>()

const count = ref(1)
const infinite = ref(false)
/** 变量名 → 本次值：数据表里空的格子用它兜底 */
const defaults = reactive<Record<string, string>>({})

const varNames = computed(() => {
  const steps = parseScriptSteps(props.script?.stepsJson)
  const names = collectStepVars(steps)
  for (const name of varNamesIn(props.script?.targetUrl)) {
    if (!names.includes(name)) names.push(name)
  }
  return names
})

const sheet = computed(() => parseDataSheet(props.script?.dataJson))

watch(() => props.visible, opened => {
  if (!opened) return
  count.value = 1
  infinite.value = false
  for (const key of Object.keys(defaults)) delete defaults[key]
  // 用第一行数据预填：想换成本次数据直接改，不改就等于「跟着数据表走」
  const first = sheet.value.rows[0] ?? []
  sheet.value.columns.forEach((name, i) => {
    if (first[i]) defaults[name] = first[i]
  })
})

function submit() {
  const missing = missingScriptVars(
    parseScriptSteps(props.script?.stepsJson),
    props.script?.targetUrl ?? '',
    sheet.value,
    defaults
  )
  if (missing.length > 0) {
    ElMessage.error(`变量 ${missing.join('、')} 还没有数据：填本次值，或在「自定义数据」里补齐每一行`)
    return
  }
  emit('confirm', infinite.value ? 0 : count.value || 1, { ...defaults })
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="执行脚本"
    width="440px"
    @update:model-value="emit('update:visible', $event as boolean)"
  >
    <el-form label-width="80px">
      <el-form-item label="脚本">
        <span>{{ script?.name }}</span>
      </el-form-item>
      <el-form-item label="步骤数">
        <span>{{ parseScriptSteps(script?.stepsJson).length }}</span>
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

    <template v-if="varNames.length">
      <div class="run-vars">
        <div class="vars-head">
          <span>本脚本有 {{ varNames.length }} 个变量</span>
          <span class="vars-rows">
            <template v-if="sheet.rows.length">
              数据表 {{ sheet.rows.length }} 行，第 N 轮取第 N 行，超出后从头循环
            </template>
            <template v-else>还没有数据表，本次值会用在所有轮次</template>
          </span>
        </div>
        <el-form label-width="80px">
          <el-form-item v-for="name in varNames" :key="name" :label="name">
            <el-input v-model="defaults[name]" :placeholder="sheet.rows.length ? '本次值（空则用数据表）' : '本次要用的值'" />
          </el-form-item>
        </el-form>
      </div>
    </template>

    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" @click="submit">开始执行</el-button>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
.run-vars {
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px dashed #ebeef5;
}

.vars-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
  font-size: 13px;
  color: #303133;
}

.vars-rows {
  font-size: 12px;
  color: #909399;
}
</style>

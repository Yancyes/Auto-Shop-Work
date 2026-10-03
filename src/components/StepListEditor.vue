<script setup lang="ts">
import { computed, ref } from 'vue'
import { ACTION_LABELS, type TagType } from '@/utils'
import { DEFAULT_STEP_DELAY, MAX_STEP_DELAY } from '../../shared/constants'
import { varNamesIn } from '../../shared/script-vars'
import type { RecordedAction, RecordedStep } from '../../shared/types'

const props = withDefaults(defineProps<{
  modelValue: RecordedStep[]
  /** 锁定编辑：录制/回放进行中，隐藏增删改与排序 */
  locked?: boolean
  /** 锁定时是否仍允许删除（录制中允许删掉误录的步骤） */
  allowRemove?: boolean
  /** 删除前二次确认：编辑已保存脚本时误删代价高 */
  confirmRemove?: boolean
  /** 回放高亮的步骤下标，-1 表示无 */
  activeIndex?: number
  emptyText?: string
}>(), {
  locked: false,
  allowRemove: false,
  confirmRemove: false,
  activeIndex: -1,
  emptyText: '暂无步骤，点击下方「添加步骤」手动新建'
})

const emit = defineEmits<{ 'update:modelValue': [RecordedStep[]] }>()

/** 模板里不能直接写 {{...}} 字面量（会被当成插值解析），示例文案走常量 */
const SAMPLE_FIELD = '{{字段名}}'

const steps = computed(() => props.modelValue)
const canEdit = computed(() => !props.locked)
const canRemove = computed(() => !props.locked || props.allowRemove)

/** 新增步骤用全局递增 id，避免与录制序列的小整数 id 冲突 */
let newStepSeq = Date.now()

const ACTION_OPTIONS: { label: string; value: RecordedAction }[] = [
  { label: '点击', value: 'click' },
  { label: '双击', value: 'dblclick' },
  { label: '输入', value: 'fill' },
  { label: '选择', value: 'select' },
  { label: '按键', value: 'keypress' },
  { label: '滚动', value: 'scroll' },
  { label: '导航', value: 'navigate' },
  { label: '等待', value: 'wait' }
]

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

function getActionTagType(action: string): TagType | undefined {
  const map: Record<string, TagType> = {
    click: 'primary',
    dblclick: 'success',
    fill: 'warning',
    select: 'info',
    scroll: 'info',
    navigate: 'danger'
  }
  return map[action]
}

function commit(next: RecordedStep[]) {
  emit('update:modelValue', next)
}

function stepSummary(step: RecordedStep): string {
  return step.description || step.elementText || step.selector || step.action
}

/** 步骤里用到的变量（选择器与值都算），执行时按「自定义数据」的行替换 */
function stepVars(step: RecordedStep): string[] {
  const names: string[] = []
  for (const name of [...varNamesIn(step.selector), ...varNamesIn(step.value)]) {
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/** 把整个字段改成 {{变量名}}：写死一次的数据，不如改成每轮都能换的值 */
async function markFieldAsVar(field: 'selector' | 'value') {
  let name = ''
  try {
    const res = await ElMessageBox.prompt('变量名要和「自定义数据」的列名一致', '设为变量', {
      inputValue: varNamesIn(form.value[field])[0] ?? '',
      inputPlaceholder: '例如：关键词',
      inputValidator: (value: string) => (value && value.trim() ? true : '变量名不能为空')
    })
    name = String(res.value ?? '').trim()
  } catch {
    return
  }
  if (!name) return
  form.value[field] = `{{${name}}}`
}

// ========== 新增 / 编辑弹窗 ==========

const dialogVisible = ref(false)
/** null 表示新增；否则为待编辑步骤的下标（用下标而非 id，避免重复 id 被一起改掉） */
const editingIndex = ref<number | null>(null)
const form = ref({
  action: 'click' as RecordedAction,
  selector: '',
  value: '',
  description: '',
  delayBefore: DEFAULT_STEP_DELAY
})

const needsValue = computed(() => {
  const a = form.value.action
  return a === 'fill' || a === 'select' || a === 'keypress' || a === 'navigate' || a === 'scroll'
})

const needsSelector = computed(() => {
  const a = form.value.action
  return a !== 'scroll' && a !== 'navigate' && a !== 'wait'
})

function openAdd() {
  if (!canEdit.value) return
  editingIndex.value = null
  form.value = { action: 'click', selector: '', value: '', description: '', delayBefore: DEFAULT_STEP_DELAY }
  dialogVisible.value = true
}

function openEdit(index: number) {
  if (!canEdit.value) return
  const step = steps.value[index]
  if (!step) return
  editingIndex.value = index
  form.value = {
    action: step.action,
    selector: step.selector,
    value: step.value ?? '',
    description: step.description ?? '',
    delayBefore: step.delayBefore ?? DEFAULT_STEP_DELAY
  }
  dialogVisible.value = true
}

/** 合并编辑字段：动作变化时重置描述，输入/选择的值变化时刷新值预览 */
function applyEdit(origin: RecordedStep, patch: Partial<RecordedStep>): RecordedStep {
  const next = { ...origin, ...patch } as RecordedStep
  if (patch.action && patch.action !== origin.action) {
    next.description = patch.description ?? ''
  }
  if (patch.value !== undefined && (next.action === 'fill' || next.action === 'select')) {
    const el = next.elementText || next.tagName || ''
    next.description = `${next.action === 'fill' ? '输入' : '选择'} ${el} = ${String(patch.value).slice(0, 20)}`
  }
  return next
}

function confirmDialog() {
  const f = form.value
  if (needsSelector.value && !f.selector.trim()) {
    ElMessage.warning('请填写选择器')
    return
  }
  const patch: Partial<RecordedStep> = {
    action: f.action,
    selector: f.selector.trim(),
    value: f.value || undefined,
    description: f.description.trim(),
    delayBefore: f.delayBefore
  }
  if (editingIndex.value === null) {
    commit([...steps.value, { ...patch, id: ++newStepSeq } as RecordedStep])
    ElMessage.success('已添加步骤')
  } else {
    const index = editingIndex.value
    if (index < steps.value.length) {
      commit(steps.value.map((s, i) => (i === index ? applyEdit(s, patch) : s)))
      ElMessage.success('步骤已更新')
    }
  }
  dialogVisible.value = false
}

/** 按下标删除：步骤 id 可能重复（录制器与手动新增混用），按 id 过滤会一次删掉多条 */
async function remove(index: number) {
  if (!canRemove.value) return
  const target = steps.value[index]
  if (!target) return
  if (props.confirmRemove) {
    try {
      await ElMessageBox.confirm(`确定删除步骤 ${index + 1}「${stepSummary(target)}」？保存后生效`, '提示', {
        type: 'warning'
      })
    } catch {
      return
    }
  }
  commit(steps.value.filter((_, i) => i !== index))
}

function move(from: number, to: number) {
  const len = steps.value.length
  if (!canEdit.value || from < 0 || from >= len || to < 0 || to >= len || from === to) return
  const next = [...steps.value]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  commit(next)
}
</script>

<template>
  <div class="step-editor">
    <div
      v-for="(step, index) in steps"
      :key="`${index}-${step.id}`"
      class="step-item"
      :class="{ 'is-playing': index === activeIndex }"
    >
      <span class="step-num">{{ index + 1 }}</span>
      <el-tag size="small" :type="getActionTagType(step.action)" effect="plain">
        {{ getActionLabel(step.action) }}
      </el-tag>
      <span class="step-desc" :title="step.selector">{{ stepSummary(step) }}</span>
      <el-tag
        v-if="stepVars(step).length"
        size="small"
        type="warning"
        effect="plain"
        class="step-var"
        :title="`执行时按数据表替换：${stepVars(step).join('、')}`"
      >
        {{ stepVars(step).join('、') }}
      </el-tag>
      <div v-if="canEdit" class="step-ops">
        <el-button text size="small" :disabled="index === 0" title="上移" @click="move(index, index - 1)">
          <el-icon><Top /></el-icon>
        </el-button>
        <el-button text size="small" :disabled="index === steps.length - 1" title="下移" @click="move(index, index + 1)">
          <el-icon><Bottom /></el-icon>
        </el-button>
        <el-button text size="small" type="primary" title="编辑" @click="openEdit(index)">
          <el-icon><Edit /></el-icon>
        </el-button>
        <el-button text size="small" type="danger" title="删除" @click="remove(index)">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
      <el-button v-else-if="canRemove" text size="small" type="danger" @click="remove(index)">
        <el-icon><Close /></el-icon>
      </el-button>
    </div>

    <div v-if="steps.length === 0" class="steps-empty">
      <el-icon size="40" color="#dcdfe6"><VideoCamera /></el-icon>
      <p>{{ emptyText }}</p>
    </div>

    <el-button v-if="canEdit" class="add-step-btn" text type="primary" @click="openAdd">
      <el-icon><Plus /></el-icon>
      添加步骤
    </el-button>

    <el-dialog
      v-model="dialogVisible"
      :title="editingIndex === null ? '新增步骤' : '编辑步骤'"
      width="460px"
      append-to-body
    >
      <el-form label-width="80px">
        <el-form-item label="动作" required>
          <el-select v-model="form.action" placeholder="选择动作" style="width: 100%">
            <el-option v-for="opt in ACTION_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="needsSelector" label="选择器" required>
          <div class="field-with-var">
            <el-input v-model="form.selector" type="textarea" :rows="2" placeholder="如 #submit-btn 或 .item > a" />
            <el-button class="var-btn" text size="small" type="warning" @click="markFieldAsVar('selector')">
              <el-icon><MagicStick /></el-icon>
              选择器设为变量
            </el-button>
          </div>
        </el-form-item>
        <el-form-item v-if="needsValue" label="值">
          <div class="field-with-var">
            <el-input
              v-model="form.value"
              :placeholder="form.action === 'scroll' ? 'up 或 down' : (form.action === 'navigate' ? '目标 URL' : '输入值，或写 {{字段名}}')"
            />
            <el-button class="var-btn" text size="small" type="warning" @click="markFieldAsVar('value')">
              <el-icon><MagicStick /></el-icon>
              值设为变量
            </el-button>
          </div>
        </el-form-item>
        <div class="var-hint">
          写 <code>{{ SAMPLE_FIELD }}</code> 的字段会在执行时按「自定义数据」的每一行替换，一轮一行
        </div>
        <el-form-item label="描述">
          <el-input v-model="form.description" placeholder="可选，留空将自动生成" />
        </el-form-item>
        <el-form-item label="延迟(ms)">
          <el-input-number v-model="form.delayBefore" :min="0" :max="MAX_STEP_DELAY" :step="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmDialog">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.step-editor {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  transition: all 0.2s;
  margin-bottom: 4px;

  &:hover {
    background: #f5f7fa;
  }

  &.is-playing {
    background: #fdf6ec;
    border-color: #f5dab1;
  }
}

.step-ops {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
}

.step-num {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #e63946;
  color: #fff;
  font-size: 11px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.step-desc {
  flex: 1;
  font-size: 12px;
  color: #606266;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.step-var {
  flex-shrink: 0;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-with-var {
  width: 100%;
}

.var-btn {
  margin-top: 2px;
  padding: 2px 0;
  height: auto;
}

.var-hint {
  margin: 0 0 10px 80px;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;

  code {
    color: #e6a23c;
    font-weight: 600;
  }
}

.steps-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 20px;
  color: #909399;
  font-size: 13px;

  p {
    margin: 0;
  }
}

.add-step-btn {
  width: 100%;
  margin-top: 4px;
  border: 1px dashed #c6e2ff;
  border-radius: 8px;
}
</style>

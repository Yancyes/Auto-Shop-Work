<script setup lang="ts">
/**
 * 脚本自定义数据表：一行数据对应一次执行，步骤里写 {{字段名}} 就会被替换。
 * 数据可以在表格里手填，也可以把内置提示词丢给任意 AI，再把它回的一段 JSON/CSV 粘进来。
 */
import { computed, ref, watch } from 'vue'
import type { RecordedScript } from '../../shared/types'
import { buildAiDataPrompt, collectStepVars, parseDataSheet, parseDataText, serializeDataSheet } from '../../shared/script-vars'
import { parseScriptSteps } from '@/utils'

/** 模板里不能直接写 {{...}} 字面量（会被解析成插值），示例统一用常量输出 */
const SAMPLE_FIELD = '{{字段名}}'
const SAMPLE_KEYWORD = '{{关键词}}'

const props = defineProps<{
  visible: boolean
  script: RecordedScript | null
  saving: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: [dataJson: string]
}>()

/** 列 = 步骤里用到的变量名；行 = 一轮执行的数据 */
const columns = ref<string[]>([])
const rows = ref<string[][]>([])
const stepVars = ref<string[]>([])
const pasteText = ref('')
const importMode = ref<'append' | 'replace'>('append')
const promptRowCount = ref(10)

/** 步骤改过之后表里可能留下没人用的列：提示但不自动删，免得用户刚粘的数据被吃掉 */
const unusedColumns = computed(() => columns.value.filter(c => !stepVars.value.includes(c)))
/** 新增的变量还没进表：不补齐的话执行时会被「变量缺少数据」拦住 */
const newColumns = computed(() => stepVars.value.filter(c => !columns.value.includes(c)))

watch(() => props.visible, opened => {
  if (!opened) return
  stepVars.value = collectStepVars(parseScriptSteps(props.script?.stepsJson))
  const sheet = parseDataSheet(props.script?.dataJson)
  columns.value = [...stepVars.value, ...sheet.columns.filter(c => !stepVars.value.includes(c))]
  rows.value = sheet.rows.map(row => columns.value.map(c => row[sheet.columns.indexOf(c)] ?? ''))
  pasteText.value = ''
})

function addRow() {
  rows.value.push(columns.value.map(() => ''))
}

function removeRow(index: number) {
  rows.value.splice(index, 1)
}

function clearRows() {
  rows.value = []
}

function adoptNewColumns() {
  const added = newColumns.value
  if (added.length === 0) return
  columns.value = [...columns.value, ...added]
  rows.value = rows.value.map(row => [...row, ...added.map(() => '')])
  if (rows.value.length === 0) addRow()
}

// ========== 粘贴导入 ==========

function doImport() {
  if (columns.value.length === 0) {
    ElMessage.warning('还没有数据列：先在步骤里把要替换的值写成 {{字段名}}')
    return
  }
  let parsed: string[][]
  try {
    parsed = parseDataText(pasteText.value, columns.value)
  } catch {
    ElMessage.error('无法识别：请确认粘贴的是 JSON 数组，或每行一条数据的文本')
    return
  }
  const filled = parsed.filter(row => row.some(cell => cell !== ''))
  if (filled.length === 0) {
    ElMessage.warning('没有解析到数据行')
    return
  }
  if (importMode.value === 'replace') rows.value = filled
  else rows.value.push(...filled)
  ElMessage.success(`已导入 ${filled.length} 行数据`)
  pasteText.value = ''
}

// ========== AI 取数提示词 ==========

const aiPrompt = computed(() => buildAiDataPrompt(columns.value, promptRowCount.value))

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(aiPrompt.value)
    ElMessage.success('提示词已复制，粘给任意 AI 即可')
  } catch {
    ElMessage.error('复制失败，请手动选中下方文本')
  }
}

/** 全空的行是误操作留下的，留着会让那一轮直接被「变量缺少数据」拦住 */
function submit() {
  const kept = rows.value.filter(row => row.some(cell => cell.trim() !== ''))
  emit('save', serializeDataSheet({ columns: columns.value, rows: kept }))
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`自定义数据 · ${script?.name ?? ''}`"
    width="860px"
    top="6vh"
    class="data-dialog"
    @update:model-value="emit('update:visible', $event as boolean)"
  >
    <div class="data-intro">
      一行数据 = 一次执行。步骤的值或选择器里写
      <code>{{ SAMPLE_FIELD }}</code>
      ，执行时自动替换成当前这一行的数据；行数不够就从头循环，某格留空则回落到执行时填的本次值。
    </div>

    <div v-if="columns.length === 0" class="data-empty">
      <el-icon size="36" color="#dcdfe6"><EditPen /></el-icon>
      <p>这个脚本还没有变量。关掉弹窗，在步骤里把要替换的值改成 <code>{{ SAMPLE_KEYWORD }}</code> 再来。</p>
    </div>

    <template v-else>
      <div class="data-toolbar">
        <div class="col-chips">
          <span v-for="col in columns" :key="col" class="col-chip" :class="{ 'is-unused': !stepVars.includes(col) }">
            {{ col }}
          </span>
        </div>
        <div class="row-ops">
          <el-button size="small" text type="primary" @click="addRow">
            <el-icon><Plus /></el-icon>
            加一行
          </el-button>
          <el-button size="small" text :disabled="rows.length === 0" @click="clearRows">清空</el-button>
        </div>
      </div>

      <el-alert v-if="newColumns.length" type="warning" :closable="false" show-icon class="data-alert">
        步骤里新增了变量 {{ newColumns.join('、') }}，
        <el-button size="small" text type="primary" @click="adoptNewColumns">点这里补进数据表</el-button>
      </el-alert>
      <el-alert v-else-if="unusedColumns.length" type="info" :closable="false" show-icon class="data-alert">
        列 {{ unusedColumns.join('、') }} 已不在步骤中使用，留着不影响执行
      </el-alert>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th class="th-index">#</th>
              <th v-for="col in columns" :key="col">{{ col }}</th>
              <th class="th-op"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="rows.length === 0">
              <td :colspan="columns.length + 2" class="td-empty">
                还没有数据行，点「加一行」手工填，或从下面粘贴 AI 生成的数据
              </td>
            </tr>
            <tr v-for="(row, index) in rows" :key="index">
              <td class="td-index">{{ index + 1 }}</td>
              <td v-for="(col, ci) in columns" :key="col">
                <input v-model="rows[index][ci]" class="cell-input" :placeholder="col" />
              </td>
              <td class="td-op">
                <el-button text size="small" type="danger" title="删除此行" @click="removeRow(index)">
                  <el-icon><Close /></el-icon>
                </el-button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="paste-area">
        <div class="paste-head">
          <span class="paste-title">粘贴 AI 生成的数据</span>
          <el-radio-group v-model="importMode" size="small">
            <el-radio-button value="append">追加</el-radio-button>
            <el-radio-button value="replace">替换</el-radio-button>
          </el-radio-group>
          <el-button size="small" type="primary" plain @click="doImport">导入</el-button>
        </div>
        <el-input
          v-model="pasteText"
          type="textarea"
          :rows="4"
          placeholder='支持 JSON 对象数组、二维数组，或每行一条的 CSV/制表符文本。例如：[{"关键词":"蓝牙耳机","数量":"2"}]'
        />
      </div>

      <el-collapse class="prompt-collapse">
        <el-collapse-item name="prompt">
          <template #title>
            <span class="prompt-title">让 AI 帮我造数据</span>
          </template>
          <div class="prompt-body">
            <div class="prompt-count">
              需要的行数
              <el-input-number v-model="promptRowCount" :min="1" :max="500" size="small" />
              <el-button size="small" type="primary" plain @click="copyPrompt">
                <el-icon><DocumentCopy /></el-icon>
                复制提示词
              </el-button>
            </div>
            <p class="prompt-hint">
              把下面这段连同脚本要做的事一起发给任意 AI（网页版、本地模型都行）。
              它按要求回一段 JSON 后，粘到上面的输入框点「导入」。
            </p>
            <pre class="prompt-text">{{ aiPrompt }}</pre>
          </div>
        </el-collapse-item>
      </el-collapse>
    </template>

    <template #footer>
      <span class="footer-count">共 {{ rows.length }} 行数据</span>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存数据</el-button>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
.data-intro {
  padding: 10px 12px;
  background: #f5f7fa;
  border-radius: 8px;
  font-size: 12px;
  color: #606266;
  line-height: 1.7;

  code { color: #e63946; font-weight: 600; }
}

.data-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 20px;
  color: #909399;
  font-size: 13px;

  code { color: #e63946; }
}

.data-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
}

.col-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.col-chip {
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 12px;
  background: rgba(102, 126, 234, 0.12);
  color: #43539c;

  &.is-unused {
    background: #f0f0f0;
    color: #909399;
    text-decoration: line-through;
  }
}

.data-alert {
  margin-top: 10px;
}

.table-wrap {
  margin-top: 10px;
  max-height: 32vh;
  overflow: auto;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th, td {
    padding: 6px 8px;
    border-bottom: 1px solid #f0f0f0;
    text-align: left;
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: #fafafa;
    color: #606266;
    font-weight: 600;
    white-space: nowrap;
  }

  .th-index, .td-index {
    width: 40px;
    color: #909399;
    text-align: center;
  }

  .th-op, .td-op {
    width: 44px;
    text-align: center;
  }

  .td-empty {
    padding: 24px;
    text-align: center;
    color: #909399;
    font-size: 12px;
  }
}

.cell-input {
  width: 100%;
  min-width: 90px;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  outline: none;
  font-size: 13px;
  color: #303133;
  background: transparent;

  &:hover { border-color: #dcdfe6; }
  &:focus { border-color: #667eea; background: #fff; }
}

.paste-area {
  margin-top: 14px;
}

.paste-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.paste-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.prompt-collapse {
  margin-top: 12px;
  border-top: 1px solid #ebeef5;
}

.prompt-title {
  font-size: 13px;
  font-weight: 600;
  color: #667eea;
}

.prompt-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-count {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #606266;
}

.prompt-hint {
  margin: 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}

.prompt-text {
  margin: 0;
  padding: 10px 12px;
  background: #1f2430;
  color: #d6dbe8;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.footer-count {
  float: left;
  font-size: 12px;
  color: #909399;
  line-height: 32px;
}
</style>

<style lang="scss">
/* el-dialog 会 teleport 到 body，弹窗内部样式得写在全局块里用专属类名限定 */
.data-dialog {
  .el-dialog__body {
    max-height: min(70vh, 640px);
    overflow-y: auto;
  }
}
</style>

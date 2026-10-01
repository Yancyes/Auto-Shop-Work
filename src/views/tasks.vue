<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTaskStore } from '@/stores/task'
import { useTemplateStore } from '@/stores/template'
import { STEP_LABELS, STATUS_MAP, screenshotUrl } from '@/utils'
import type { TaskStatus } from '../../shared/types'

const taskStore = useTaskStore()
const templateStore = useTemplateStore()

const searchKeyword = ref('')
const statusFilter = ref<TaskStatus | ''>('')
const selectedIds = ref<number[]>([])

// 新建任务对话框
const createDialogVisible = ref(false)
const selectedTemplateId = ref<number | null>(null)
const taskCount = ref(1)

const stepLabels = STEP_LABELS

async function openCreateDialog() {
  if (!templateStore.templates.length) {
    await templateStore.loadTemplates()
  }
  createDialogVisible.value = true
}

async function confirmCreate() {
  if (!selectedTemplateId.value) {
    ElMessage.warning('请选择商品模板')
    return
  }
  const res = await taskStore.createTasks(selectedTemplateId.value, taskCount.value)
  if (res.success) {
    ElMessage.success(`已创建 ${taskCount.value} 个任务`)
    createDialogVisible.value = false
    selectedTemplateId.value = null
    taskCount.value = 1
  } else {
    ElMessage.error(res.error || '创建失败')
  }
}

async function refreshList() {
  await taskStore.loadTasks({
    status: statusFilter.value || undefined,
    keyword: searchKeyword.value || undefined
  })
}

async function handleStart(id: number) {
  const res = await taskStore.startTask(id)
  if (res.success) ElMessage.success('任务已启动')
  else ElMessage.error(res.error || '启动失败')
}

async function handlePause(id: number) {
  const res = await taskStore.pauseTask(id)
  if (res.success) ElMessage.success('任务已暂停')
  else ElMessage.error(res.error || '暂停失败')
}

async function handleTerminate(id: number) {
  try {
    await ElMessageBox.confirm('确定终止此任务？', '提示', { type: 'warning' })
    const res = await taskStore.terminateTask(id)
    if (res.success) ElMessage.success('任务已终止')
    else ElMessage.error(res.error || '终止失败')
  } catch {}
}

async function handleRetry(id: number) {
  const res = await taskStore.retryTask(id)
  if (res.success) ElMessage.success('任务已重新入队')
  else ElMessage.error(res.error || '重试失败')
}

async function handleDelete(id: number) {
  try {
    await ElMessageBox.confirm('确定删除此任务？删除后不可恢复', '提示', { type: 'warning' })
    const res = await taskStore.deleteTask(id)
    if (res.success) ElMessage.success('任务已删除')
    else ElMessage.error(res.error || '删除失败')
  } catch {}
}

async function batchDelete() {
  if (!selectedIds.value.length) return ElMessage.warning('请选择任务')
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.length} 个任务？删除后不可恢复`, '提示', { type: 'warning' })
    const res = await taskStore.deleteBatch(selectedIds.value)
    if (res.success) ElMessage.success('批量删除成功')
    else ElMessage.error(res.error || '批量删除失败')
  } catch {}
}

async function batchStart() {
  if (!selectedIds.value.length) return ElMessage.warning('请选择任务')
  const res = await taskStore.startBatch(selectedIds.value)
  if (res.success) ElMessage.success('批量启动成功')
  else ElMessage.error(res.error || '批量启动失败')
}

async function batchPause() {
  if (!selectedIds.value.length) return ElMessage.warning('请选择任务')
  const res = await taskStore.pauseBatch(selectedIds.value)
  if (res.success) ElMessage.success('批量暂停成功')
  else ElMessage.error(res.error || '批量暂停失败')
}

async function batchTerminate() {
  if (!selectedIds.value.length) return ElMessage.warning('请选择任务')
  try {
    await ElMessageBox.confirm('确定终止选中的任务？', '提示', { type: 'warning' })
    const res = await taskStore.terminateBatch(selectedIds.value)
    if (res.success) ElMessage.success('批量终止成功')
    else ElMessage.error(res.error || '批量终止失败')
  } catch {}
}

async function stopAll() {
  try {
    await ElMessageBox.confirm('确定停止所有任务？此操作不可撤销', '危险操作', { type: 'error' })
    const res = await taskStore.stopAll()
    if (res.success) ElMessage.success('已停止所有任务')
    else ElMessage.error(res.error || '停止失败')
  } catch {}
}

function handleSelectionChange(rows: any[]) {
  selectedIds.value = rows.map(r => r.id)
}

onMounted(() => {
  taskStore.loadTasks()
  templateStore.loadTemplates()
})
</script>

<template>
  <div class="task-page">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-button type="primary" @click="openCreateDialog">
          <el-icon><Plus /></el-icon> 新建任务
        </el-button>
        <el-button @click="batchStart" :disabled="!selectedIds.length">批量启动</el-button>
        <el-button @click="batchPause" :disabled="!selectedIds.length">批量暂停</el-button>
        <el-button type="danger" plain @click="batchTerminate" :disabled="!selectedIds.length">批量终止</el-button>
        <el-button type="danger" plain @click="batchDelete" :disabled="!selectedIds.length">批量删除</el-button>
        <el-button type="danger" @click="stopAll">停止全部</el-button>
      </div>
      <div class="toolbar-right">
        <el-select v-model="statusFilter" placeholder="状态筛选" clearable size="small" style="width: 120px" @change="refreshList">
          <el-option label="等待中" value="pending" />
          <el-option label="运行中" value="running" />
          <el-option label="已暂停" value="paused" />
          <el-option label="已完成" value="success" />
          <el-option label="失败" value="failed" />
          <el-option label="待人工" value="waiting_manual" />
        </el-select>
        <el-input v-model="searchKeyword" placeholder="搜索任务..." clearable size="small" style="width: 200px" @change="refreshList" />
        <el-button size="small" @click="refreshList">
          <el-icon><Refresh /></el-icon>
        </el-button>
      </div>
    </div>

    <!-- 任务表格 -->
    <div class="table-container">
      <el-table
        :data="taskStore.tasks"
        border
        stripe
        @selection-change="handleSelectionChange"
        style="width: 100%"
      >
        <el-table-column type="selection" width="40" />
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="productName" label="商品名称" min-width="120" show-overflow-tooltip />
        <el-table-column prop="spec" label="规格" width="100" />
        <el-table-column prop="unitPrice" label="单价" width="80">
          <template #default="{ row }">¥{{ row.unitPrice }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="STATUS_MAP[row.status]?.type" size="small">{{ STATUS_MAP[row.status]?.label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="140">
          <template #default="{ row }">
            <el-progress :percentage="row.progress" :status="row.status === 'failed' ? 'exception' : row.status === 'success' ? 'success' : undefined" :stroke-width="10" />
          </template>
        </el-table-column>
        <el-table-column prop="currentStep" label="当前步骤" width="100">
          <template #default="{ row }">{{ stepLabels[row.currentStep] || '-' }}</template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="160" />
        <el-table-column prop="completedAt" label="完成时间" width="160">
          <template #default="{ row }">{{ row.completedAt || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button text size="small" @click="taskStore.showDetail(row.id)">详情</el-button>
            <el-button text size="small" type="success" v-if="row.status === 'pending' || row.status === 'paused' || row.status === 'waiting_manual'" @click="handleStart(row.id)">启动</el-button>
            <el-button text size="small" type="warning" v-if="row.status === 'running'" @click="handlePause(row.id)">暂停</el-button>
            <el-button text size="small" type="danger" v-if="row.status === 'running' || row.status === 'paused' || row.status === 'waiting_manual'" @click="handleTerminate(row.id)">终止</el-button>
            <el-button text size="small" type="primary" v-if="row.status === 'failed'" @click="handleRetry(row.id)">重试</el-button>
            <el-button text size="small" type="danger" @click="handleDelete(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 底部详情抽屉 -->
    <el-drawer v-model="taskStore.detailDrawerVisible" title="任务详情" size="50%">
      <template v-if="taskStore.currentTask">
        <div class="detail-content">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="任务 ID">{{ taskStore.currentTask.id }}</el-descriptions-item>
            <el-descriptions-item label="商品名称">{{ taskStore.currentTask.productName }}</el-descriptions-item>
            <el-descriptions-item label="规格">{{ taskStore.currentTask.spec }}</el-descriptions-item>
            <el-descriptions-item label="单价">¥{{ taskStore.currentTask.unitPrice }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="STATUS_MAP[taskStore.currentTask.status]?.type">{{ STATUS_MAP[taskStore.currentTask.status]?.label }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="进度">{{ taskStore.currentTask.progress }}%</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ taskStore.currentTask.createdAt }}</el-descriptions-item>
            <el-descriptions-item label="完成时间">{{ taskStore.currentTask.completedAt || '-' }}</el-descriptions-item>
            <el-descriptions-item label="失败原因" :span="2" v-if="taskStore.currentTask.failReason">
              <span class="text-danger">{{ taskStore.currentTask.failReason }}</span>
            </el-descriptions-item>
          </el-descriptions>

          <div class="detail-section" v-if="taskStore.currentTask.resultScreenshot">
            <h4>结果截图</h4>
            <img :src="screenshotUrl(taskStore.currentTask.resultScreenshot)" class="result-screenshot" />
          </div>
        </div>
      </template>
    </el-drawer>

    <!-- 新建任务对话框 -->
    <el-dialog v-model="createDialogVisible" title="新建上架任务" width="480px">
      <el-form label-width="100px">
        <el-form-item label="选择模板">
          <el-select v-model="selectedTemplateId" placeholder="请选择商品模板" style="width: 100%">
            <el-option
              v-for="t in templateStore.templates"
              :key="t.id"
              :label="`${t.name} (${t.quantity}${t.unit} ¥${t.unitPrice})`"
              :value="t.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="发布数量">
          <el-input-number v-model="taskCount" :min="1" :max="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.task-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #fff;
  border-radius: 8px;
  margin-bottom: 12px;

  .toolbar-left, .toolbar-right { display: flex; gap: 8px; align-items: center; }
}

.table-container {
  flex: 1;
  background: #fff;
  border-radius: 8px;
  overflow: auto;
}

.detail-content { padding: 0 20px 20px; }

.detail-section {
  margin-top: 20px;
  h4 { margin-bottom: 12px; color: #303133; }
}

.result-screenshot {
  width: 100%;
  border-radius: 8px;
  border: 1px solid #ebeef5;
}
</style>

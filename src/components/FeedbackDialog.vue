<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ipc } from '@/api'

const visible = ref(false)
const content = ref('')
const contact = ref('')
const sending = ref(false)

function open() {
  visible.value = true
  content.value = ''
  contact.value = ''
}

async function handleSubmit() {
  if (!content.value.trim()) {
    ElMessage.warning('请输入反馈内容')
    return
  }
  if (content.value.trim().length < 5) {
    ElMessage.warning('反馈内容至少 5 个字符')
    return
  }

  if (!contact.value.trim()) {
    ElMessage.warning('请输入联系邮箱')
    return
  }

  sending.value = true
  try {
    const res = await ipc.invoke('feedback:send', {
      content: content.value.trim(),
      contact: contact.value.trim()
    })
    if (res.success) {
      ElMessage.success('反馈已发送，感谢您的建议！')
      visible.value = false
    } else {
      ElMessage.error(res.error || '发送失败，请稍后重试')
    }
  } catch {
    ElMessage.error('网络异常，请稍后重试')
  } finally {
    sending.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <el-dialog
    v-model="visible"
    title=""
    width="500px"
    :close-on-click-modal="!sending"
    class="feedback-dialog"
  >
    <div class="feedback-header">
      <el-icon size="28" color="#ff6b35"><ChatDotRound /></el-icon>
      <div>
        <h3>功能建议</h3>
        <p>您的建议将直接发送到开发者邮箱，请填写有效邮箱以便回复</p>
      </div>
    </div>

    <el-form label-position="top" class="feedback-form">
      <el-form-item label="建议内容" required>
        <el-input
          v-model="content"
          type="textarea"
          :rows="5"
          maxlength="1000"
          show-word-limit
          :disabled="sending"
        />
      </el-form-item>
      <el-form-item label="联系邮箱" required>
        <el-input
          v-model="contact"
          placeholder="请输入邮箱地址"
          :disabled="sending"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false" :disabled="sending">取消</el-button>
      <el-button
        type="primary"
        class="btn-primary"
        :loading="sending"
        @click="handleSubmit"
      >
        {{ sending ? '发送中...' : '发送反馈' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
:deep(.el-dialog) {
  border-radius: 16px;
  overflow: hidden;

  .el-dialog__header {
    display: none;
  }

  .el-dialog__body {
    padding: 24px 24px 8px;
  }

  .el-dialog__footer {
    padding: 0 24px 24px;
  }
}

.feedback-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #1a1a1a;
  }

  p {
    margin: 4px 0 0;
    font-size: 12px;
    color: #909399;
  }
}

.feedback-form {
  :deep(.el-form-item__label) {
    font-weight: 500;
    color: #606266;
  }

  :deep(.el-textarea__inner) {
    border-radius: 8px;
  }

  :deep(.el-input__wrapper) {
    border-radius: 8px;
  }
}
</style>

<script setup lang="ts">
import { ref, onUnmounted, watch, nextTick } from 'vue'
import { useBrowserViewStore } from '@/stores/browser-view'
import { ElMessage } from 'element-plus'

const store = useBrowserViewStore()

const panelRef = ref<HTMLElement>()
const isDragging = ref(false)
const isResizing = ref(false)
const dragOffset = ref({ x: 0, y: 0 })
const commandInput = ref('')
const commandResult = ref('')
const showCommandDialog = ref(false)

// 元素拾取 canvas
const canvasRef = ref<HTMLCanvasElement>()
const containerRef = ref<HTMLDivElement>()

// 拖拽处理
function handleDragStart(e: MouseEvent) {
  isDragging.value = true
  const rect = panelRef.value?.getBoundingClientRect()
  if (rect) {
    dragOffset.value = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
  }
  e.preventDefault()
}

function handleMouseMove(e: MouseEvent) {
  if (isDragging.value) {
    const x = e.clientX - dragOffset.value.x
    const y = e.clientY - dragOffset.value.y
    store.updatePosition(x, y)
  } else if (isResizing.value) {
    const rect = panelRef.value?.getBoundingClientRect()
    if (rect) {
      const width = Math.max(400, e.clientX - rect.left)
      const height = Math.max(300, e.clientY - rect.top)
      store.updateSize(width, height)
    }
  }
}

function handleDragEnd() {
  isDragging.value = false
  isResizing.value = false
}

function handleResizeStart(e: MouseEvent) {
  isResizing.value = true
  e.preventDefault()
  e.stopPropagation()
}

// 命令执行
async function executeCommand() {
  if (!commandInput.value.trim()) return
  try {
    const cmd = commandInput.value.trim()
    const parts = cmd.split(' ')
    const action = parts[0]
    const paramsStr = parts.slice(1).join(' ')

    let params: any = {}
    try {
      params = JSON.parse(paramsStr)
    } catch {
      // 如果不是 JSON，尝试解析为简单参数
      if (action === 'click' || action === 'fill') {
        const selectorParts = paramsStr.split(' ')
        params.selector = selectorParts[0]
        if (action === 'fill' && selectorParts[1]) {
          params.value = selectorParts.slice(1).join(' ')
        }
      } else if (action === 'navigate') {
        params.url = paramsStr
      } else if (action === 'press') {
        params.key = paramsStr
      }
    }

    const res = await store.executeAction(action, params)
    if (res && res.success) {
      commandResult.value = JSON.stringify(res.data, null, 2)
    } else if (res && res.error) {
      commandResult.value = `错误: ${res.error}`
    }
  } catch (e) {
    commandResult.value = `执行失败: ${(e as Error).message}`
  }
}

// 快捷操作
async function quickClick() {
  const selector = prompt('请输入要点击的元素选择器:')
  if (selector) {
    const res = await store.executeAction('click', { selector })
    if (res && res.success) ElMessage.success('点击成功')
    else if (res && res.error) ElMessage.error(res.error || '点击失败')
  }
}

async function quickFill() {
  const selector = prompt('请输入要填充的元素选择器:')
  if (selector) {
    const value = prompt('请输入要填充的值:')
    if (value) {
      const res = await store.executeAction('fill', { selector, value })
      if (res && res.success) ElMessage.success('填充成功')
      else if (res && res.error) ElMessage.error(res.error || '填充失败')
    }
  }
}

async function quickNavigate() {
  const url = prompt('请输入要导航的 URL:')
  if (url) {
    const res = await store.executeAction('navigate', { url })
    if (res && res.success) ElMessage.success('导航成功')
    else if (res && res.error) ElMessage.error(res.error || '导航失败')
  }
}

// ========== 元素拾取 canvas ==========
function drawOverlay() {
  const canvas = canvasRef.value
  if (!canvas || !store.pickerActive) return

  const container = containerRef.value
  if (!container) return

  const img = container.querySelector('img')
  if (!img) return

  canvas.width = img.clientWidth
  canvas.height = img.clientHeight
  canvas.style.left = img.offsetLeft + 'px'
  canvas.style.top = img.offsetTop + 'px'

  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  for (const el of store.pickerElements) {
    const x = el.x * canvas.width
    const y = el.y * canvas.height
    const w = el.width * canvas.width
    const h = el.height * canvas.height

    const isSelected = store.selectedElements.some(e => e.index === el.index)
    const isHovered = store.hoverIndex === el.index

    if (isSelected) {
      ctx.fillStyle = 'rgba(103, 194, 58, 0.25)'
      ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = '#67c23a'
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, w, h)
    } else if (isHovered) {
      ctx.fillStyle = 'rgba(64, 158, 255, 0.2)'
      ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = '#409eff'
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, w, h)
    }

    ctx.fillStyle = isSelected ? '#67c23a' : '#409eff'
    ctx.font = 'bold 11px sans-serif'
    const text = String(el.index)
    const tw = ctx.measureText(text).width + 8
    ctx.fillRect(x, y - 16, tw, 16)
    ctx.fillStyle = '#fff'
    ctx.fillText(text, x + 4, y - 4)
  }
}

function handleCanvasMouseMove(e: MouseEvent) {
  if (!store.pickerActive || !canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  let found = -1
  for (const el of store.pickerElements) {
    const x = el.x * canvasRef.value.width
    const y = el.y * canvasRef.value.height
    const w = el.width * canvasRef.value.width
    const h = el.height * canvasRef.value.height
    if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
      found = el.index
      break
    }
  }

  if (found !== store.hoverIndex) {
    store.hoverIndex = found
    drawOverlay()
  }
}

function handleCanvasClick(e: MouseEvent) {
  if (!store.pickerActive || !canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  for (const el of store.pickerElements) {
    const x = el.x * canvasRef.value.width
    const y = el.y * canvasRef.value.height
    const w = el.width * canvasRef.value.width
    const h = el.height * canvasRef.value.height
    if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
      store.selectElement(el)
      ElMessage.success(`已选择: ${el.selector}`)
      drawOverlay()
      return
    }
  }
}

function handleCanvasMouseLeave() {
  if (store.hoverIndex !== -1) {
    store.hoverIndex = -1
    drawOverlay()
  }
}

async function togglePicker() {
  if (store.pickerMode) {
    await store.exitPickerMode()
  } else {
    await store.enterPickerMode()
  }
  await nextTick()
  drawOverlay()
}

function copySelectedSelectors() {
  const selectors = store.selectedElements.map(e => e.selector).join('\n')
  navigator.clipboard.writeText(selectors).then(() => {
    ElMessage.success('选择器已复制到剪贴板')
  }).catch(() => {
    ElMessage.error('复制失败')
  })
}

// 监听拾取元素变化，重绘 overlay
watch([() => store.pickerElements, () => store.pickerMode, () => store.screenshot], () => {
  if (store.pickerActive) {
    nextTick(() => drawOverlay())
  }
})

// 监听可见性变化
watch(() => store.isVisible, (visible) => {
  if (visible) {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleDragEnd)
  } else {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleDragEnd)
  }
})

onUnmounted(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleDragEnd)
})
</script>

<template>
  <div
    v-if="store.isVisible"
    ref="panelRef"
    class="browser-view-panel"
    :style="{
      left: store.position.x + 'px',
      top: store.position.y + 'px',
      width: store.size.width + 'px',
      height: store.size.height + 'px'
    }"
  >
    <!-- 标题栏（可拖拽） -->
    <div class="panel-header" @mousedown="handleDragStart">
      <div class="header-left">
        <el-icon><Monitor /></el-icon>
        <span>浏览器监控</span>
      </div>
      <div class="header-right">
        <el-button text size="small" @click="store.loadPages">
          <el-icon><Refresh /></el-icon>
        </el-button>
        <el-button text size="small" @click="store.captureScreenshot">
          <el-icon><Camera /></el-icon>
        </el-button>
        <el-button text size="small" :type="store.pickerMode ? 'warning' : undefined" @click="togglePicker">
          <el-icon><Pointer /></el-icon>
        </el-button>
        <el-button text size="small" @click="showCommandDialog = true">
          <el-icon><Operation /></el-icon>
        </el-button>
        <el-button text size="small" @click="store.toggle">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
    </div>

    <!-- 页面选择器 -->
    <div class="panel-toolbar">
      <el-select
        v-model="store.selectedPageIndex"
        placeholder="选择页面"
        size="small"
        style="width: 100%"
        @change="store.captureScreenshot"
      >
        <el-option
          v-for="(page, index) in store.pages"
          :key="page.id"
          :label="page.title || page.url"
          :value="index"
        />
      </el-select>
    </div>

    <!-- 截图显示区域 -->
    <div class="panel-content">
      <div v-if="store.screenshot" ref="containerRef" class="screenshot-container">
        <img :src="store.screenshot" class="screenshot-image" @load="drawOverlay" />
        <canvas
          v-if="store.pickerActive"
          ref="canvasRef"
          class="picker-overlay"
          @mousemove="handleCanvasMouseMove"
          @click="handleCanvasClick"
          @mouseleave="handleCanvasMouseLeave"
        />
        <!-- 悬停元素提示 -->
        <div
          v-if="store.hoverIndex >= 0 && store.pickerActive"
          class="picker-tooltip"
        >
          <div class="tooltip-tag">{{ store.pickerElements[store.hoverIndex]?.tag }}</div>
          <div class="tooltip-text">{{ store.pickerElements[store.hoverIndex]?.text || '(无文本)' }}</div>
          <div class="tooltip-sel">{{ store.pickerElements[store.hoverIndex]?.selector }}</div>
        </div>
      </div>
      <el-empty v-else description="暂无截图" :image-size="80" />
    </div>

    <!-- 元素拾取模式：已选元素列表 -->
    <div v-if="store.pickerMode" class="picker-panel">
      <div class="picker-panel-header">
        <span>已选元素 ({{ store.selectedElements.length }})</span>
        <div>
          <el-button size="small" text @click="copySelectedSelectors" :disabled="store.selectedElements.length === 0">
            复制选择器
          </el-button>
          <el-button size="small" text type="danger" @click="store.clearSelectedElements" :disabled="store.selectedElements.length === 0">
            清空
          </el-button>
        </div>
      </div>
      <div class="picker-panel-list">
        <div
          v-for="el in store.selectedElements"
          :key="el.index"
          class="picker-element-item"
        >
          <div class="picker-element-info">
            <el-tag size="small" type="info">{{ el.tag }}</el-tag>
            <span class="picker-element-text">{{ el.text || '(无文本)' }}</span>
            <span class="picker-element-sel">{{ el.selector }}</span>
          </div>
          <el-button text size="small" type="danger" @click="store.removeElement(el.index)">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
        <div v-if="store.selectedElements.length === 0" class="picker-empty">
          点击页面中的元素以选择
        </div>
      </div>
    </div>

    <!-- 快捷操作栏 -->
    <div v-if="!store.pickerMode" class="panel-actions">
      <el-button size="small" @click="quickClick">点击</el-button>
      <el-button size="small" @click="quickFill">填充</el-button>
      <el-button size="small" @click="quickNavigate">导航</el-button>
      <el-button size="small" @click="store.executeAction('scroll', { direction: 'down' })">向下滚动</el-button>
      <el-button size="small" @click="store.executeAction('scroll', { direction: 'up' })">向上滚动</el-button>
    </div>

    <!-- 调整大小手柄 -->
    <div class="resize-handle" @mousedown="handleResizeStart"></div>

    <!-- 命令对话框 -->
    <el-dialog v-model="showCommandDialog" title="执行命令" width="500px">
      <el-form label-width="80px">
        <el-form-item label="命令">
          <el-input
            v-model="commandInput"
            placeholder="例如: click {&quot;selector&quot;: &quot;#btn&quot;}"
            @keyup.enter="executeCommand"
          />
        </el-form-item>
        <el-form-item label="结果">
          <el-input
            v-model="commandResult"
            type="textarea"
            :rows="4"
            readonly
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCommandDialog = false">关闭</el-button>
        <el-button type="primary" @click="executeCommand">执行</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.browser-view-panel {
  position: fixed;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 9999;
  min-width: 400px;
  min-height: 300px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  cursor: move;
  user-select: none;

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
  }

  .header-right {
    display: flex;
    gap: 4px;

    :deep(.el-button) {
      color: #fff;
      &:hover {
        background: rgba(255, 255, 255, 0.2);
      }
    }
  }
}

.panel-toolbar {
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
}

.panel-content {
  flex: 1;
  overflow: auto;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
}

.screenshot-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  position: relative;
}

.screenshot-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
}

.picker-overlay {
  position: absolute;
  cursor: crosshair;
  z-index: 10;
}

.picker-tooltip {
  position: absolute;
  bottom: 12px;
  left: 12px;
  background: rgba(0, 0, 0, 0.85);
  color: #fff;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  z-index: 20;
  max-width: 300px;
  pointer-events: none;

  .tooltip-tag {
    color: #409eff;
    font-weight: bold;
    margin-bottom: 2px;
  }

  .tooltip-text {
    color: #ccc;
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tooltip-sel {
    color: #67c23a;
    font-family: monospace;
    font-size: 11px;
    word-break: break-all;
  }
}

.picker-panel {
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
  max-height: 180px;
  overflow-y: auto;

  .picker-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 600;
    border-bottom: 1px solid #eee;
    position: sticky;
    top: 0;
    background: #fafafa;
    z-index: 1;
  }

  .picker-panel-list {
    padding: 4px 0;
  }

  .picker-element-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px;
    gap: 8px;

    &:hover {
      background: #f0f7ff;
    }
  }

  .picker-element-info {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    flex: 1;
  }

  .picker-element-text {
    font-size: 12px;
    color: #606266;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .picker-element-sel {
    font-size: 11px;
    color: #909399;
    font-family: monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }

  .picker-empty {
    padding: 12px;
    text-align: center;
    color: #909399;
    font-size: 13px;
  }
}

.panel-actions {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
  flex-wrap: wrap;
}

.resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 20px;
  height: 20px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, #dcdfe6 50%);
  border-radius: 0 0 8px 0;
}
</style>

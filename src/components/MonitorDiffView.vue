<script setup lang="ts">
/**
 * 差异热区视图：把「现在这一帧」和「哪些块变了」叠在一起显示。
 * 主进程只在命中时才回传热区与截图，所以这里要能在两者缺失时只报比例。
 */
import { ref, watch, nextTick, onMounted } from 'vue'

const props = withDefaults(defineProps<{
  /** 当前帧 PNG dataURL */
  snapshot?: string
  /** 行优先的 0/1 位图 */
  blocks?: number[]
  blocksX?: number
  blocksY?: number
}>(), {
  snapshot: '',
  blocks: () => [],
  blocksX: 0,
  blocksY: 0
})

const canvasRef = ref<HTMLCanvasElement | null>(null)

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const { blocks, blocksX, blocksY } = props
  if (blocksX <= 0 || blocksY <= 0) return
  canvas.width = blocksX
  canvas.height = blocksY
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, blocksX, blocksY)
  ctx.fillStyle = 'rgba(239, 68, 68, 0.75)'
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i]) continue
    // 一块一个像素：靠 CSS 放大 + pixelated 渲染，几百 KB 的图也不用重绘路径
    ctx.fillRect(i % blocksX, Math.floor(i / blocksX), 1, 1)
  }
}

watch(() => [props.blocks, props.blocksX, props.blocksY, props.snapshot], async () => {
  await nextTick()
  draw()
})
onMounted(draw)

const hasHotZone = () => props.blocksX > 0 && props.blocksY > 0 && props.blocks.some(b => b)
</script>

<template>
  <div class="diff-view">
    <div v-if="snapshot" class="diff-frame">
      <!-- 内层按图片实际显示尺寸收box，热区画布才能严丝合缝地叠上去 -->
      <div class="diff-inner">
        <img :src="snapshot" alt="当前画面" />
        <canvas v-if="blocksX > 0 && blocksY > 0" ref="canvasRef" :class="{ 'is-hidden': !hasHotZone() }" />
      </div>
    </div>
    <div v-else class="diff-empty">
      <el-icon><Picture /></el-icon>
      <span>画面未变化时不回传截图，命中后这里会显示当时的画面与热区</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.diff-view {
  width: 100%;
}

.diff-frame {
  border-radius: 6px;
  overflow: hidden;
  background: #f5f7fa;
}

.diff-inner {
  position: relative;
  display: inline-block;
  max-width: 100%;
  line-height: 0;

  img {
    display: block;
    max-width: 100%;
    max-height: 240px;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
    pointer-events: none;

    &.is-hidden {
      display: none;
    }
  }
}

.diff-empty {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
</style>

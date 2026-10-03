<script setup lang="ts">
/**
 * 屏幕区域监控面板：一个脚本可以挂多块区域，各自独立判定。
 * 「框选屏幕区域 → 存基准图（也可上传一张现成截图）→ 设阈值/关键词 → 先试测一次」
 * 是这里唯一的操作路径，缺哪一步就直接在卡片上写出来，不留到执行时才静默无效。
 */
import { computed, ref } from 'vue'
import MonitorDiffView from './MonitorDiffView.vue'
import { useMonitorPanel } from '@/composables/useMonitorPanel'
import { monitorProblems } from '../../shared/monitor-config'
import { MAX_MONITOR_INTERVAL_MS, MIN_MONITOR_INTERVAL_MS } from '../../shared/constants'
import type { MonitorStatus, RegionMonitor } from '../../shared/types'

const props = withDefaults(defineProps<{
  modelValue: RegionMonitor[]
  /** 执行/排队中不改监控配置：区域和基准图变了判定就没有意义 */
  locked?: boolean
  /** 执行中的实时巡检结果，按 monitorId 对到各卡片上 */
  statuses?: MonitorStatus[]
}>(), {
  locked: false,
  statuses: () => []
})

const emit = defineEmits<{ 'update:modelValue': [RegionMonitor[]] }>()

const monitors = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const {
  picking, busy, probing, baselinePreview, shotPreview, probeResults,
  add, removeAt, pickRect, captureBaseline, uploadBaseline, loadBaseline, probe
} = useMonitorPanel(monitors)

const SOURCE_OPTIONS = [
  { label: '屏幕像素比对', value: 'screen' },
  { label: '页面文字关键词', value: 'page' },
  { label: '两者都跑', value: 'auto' }
]

/** 上传基准图：一个隐藏 input 服务全部卡片，先记住是哪块区域要换基准 */
const fileInputRef = ref<HTMLInputElement | null>(null)
let uploadTarget: RegionMonitor | null = null

function chooseUploadFile(monitor: RegionMonitor) {
  uploadTarget = monitor
  fileInputRef.value?.click()
}

async function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const target = uploadTarget
  input.value = ''
  uploadTarget = null
  if (!file || !target) return
  await uploadBaseline(target, file)
}

function statusOf(monitorId: string): MonitorStatus | undefined {
  return props.statuses.find(s => s.monitorId === monitorId)
}

function ratioText(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`
}

function rectText(monitor: RegionMonitor): string {
  const r = monitor.rect
  if (!r) return '未框选'
  return `(${r.x}, ${r.y}) ${r.width}×${r.height}`
}
</script>

<template>
  <div class="monitor-panel">
    <div class="panel-head">
      <span class="panel-title">
        <el-icon><View /></el-icon>
        监控区域
        <el-tag v-if="monitors.length" size="small" round>{{ monitors.length }}</el-tag>
      </span>
      <el-button v-if="!locked" type="primary" size="small" plain @click="add">
        <el-icon><Plus /></el-icon>
        添加区域
      </el-button>
    </div>

    <div class="panel-tip">
      脚本执行时按这里的设置巡检：区域数据一变就暂停等接管，或只记日志继续。
    </div>

    <div v-if="monitors.length === 0" class="monitors-empty">
      <el-icon size="36" color="#dcdfe6"><View /></el-icon>
      <p>还没有监控区域。点「添加区域」，再框选屏幕上要看的那块数据。</p>
    </div>

    <div v-for="(monitor, index) in monitors" :key="monitor.id" class="monitor-card">
      <div class="card-row">
        <el-input v-model="monitor.label" size="small" class="label-input" :disabled="locked" placeholder="区域名称" />
        <el-select v-model="monitor.source" size="small" class="source-select" :disabled="locked">
          <el-option v-for="opt in SOURCE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-button v-if="!locked" text type="danger" size="small" title="删除这个区域" @click="removeAt(index)">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>

      <div class="card-row">
        <span class="row-label">屏幕区域</span>
        <span class="rect-text" :title="rectText(monitor)">{{ rectText(monitor) }}</span>
        <el-button size="small" :disabled="locked || picking" :loading="picking" @click="pickRect(monitor)">
          框选区域
        </el-button>
      </div>

      <div class="card-row" v-if="monitor.source !== 'page'">
        <span class="row-label">基准图</span>
        <el-button size="small" :disabled="locked || busy[monitor.id]" @click="captureBaseline(monitor)">
          截取当前区域
        </el-button>
        <el-button size="small" :disabled="locked || busy[monitor.id]" @click="chooseUploadFile(monitor)">
          上传图片
        </el-button>
        <el-button v-if="monitor.baselineFile" size="small" text type="primary" @click="loadBaseline(monitor)">
          查看基准
        </el-button>
        <el-tag v-else size="small" type="info" effect="plain">未存基准</el-tag>
      </div>

      <div class="card-row" v-if="monitor.source !== 'screen'">
        <span class="row-label">关键词</span>
        <el-select
          :model-value="monitor.appear ?? []"
          @update:model-value="(value: string[]) => (monitor.appear = value)"
          multiple filterable allow-create default-first-option
          size="small" class="keyword-select" :disabled="locked"
          placeholder="出现即命中，回车确认"
        />
        <el-select
          :model-value="monitor.disappear ?? []"
          @update:model-value="(value: string[]) => (monitor.disappear = value)"
          multiple filterable allow-create default-first-option
          size="small" class="keyword-select" :disabled="locked"
          placeholder="消失即命中，回车确认"
        />
      </div>

      <div class="card-row">
        <span class="row-label">变化阈值</span>
        <el-input-number
          v-model="monitor.hitRatio"
          :min="0.01" :max="1" :step="0.01" :precision="2"
          size="small" :disabled="locked"
          title="区域内变动的块占比达到多少算「数据变了」"
        />
        <span class="row-label">轮询(ms)</span>
        <el-input-number
          v-model="monitor.intervalMs"
          :min="MIN_MONITOR_INTERVAL_MS" :max="MAX_MONITOR_INTERVAL_MS" :step="500"
          size="small" :disabled="locked"
        />
      </div>

      <div class="card-row">
        <span class="row-label">命中后</span>
        <el-radio-group v-model="monitor.onChange" size="small" :disabled="locked">
          <el-radio-button value="pause">暂停等我接管</el-radio-button>
          <el-radio-button value="log">只记日志继续跑</el-radio-button>
        </el-radio-group>
      </div>

      <el-alert
        v-for="problem in monitorProblems(monitor)"
        :key="problem"
        type="warning"
        :closable="false"
        show-icon
        class="problem"
      >
        {{ problem }}
      </el-alert>

      <div class="card-row">
        <el-button size="small" :loading="probing[monitor.id]" @click="probe(monitor)">
          立即试测一次
        </el-button>
        <template v-if="probeResults[monitor.id]">
          <!-- note 表示这一轮什么都没判定，不能再显示「未达阈值」让用户以为监控没问题 -->
          <span v-if="probeResults[monitor.id].note" class="probe-note">
            {{ probeResults[monitor.id].note }}
          </span>
          <template v-else>
            <el-tag size="small" :type="probeResults[monitor.id].hit ? 'danger' : 'success'" effect="plain">
              {{ probeResults[monitor.id].hit ? '会命中' : '未达阈值' }}
            </el-tag>
            <span class="ratio-text">变化占比 {{ ratioText(probeResults[monitor.id].ratio) }}</span>
          </template>
        </template>
      </div>

      <div v-if="probeResults[monitor.id] && !probeResults[monitor.id].note" class="hit-detail">
        <span v-if="probeResults[monitor.id].appeared?.length">
          新出现：{{ probeResults[monitor.id].appeared?.join('、') }}
        </span>
        <span v-if="probeResults[monitor.id].disappeared?.length">
          已消失：{{ probeResults[monitor.id].disappeared?.join('、') }}
        </span>
      </div>

      <MonitorDiffView
        v-if="shotPreview[monitor.id]"
        :snapshot="shotPreview[monitor.id]"
        :blocks="probeResults[monitor.id]?.blocks"
        :blocks-x="probeResults[monitor.id]?.blocksX"
        :blocks-y="probeResults[monitor.id]?.blocksY"
      />

      <div v-if="baselinePreview[monitor.id]" class="baseline-preview">
        <div class="preview-title">基准图</div>
        <img :src="baselinePreview[monitor.id]" alt="基准图" />
      </div>

      <!-- 执行中的实时状态：不用保存脚本也能看出这块是不是真的在被盯 -->
      <div v-if="statusOf(monitor.id)" class="live-row">
        <el-tag size="small" :type="statusOf(monitor.id)!.hit ? 'danger' : 'info'" effect="plain">
          实时 {{ statusOf(monitor.id)!.hit ? '已命中' : '巡检中' }} · {{ ratioText(statusOf(monitor.id)!.ratio) }}
        </el-tag>
        <MonitorDiffView
          v-if="statusOf(monitor.id)!.snapshot"
          :snapshot="statusOf(monitor.id)!.snapshot"
          :blocks="statusOf(monitor.id)!.blocks"
          :blocks-x="statusOf(monitor.id)!.blocksX"
          :blocks-y="statusOf(monitor.id)!.blocksY"
        />
      </div>
    </div>

    <input ref="fileInputRef" type="file" accept="image/*" class="hidden-file" @change="onFilePicked" />
  </div>
</template>

<style scoped lang="scss">
.monitor-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding: 12px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;

  .panel-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 15px;
    font-weight: 600;
    color: #303133;
  }
}

.panel-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}

.monitors-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 30px 16px;
  color: #909399;
  font-size: 13px;
  text-align: center;

  p {
    margin: 0;
  }
}

.monitor-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  background: #fff;
}

.card-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;

  .row-label {
    font-size: 12px;
    color: #909399;
    flex-shrink: 0;
  }

  .label-input {
    width: 150px;
  }

  .source-select {
    width: 150px;
  }

  .keyword-select {
    width: 180px;
  }

  .rect-text {
    font-size: 12px;
    color: #606266;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ratio-text {
    font-size: 12px;
    color: #606266;
  }

  .probe-note {
    font-size: 12px;
    color: #e6a23c;
  }
}

.problem {
  padding: 4px 8px;
}

.hit-detail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: #e6a23c;
}

.baseline-preview {
  .preview-title {
    font-size: 12px;
    color: #909399;
    margin-bottom: 4px;
  }

  img {
    display: block;
    max-width: 100%;
    max-height: 200px;
    border-radius: 6px;
    border: 1px solid #ebeef5;
  }
}

.live-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.hidden-file {
  display: none;
}
</style>

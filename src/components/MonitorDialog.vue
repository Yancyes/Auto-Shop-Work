<script setup lang="ts">
/**
 * 已保存脚本的监控区域弹窗：编辑副本，落库由父级完成，取消即丢弃。
 * 基准图文件是按监控项 id 存的，删除只在这里标记，保存成功后才由主进程清理文件。
 * 脚本正在执行时不给编辑：那会儿巡检正拿这些 id 的基准图比对着，改区域或换基准
 * 会让当前这轮的判定变成噪声，配置本身也要等下一次执行才生效。
 */
import { computed, ref, watch } from 'vue'
import MonitorPanel from './MonitorPanel.vue'
import { useScriptStore } from '@/stores/script'
import { monitorProblems, parseMonitors } from '../../shared/monitor-config'
import type { RecordedScript, RegionMonitor } from '../../shared/types'

const props = defineProps<{
  visible: boolean
  script: RecordedScript | null
  saving: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: [monitors: RegionMonitor[]]
}>()

const scriptStore = useScriptStore()
const busy = computed(() => scriptStore.progresses.has(props.script?.id ?? -1))

const monitors = ref<RegionMonitor[]>([])

watch(() => props.visible, opened => {
  if (!opened) return
  // 深拷贝：区域矩形和关键词数组是嵌套对象，直接改会污染列表里的原记录
  monitors.value = parseMonitors(props.script?.monitorJson).map(m => ({
    ...m,
    rect: m.rect ? { ...m.rect } : undefined,
    appear: [...(m.appear ?? [])],
    disappear: [...(m.disappear ?? [])]
  }))
})

function submit() {
  if (busy.value) {
    ElMessage.warning('这个脚本正在执行，等这一轮结束再改监控')
    return
  }
  const firstProblem = monitors.value.flatMap(monitorProblems)[0]
  if (firstProblem) {
    ElMessage.warning(`有区域还没配置完整：${firstProblem}`)
    return
  }
  emit('save', monitors.value)
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`监控区域 · ${script?.name ?? ''}`"
    width="720px"
    top="6vh"
    :close-on-click-modal="false"
    @update:model-value="(value: boolean) => emit('update:visible', value)"
  >
    <div class="monitor-body">
      <el-alert v-if="busy" type="warning" :closable="false" show-icon class="busy-tip">
        脚本正在执行，巡检正按这些区域的基准图判定，所以执行期间只能看不能改。
      </el-alert>
      <MonitorPanel v-model="monitors" :locked="busy" />
    </div>
    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="busy" @click="submit">保存监控</el-button>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
.monitor-body {
  max-height: 62vh;
  overflow-y: auto;
  margin: 0 -12px;

  .busy-tip {
    margin: 0 12px 10px;
  }
}
</style>

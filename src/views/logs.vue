<script setup lang="ts">
import { ref } from 'vue'
import LogListPanel from '@/components/LogListPanel.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'

const activeTab = ref('logs')
</script>

<template>
  <div class="logs-page">
    <el-tabs v-model="activeTab" class="page-tabs">
      <el-tab-pane label="运行日志" name="logs">
        <LogListPanel />
      </el-tab-pane>
      <el-tab-pane label="系统设置" name="settings">
        <SettingsPanel />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped lang="scss">
.logs-page { height: 100%; }

.page-tabs {
  height: 100%;
  background: #fff;
  border-radius: 8px;
  padding: 0 20px 20px;

  :deep(.el-tabs__content) { height: calc(100% - 50px); overflow: hidden; }
  :deep(.el-tab-pane) { height: 100%; }
}
</style>

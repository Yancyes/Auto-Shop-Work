<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTaskStore } from '@/stores/task'
import { useLogStore } from '@/stores/log'
import { useUpdaterStore } from '@/stores/updater'
import { useBrowserViewStore } from '@/stores/browser-view'
import UpdateNotifier from '@/components/UpdateNotifier.vue'
import BrowserViewPanel from '@/components/BrowserViewPanel.vue'
import FeedbackDialog from '@/components/FeedbackDialog.vue'
import VersionInfo from '@/components/VersionInfo.vue'

const route = useRoute()
const router = useRouter()
const taskStore = useTaskStore()
const logStore = useLogStore()
const updaterStore = useUpdaterStore()
const browserViewStore = useBrowserViewStore()

onMounted(() => {
  updaterStore.init()
  taskStore.setupEventListeners()
  logStore.setupEventListeners()
})

function handleCheckUpdate() {
  updaterStore.check()
}

function handleShowVersionInfo() {
  versionInfoRef.value?.open()
}

const isCollapsed = ref(false)
const feedbackRef = ref<InstanceType<typeof FeedbackDialog> | null>(null)
const versionInfoRef = ref<InstanceType<typeof VersionInfo> | null>(null)

const menuItems = [
  { path: '/dashboard', label: '总览仪表盘', icon: 'Odometer' },
  { path: '/templates', label: '商品模板', icon: 'Document' },
  { path: '/tasks', label: '上架任务', icon: 'List' },
  { path: '/logs', label: '日志与设置', icon: 'Setting' }
]

const currentTitle = computed(() => (route.meta.title as string) || '自动上架工具')
const runningCount = computed(() => taskStore.runningCount)

function toggleSidebar() {
  isCollapsed.value = !isCollapsed.value
}

function navigate(path: string) {
  router.push(path)
}
</script>

<template>
  <div class="app-layout">
    <!-- 左侧导航栏 -->
    <aside class="sidebar" :class="{ collapsed: isCollapsed }">
      <div class="logo">
        <el-icon size="28" color="#ff6b35"><ShoppingCart /></el-icon>
        <span v-show="!isCollapsed" class="logo-text">自动上架</span>
      </div>
      <nav class="nav-menu">
        <div
          v-for="item in menuItems"
          :key="item.path"
          class="nav-item"
          :class="{ active: route.path === item.path }"
          @click="navigate(item.path)"
        >
          <el-icon size="20"><component :is="item.icon" /></el-icon>
          <span v-show="!isCollapsed" class="nav-label">{{ item.label }}</span>
        </div>
      </nav>
      <div v-show="!isCollapsed" class="sidebar-footer">
        <p>Developer: Yancy</p>
        <p>2362576803@qq.com</p>
      </div>
    </aside>

    <!-- 右侧主区域 -->
    <div class="main-area">
      <!-- 顶部标题栏 -->
      <header class="topbar">
        <div class="topbar-left">
          <el-icon class="collapse-btn" size="18" @click="toggleSidebar"><Fold v-if="!isCollapsed" /><Expand v-else /></el-icon>
          <h1 class="page-title">{{ currentTitle }}</h1>
        </div>
        <div class="topbar-right">
          <el-button class="feedback-btn" size="small" @click="feedbackRef?.open()">
            <el-icon><ChatDotRound /></el-icon>
            <span>功能建议</span>
          </el-button>
          <el-button class="update-btn" size="small" @click="handleCheckUpdate">
            <el-icon><Refresh /></el-icon>
            <span>检查更新</span>
          </el-button>
          <el-button
            class="browser-view-btn"
            size="small"
            :type="browserViewStore.isVisible ? 'primary' : 'default'"
            @click="browserViewStore.toggle"
          >
            <el-icon><Monitor /></el-icon>
            <span>浏览器监控</span>
          </el-button>
          <el-tag v-if="runningCount > 0" type="primary" effect="plain" round>
            <el-icon style="margin-right: 4px"><Loading /></el-icon>
            {{ runningCount }} 个任务运行中
          </el-tag>
        </div>
      </header>

      <!-- 主内容区 -->
      <main class="content">
        <router-view />
      </main>

      <!-- 底部状态栏 -->
      <footer class="statusbar">
        <span class="status-item">
          <el-icon size="14" color="#67c23a"><CircleCheck /></el-icon>
          系统运行正常
        </span>
        <span class="status-divider">|</span>
        <span class="status-item status-link" @click="handleShowVersionInfo">v{{ updaterStore.currentVersion || '1.2.0' }}</span>
        <span class="status-divider">|</span>
        <span class="status-item">本地运行 · 数据安全</span>
        <span class="status-divider">|</span>
        <span class="status-item copyright">Yancy</span>
      </footer>
    </div>

    <!-- 全局更新提示 -->
    <UpdateNotifier @showVersionInfo="handleShowVersionInfo" />

    <!-- 浏览器监控面板 -->
    <BrowserViewPanel />

    <!-- 功能建议反馈 -->
    <FeedbackDialog ref="feedbackRef" />

    <!-- 版本信息 -->
    <VersionInfo ref="versionInfoRef" />
  </div>
</template>

<style scoped lang="scss">
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 220px;
  background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  flex-shrink: 0;

  &.collapsed {
    width: 64px;
  }
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);

  .logo-text {
    color: #fff;
    font-size: 16px;
    font-weight: 600;
    white-space: nowrap;
  }
}

.nav-menu {
  flex: 1;
  padding: 12px 8px;
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  line-height: 1.6;

  p {
    margin: 0;
  }
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
  border-radius: 8px;
  margin-bottom: 4px;
  transition: all 0.2s;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.06);
  }

  &.active {
    color: #fff;
    background: linear-gradient(90deg, #ff6b35 0%, #f7941d 100%);

    .el-icon {
      color: #fff;
    }
  }

  .nav-label {
    font-size: 14px;
    white-space: nowrap;
  }
}

.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.topbar {
  height: 56px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;

  .topbar-left {
    display: flex;
    align-items: center;
    gap: 12px;

    .collapse-btn {
      cursor: pointer;
      color: #606266;
      &:hover { color: #ff6b35; }
    }

    .page-title {
      font-size: 18px;
      font-weight: 600;
      color: #303133;
    }
  }

  .feedback-btn {
    color: #667eea;
    border-color: #667eea;

    &:hover {
      background: #667eea;
      color: #fff;
    }
  }
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.statusbar {
  height: 28px;
  background: #f0f2f5;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 8px;
  font-size: 12px;
  color: #909399;
  border-top: 1px solid #e4e7ed;
  flex-shrink: 0;

  .status-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .status-link {
    cursor: pointer;
    color: #667eea;
    border-radius: 3px;
    padding: 0 4px;
    transition: all 0.15s;

    &:hover {
      background: rgba(102, 126, 234, 0.1);
    }
  }

  .status-divider {
    color: #dcdfe6;
  }

  .copyright {
    margin-left: auto;
    color: #b0b3b8;
  }
}
</style>

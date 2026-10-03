import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { ref } from 'vue'
import type { Router } from 'vue-router'

/** 页面级懒加载的导航态：为 true 时主内容区渲染骨架屏 */
const isPageLoading = ref(false)

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/dashboard'
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/dashboard.vue'),
    meta: { title: '操作录制', icon: 'VideoCamera' }
  },
  {
    path: '/scripts',
    name: 'scripts',
    component: () => import('@/views/scripts.vue'),
    meta: { title: '脚本管理', icon: 'List' }
  },
  {
    path: '/logs',
    name: 'logs',
    component: () => import('@/views/logs.vue'),
    meta: { title: '日志与设置', icon: 'Setting' }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

/**
 * 懒加载页面的 chunk 拉取期间把内容区切成骨架屏。
 * 不在路由记录里用 defineAsyncComponent：vue-router 会告警，且它自己管理组件解析时机。
 * afterEach 对每次导航尝试都会触发（含被重定向/失败的），所以布尔量不会卡在 true。
 */
export function setupPageLoading(r: Router) {
  r.beforeEach(() => {
    isPageLoading.value = true
  })
  r.afterEach(() => {
    isPageLoading.value = false
  })
}

export { isPageLoading }

export default router

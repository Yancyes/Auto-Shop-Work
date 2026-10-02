import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

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

export default router

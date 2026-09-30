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
    meta: { title: '总览仪表盘', icon: 'Odometer' }
  },
  {
    path: '/templates',
    name: 'templates',
    component: () => import('@/views/templates.vue'),
    meta: { title: '商品模板', icon: 'Document' }
  },
  {
    path: '/tasks',
    name: 'tasks',
    component: () => import('@/views/tasks.vue'),
    meta: { title: '上架任务', icon: 'List' }
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

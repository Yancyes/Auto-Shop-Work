import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router, { setupPageLoading } from './router'
import { registerIcons } from './plugins/icons'
import './assets/styles/main.scss'

const app = createApp(App)

// 首次导航在 mount 时就发起，守卫必须先注册好，否则首屏骨架屏不出现
setupPageLoading(router)

// Element Plus 由 unplugin-vue-components / unplugin-auto-import 按需引入（vite.config.ts），
// 这里只注册按名字动态使用的图标
registerIcons(app)

app.use(createPinia())
app.use(router)
app.mount('#app')

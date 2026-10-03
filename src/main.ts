import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { registerIcons } from './plugins/icons'
import './assets/styles/main.scss'

const app = createApp(App)

// Element Plus 由 unplugin-vue-components / unplugin-auto-import 按需引入（vite.config.ts），
// 这里只注册按名字动态使用的图标
registerIcons(app)

app.use(createPinia())
app.use(router)
app.mount('#app')

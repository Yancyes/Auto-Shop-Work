<script setup lang="ts">
import { ref } from 'vue'

/** 常驻公告：一行摘要 + 详情弹窗。文案随版本走，改这里即可 */
const detailVisible = ref(false)

const features = [
  { title: '两种录制顺序都行', desc: '先搜后录：地址栏输网址或关键词点「前往」，再点「开始录制」；先录后搜：直接点「开始录制」，随后在地址栏搜索跳转，跳转后的页面同样会被录制。' },
  { title: '两种录制轨道', desc: '「页面录制」在下方「网页页面」里操作，适合只在一个网页内完成的流程；「屏幕录制」会另开一个独立浏览器窗口供你操作，步骤照样实时回传成右侧列表，操作时不会被主界面挡住。' },
  { title: '一个脚本盯多处', desc: '「监控区域」里可以同时配多块：每块各自设对比方式（屏幕像素比对 / 页面文字关键词 / 两者都跑）、出现或消失的关键词、变化阈值和轮询间隔；基准图可以现场框选抓屏，也可以直接「上传图片」用现成截图比对。' },
  { title: '变化就暂停等你', desc: '插入「监控检查点」步骤并指定区域，执行到这里如果命中变化，脚本会自动暂停并显示热区对比图，你可以直接改步骤、补操作，再点「继续执行」或「跳过本步」。' },
  { title: '界面可收成迷你窗', desc: '地址栏旁的「收起」按钮可把主界面收成一颗置顶小窗，拖到屏幕任意位置，只显示当前步骤和各区域的变化比例，留「结束录制 / 暂停 / 跳过本步 / 终止」按钮，随时「恢复窗口」回到完整界面。' },
  { title: '网页操作自动成步', desc: '录制状态下的点击、输入、选择、滚动、键盘、页面跳转都会自动记成右侧的步骤，可增删、改内容、拖动排序。' },
  { title: '步骤节奏可调', desc: '默认每执行完一步等 300 毫秒再进行下一步；单个步骤可填自己的延迟，也能在步骤列表上方填好数值后「应用到全部 N 步」，或点「只应用到几步」勾出其中若干条批量刷成同一个延迟。' },
  { title: '随机刷新不固定', desc: '插入「刷新页面」步骤后，执行到它会先随机等 30~60 秒再刷新，节奏每次都不一样，避免总在同一秒刷新被判定为脚本行为。' },
  { title: '步骤数据可替换', desc: '把步骤的值改成 {{字段名}}，在「脚本管理 · 自定义数据」里一行填一组数据，第 N 轮就用第 N 行；也可以复制内置提示词丢给任意 AI 造数据，粘回来直接导入。' },
  { title: '脚本可复用可并发', desc: '保存后可在「脚本管理」里执行、复制、改名、删除，支持同时跑多个脚本，也能暂停或随时打断。' },
  { title: '保存前先验证', desc: '录制完在右侧点「回放」，直接在当前网页上试跑一遍，确认没问题再保存。' },
  { title: '更新不用管', desc: '检测到新版本会在后台下载，完成后点「重启更新」，应用会自己装好并重启成新版本。' }
]
</script>

<template>
  <div class="announcement-bar">
    <div class="bar-main">
      <el-icon class="bar-icon" size="15"><Bell /></el-icon>
      <span class="bar-label">使用指引</span>
      <span class="bar-summary">
        ① 地址栏输网址或关键词点「前往」 ② 点「开始录制」在页面里操作 ③ 停止后保存脚本 ④ 到「脚本管理」执行
        <em class="bar-tip">先搜后录、先录后搜都可以</em>
      </span>
      <button class="bar-toggle" type="button" @click="detailVisible = true">
        查看详情
        <el-icon size="12"><ArrowRight /></el-icon>
      </button>
    </div>
  </div>

  <!-- destroy-on-close：每次打开都重放卡片逐条浮现的动画 -->
  <el-dialog
    v-model="detailVisible"
    width="720px"
    top="8vh"
    :show-close="false"
    :destroy-on-close="true"
    class="notice-dialog"
  >
    <template #header>
      <div class="notice-header">
        <div class="notice-badge">
          <el-icon size="18"><Promotion /></el-icon>
        </div>
        <div class="notice-heading">
          <h3>影随 TraceFlow 怎么用</h3>
          <p>把网页或屏幕上的操作录一遍，之后交给软件自动重复，画面变了还能停下等你接手</p>
        </div>
        <button class="notice-close" type="button" @click="detailVisible = false">
          <el-icon size="16"><Close /></el-icon>
        </button>
      </div>
    </template>

    <div class="notice-steps">
      <div v-for="(item, index) in features" :key="item.title" class="feature" :style="{ '--i': index }">
        <span class="feature-index">{{ index + 1 }}</span>
        <div class="feature-body">
          <span class="feature-title">{{ item.title }}</span>
          <span class="feature-desc">{{ item.desc }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="notice-footer">
        <span class="footer-hint">随时可点顶部「使用指引」重新查看</span>
        <el-button type="primary" class="btn-primary" @click="detailVisible = false">知道了</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
.announcement-bar {
  flex-shrink: 0;
  border-bottom: 1px solid #ebeef5;
  background: linear-gradient(90deg, rgba(255, 107, 53, 0.06) 0%, rgba(102, 126, 234, 0.06) 100%);
}

.bar-main {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 16px;
  font-size: 12px;
  color: #606266;
}

.bar-icon {
  color: #ff6b35;
}

.bar-label {
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
}

.bar-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-tip {
  margin-left: 6px;
  font-style: normal;
  color: #ff6b35;
}

.bar-toggle {
  display: flex;
  align-items: center;
  gap: 2px;
  border: none;
  background: none;
  padding: 2px 6px;
  font-size: 12px;
  color: #667eea;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.18s ease;

  &:hover {
    background: rgba(102, 126, 234, 0.1);
    gap: 4px;
  }
}

.notice-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.notice-badge {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, #ff6b35 0%, #f7941d 100%);
  box-shadow: 0 6px 16px rgba(255, 107, 53, 0.28);
}

.notice-heading {
  flex: 1;
  min-width: 0;

  h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    color: #303133;
  }

  p {
    margin: 2px 0 0;
    font-size: 12px;
    color: #909399;
  }
}

.notice-close {
  border: none;
  background: none;
  padding: 4px;
  color: #909399;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.18s ease;

  &:hover {
    color: #303133;
    background: #f0f2f5;
    transform: rotate(90deg);
  }
}

.notice-steps {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 4px 0 8px;
}

.feature {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f8f9fc;
  border: 1px solid #ebeef5;
  /* 逐条浮现：--i 由模板按序号注入，形成 40ms 一格的错峰 */
  animation: feature-in 0.32s cubic-bezier(0.22, 0.61, 0.36, 1) both;
  animation-delay: calc(var(--i) * 40ms);
  transition: transform 0.18s ease, box-shadow 0.18s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(102, 126, 234, 0.12);
  }
}

.feature-index {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #667eea;
  background: rgba(102, 126, 234, 0.12);
}

.feature-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.feature-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.feature-desc {
  font-size: 12px;
  line-height: 1.65;
  color: #606266;
}

.notice-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.footer-hint {
  font-size: 12px;
  color: #909399;
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
}

@keyframes feature-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .feature {
    animation: none;
  }
}
</style>

<style lang="scss">
/* el-dialog 走 teleport 渲染到 body，内部结构与动画类拿不到 scoped 作用域，
   因此弹窗外壳与进出动画写在全局块里，用专属类名限定 */
.notice-dialog {
  border-radius: 16px;
  overflow: hidden;

  .el-dialog__header {
    padding: 20px 24px 12px;
    margin-right: 0;
  }

  .el-dialog__body {
    padding: 0 24px;
    max-height: 62vh;
    overflow-y: auto;
  }

  .el-dialog__footer {
    padding: 12px 24px 20px;
  }
}

/* 覆盖 EP 默认的 dialog-fade：整窗用「上浮 + 缩放」，遮罩单独淡入。
   EP 把 dialog-fade-in 加在 .el-overlay-dialog 上，所以覆盖同一层，避免内外两层动画打架；
   必须限定在 enter-active 上，否则关闭时也会命中这条 animation，把淡出顶掉变成直接消失 */
.el-overlay.dialog-fade-enter-active:has(.notice-dialog) {
  animation: notice-mask-in 0.22s ease both;

  .el-overlay-dialog {
    animation: notice-pop-in 0.3s cubic-bezier(0.22, 0.61, 0.36, 1) both;
  }
}

@keyframes notice-mask-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes notice-pop-in {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>

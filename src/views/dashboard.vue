<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useScriptStore } from '@/stores/script'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { RecordedStep, RecordedAction } from '../../shared/types'
import StepListEditor from '@/components/StepListEditor.vue'

const scriptStore = useScriptStore()

const webviewRef = ref<any>(null)
const urlInput = ref('https://www.baidu.com')
const webviewSrc = ref('https://www.baidu.com')
const currentUrl = ref('')
const webviewLoaded = ref(false)
const webviewError = ref('')

const saveDialogVisible = ref(false)
const saveName = ref('')
const saveDesc = ref('')

const stepsPanelVisible = ref(true)

const isRecording = computed(() => scriptStore.isRecording)
const recordedSteps = computed(() => scriptStore.recordedSteps)
const isPlaying = computed(() => scriptStore.isPlaying)

const captureScript = `
(function() {
  if (window.__recordInjected) return;
  window.__recordInjected = true;

  function getSelector(el) {
    if (!el || !el.tagName) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    if (el === document.body) return 'body';

    var tag = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      var classes = el.className.trim().split(/\\s+/)
        .filter(function(c) { return c && !c.match(/^(hover|active|focus|visited|selected)/i); });
      if (classes.length) {
        var sel = tag + '.' + classes.map(function(c) { return CSS.escape(c); }).join('.');
        try {
          if (document.querySelectorAll(sel).length === 1) return sel;
        } catch(e) {}
      }
    }

    var parent = el.parentElement;
    if (!parent) return tag;
    var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === el.tagName; });
    if (siblings.length === 1) {
      var parentSel = getSelector(parent);
      return parentSel ? parentSel + ' > ' + tag : tag;
    }
    var index = siblings.indexOf(el) + 1;
    var parentSel2 = getSelector(parent);
    return parentSel2 ? parentSel2 + ' > ' + tag + ':nth-of-type(' + index + ')' : tag + ':nth-of-type(' + index + ')';
  }

  function getElementText(el) {
    if (!el) return '';
    var text = (el.textContent || '').trim().slice(0, 50);
    if (text) return text;
    if (el.placeholder) return el.placeholder.slice(0, 50);
    if (el.title) return el.title.slice(0, 50);
    if (el.alt) return el.alt.slice(0, 50);
    return '';
  }

  function record(action, el, value) {
    var data = {
      __record: true,
      action: action,
      selector: el ? getSelector(el) : '',
      value: value || undefined,
      tagName: el ? el.tagName.toLowerCase() : undefined,
      elementText: el ? getElementText(el) : undefined,
      description: ''
    };

    switch (action) {
      case 'click':
        data.description = '点击 ' + (data.elementText || data.tagName || '元素');
        break;
      case 'dblclick':
        data.description = '双击 ' + (data.elementText || data.tagName || '元素');
        break;
      case 'fill':
        data.description = '输入 ' + (data.elementText || data.tagName || '') + ' = ' + (value || '').slice(0, 20);
        break;
      case 'select':
        data.description = '选择 ' + (data.elementText || data.tagName || '') + ' = ' + (value || '');
        break;
      case 'scroll':
        data.description = '页面滚动';
        break;
      case 'navigate':
        data.description = '页面导航: ' + (value || '').slice(0, 40);
        break;
      default:
        data.description = action + ' ' + (data.elementText || data.tagName || '');
    }

    console.log('__RECORD__:' + JSON.stringify(data));
  }

  // 输入防抖：用户停止输入 400ms 后立即录制，避免每键一条记录；
  // 若期间触发 change/Enter，则取消防抖以避免重复录制
  var fillDebounceTimer = null;
  var fillDebounceTarget = null;

  function scheduleFillRecord(el) {
    fillDebounceTarget = el;
    if (fillDebounceTimer) clearTimeout(fillDebounceTimer);
    fillDebounceTimer = setTimeout(function() {
      fillDebounceTimer = null;
      if (fillDebounceTarget && fillDebounceTarget.value) {
        record('fill', fillDebounceTarget, fillDebounceTarget.value);
      }
      fillDebounceTarget = null;
    }, 400);
  }

  function cancelFillDebounce() {
    if (fillDebounceTimer) {
      clearTimeout(fillDebounceTimer);
      fillDebounceTimer = null;
      fillDebounceTarget = null;
    }
  }

  document.addEventListener('mousedown', function(e) {
    if (e.detail === 2) {
      record('dblclick', e.target);
    } else {
      record('click', e.target);
    }
  }, true);

  document.addEventListener('input', function(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      scheduleFillRecord(el);
    }
  }, true);

  document.addEventListener('change', function(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      record('select', el, el.value);
    } else if ((tag === 'input' || tag === 'textarea') && el.value) {
      // change 触发时取消未决的防抖，避免重复录制
      cancelFillDebounce();
      record('fill', el, el.value);
    }
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && fillDebounceTarget) {
      var el = fillDebounceTarget;
      cancelFillDebounce();
      if (el.value) record('fill', el, el.value);
    }
  }, true);

  // blur 时若仍有未决防抖，立即落盘，避免漏录
  document.addEventListener('blur', function(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    if (fillDebounceTarget === el) {
      cancelFillDebounce();
      if (el.value) record('fill', el, el.value);
    }
  }, true);

  var scrollTimer = null;
  var lastScrollY = window.scrollY || window.pageYOffset;
  window.addEventListener('scroll', function() {
    if (scrollTimer) return;
    scrollTimer = setTimeout(function() {
      scrollTimer = null;
      var newY = window.scrollY || window.pageYOffset;
      var direction = newY >= lastScrollY ? 'down' : 'up';
      lastScrollY = newY;
      record('scroll', null, direction);
    }, 250);
  }, true);

  // SPA 路由变化实时监听：hook pushState/replaceState + popstate
  var lastHref = location.href;
  function emitNavigateIfChanged() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      record('navigate', null, location.href);
    }
  }

  window.addEventListener('popstate', emitNavigateIfChanged);

  var origPushState = history.pushState;
  var origReplaceState = history.replaceState;
  history.pushState = function() {
    var ret = origPushState.apply(this, arguments);
    emitNavigateIfChanged();
    return ret;
  };
  history.replaceState = function() {
    var ret = origReplaceState.apply(this, arguments);
    emitNavigateIfChanged();
    return ret;
  };
})();
`

function navigateTo() {
  const url = urlInput.value.trim()
  if (!url) {
    ElMessage.warning('请输入网址')
    return
  }
  const wv = webviewRef.value
  if (!wv || !wv.loadURL) return
  let finalUrl = url
  if (!/^https?:\/\//i.test(url)) {
    finalUrl = 'https://' + url
    urlInput.value = finalUrl
  }
  webviewError.value = ''
  webviewLoaded.value = false
  webviewSrc.value = finalUrl
  wv.loadURL(finalUrl).catch(() => {})
}

function handleWebviewDidFinishLoad() {
  webviewLoaded.value = true
  currentUrl.value = webviewRef.value?.getURL() || ''
  urlInput.value = currentUrl.value

  if (isRecording.value) {
    injectCaptureScript()
  }
}

function handleWebviewDidNavigate() {
  currentUrl.value = webviewRef.value?.getURL() || ''
  nextTick(() => {
    urlInput.value = currentUrl.value
    // 录制中导航后立即重新注入脚本，避免 500ms 空窗
    if (isRecording.value) {
      injectCaptureScript()
    }
  })
}

function handleWebviewDidFailLoad(e: any) {
  const code = e?.errorCode
  if (code && code !== -3) {
    webviewError.value = `页面加载失败: ${e?.errorDescription || code}`
  }
}

/** 打断正在执行的脚本（无确认，立即终止） */
async function interruptScript() {
  if (scriptStore.progressScriptId === null) return
  const res = await scriptStore.terminateScript(scriptStore.progressScriptId)
  if (res.success) {
    ElMessage.success('脚本已打断')
  } else {
    ElMessage.error(res.error || '打断失败')
  }
}

function handleConsoleMessage(e: any) {
  const message = e?.message || ''
  if (!message.startsWith('__RECORD__:')) return
  if (!isRecording.value) return

  try {
    const data = JSON.parse(message.slice('__RECORD__:'.length))
    if (!data.__record || !data.action) return

    const step: Omit<RecordedStep, 'id'> = {
      action: data.action as RecordedAction,
      selector: data.selector || '',
      value: data.value,
      description: data.description || '',
      tagName: data.tagName,
      elementText: data.elementText,
      delayBefore: Date.now()
    }

    scriptStore.addStep(step)
  } catch {
    // ignore malformed messages
  }
}

function injectCaptureScript() {
  if (!webviewRef.value) return
  webviewRef.value.executeJavaScript(captureScript).catch(() => {})
}

function startRecording() {
  if (!webviewRef.value || !webviewLoaded.value) {
    ElMessage.warning('请先加载页面')
    return
  }
  const url = currentUrl.value || urlInput.value
  scriptStore.startRecording(url)
  injectCaptureScript()
  ElMessage.success('开始录制，请操作页面')
}

function stopRecording() {
  scriptStore.stopRecording()
  ElMessage.info('录制已停止')
}

async function saveCurrentScript() {
  if (recordedSteps.value.length === 0) {
    ElMessage.warning('没有录制的步骤')
    return
  }
  saveDialogVisible.value = true
}

async function confirmSave() {
  const name = saveName.value.trim()
  if (!name) {
    ElMessage.warning('请输入脚本名称')
    return
  }

  const steps = recordedSteps.value.map((s, i) => {
    const prev = i > 0 ? recordedSteps.value[i - 1] : null
    const delay = prev && s.delayBefore && prev.delayBefore
      ? s.delayBefore - prev.delayBefore
      : 300
    return { ...s, delayBefore: Math.min(Math.max(delay, 100), 10000) }
  })

  const result = await scriptStore.saveScript(
    name,
    scriptStore.targetUrl,
    steps as RecordedStep[],
    saveDesc.value.trim() || undefined
  )
  if (result) {
    ElMessage.success('脚本已保存')
    saveDialogVisible.value = false
    saveName.value = ''
    saveDesc.value = ''
    scriptStore.clearSteps()
  } else {
    ElMessage.error('保存失败')
  }
}

async function playSteps() {
  if (recordedSteps.value.length === 0) {
    ElMessage.warning('请先录制操作步骤')
    return
  }
  if (!webviewRef.value) {
    ElMessage.warning('页面未加载')
    return
  }
  ElMessage.info('开始回放步骤...')
  await scriptStore.playStepsInWebview(webviewRef.value)
  ElMessage.success('回放完成')
}

function stopPlaying() {
  scriptStore.stopPlaying()
}

async function clearAllSteps() {
  if (isPlaying.value) return
  try {
    await ElMessageBox.confirm('确定清空所有录制的步骤？', '确认', { type: 'warning' })
    scriptStore.clearSteps()
  } catch {
    // cancelled
  }
}

onMounted(() => {
  // webview 通过 :src 属性自动加载初始 URL，无需手动调用 navigateTo
})

onUnmounted(() => {
  if (isRecording.value) {
    scriptStore.stopRecording()
  }
  if (isPlaying.value) {
    scriptStore.stopPlaying()
  }
})
</script>

<template>
  <div class="dashboard">
    <!-- 地址栏 -->
    <div class="url-bar card">
      <el-input
        v-model="urlInput"
        placeholder="输入网址，如 https://www.example.com"
        size="large"
        clearable
        @keyup.enter="navigateTo"
      >
        <template #prefix>
          <el-icon><Link /></el-icon>
        </template>
      </el-input>
      <el-button type="primary" size="large" @click="navigateTo" :loading="!webviewLoaded && !webviewError">
        前往
      </el-button>

      <div class="url-actions">
        <el-button
          v-if="!isRecording"
          type="danger"
          size="large"
          plain
          @click="startRecording"
          :disabled="!webviewLoaded"
        >
          <el-icon><VideoCamera /></el-icon>
          开始录制
        </el-button>
        <template v-else>
          <el-button type="danger" size="large" @click="stopRecording">
            <el-icon><VideoPause /></el-icon>
            停止录制
          </el-button>
          <span class="recording-indicator">
            <span class="rec-dot"></span>
            录制中
          </span>
        </template>
      </div>
    </div>

    <!-- 主工作区 -->
    <div class="workspace mt-16">
      <!-- 左侧：Webview -->
      <div class="webview-section" :class="{ 'is-recording': isRecording }">
        <div class="webview-container">
          <webview
            ref="webviewRef"
            :src="webviewSrc"
            style="width:100%;height:100%;border:none;"
            partition="persist:recording"
            allowpopups
            @did-finish-load="handleWebviewDidFinishLoad"
            @did-navigate="handleWebviewDidNavigate"
            @did-fail-load="handleWebviewDidFailLoad"
            @console-message="handleConsoleMessage"
          />
          <div v-if="webviewError" class="webview-error">
            <el-icon><WarningFilled /></el-icon>
            {{ webviewError }}
          </div>
          <!-- 脚本执行中叠加打断按钮 -->
          <div v-if="scriptStore.isProgressing" class="script-running-badge">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span class="badge-text">
              {{ scriptStore.progressPaused ? '已暂停' : '执行中' }}
              · 步骤 {{ Math.max(scriptStore.progressStepIndex + 1, 0) }}/{{ scriptStore.progressTotalSteps }}
            </span>
            <el-button
              type="danger"
              size="small"
              circle
              @click="interruptScript"
              title="打断脚本执行"
            >
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
        </div>
      </div>

      <!-- 右侧：步骤面板 -->
      <div class="steps-panel" v-show="stepsPanelVisible">
        <div class="panel-header">
          <span class="panel-title">
            <el-icon><List /></el-icon>
            操作步骤
            <el-tag v-if="recordedSteps.length" size="small" round>{{ recordedSteps.length }}</el-tag>
          </span>
          <div class="panel-actions">
            <el-button
              v-if="!isRecording && !isPlaying && recordedSteps.length > 0"
              type="success"
              size="small"
              @click="playSteps"
            >
              <el-icon><VideoPlay /></el-icon>
              回放
            </el-button>
            <el-button
              v-if="isPlaying"
              type="warning"
              size="small"
              @click="stopPlaying"
            >
              <el-icon><VideoPause /></el-icon>
              停止
            </el-button>
          </div>
        </div>

        <!-- 步骤列表（编辑/排序/删除逻辑见 StepListEditor） -->
        <StepListEditor
          v-model="scriptStore.recordedSteps"
          :locked="isRecording || isPlaying"
          :allow-remove="isRecording && !isPlaying"
          :active-index="isPlaying ? scriptStore.playingStepIndex : -1"
          :empty-text="isRecording
            ? '在左侧页面上操作以录制步骤'
            : '点击「开始录制」后操作页面，或点击下方「添加步骤」手动新建'"
        />

        <!-- 底部操作 -->
        <div v-if="recordedSteps.length > 0 && !isRecording" class="panel-footer">
          <el-button type="primary" @click="saveCurrentScript" style="width: 100%">
            <el-icon><Check /></el-icon>
            保存为脚本
          </el-button>
          <el-button text type="danger" size="small" @click="clearAllSteps" style="width: 100%; margin-top: 8px; margin-left: 0">
            清空步骤
          </el-button>
        </div>
      </div>
    </div>

    <!-- 保存脚本弹窗 -->
    <el-dialog v-model="saveDialogVisible" title="保存脚本" width="420px" @close="saveName = ''; saveDesc = ''">
      <el-form label-width="80px">
        <el-form-item label="脚本名称" required>
          <el-input v-model="saveName" placeholder="如：商品搜索下单流程" maxlength="50" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="saveDesc"
            type="textarea"
            :rows="2"
            placeholder="可选，脚本用途说明"
            maxlength="200"
          />
        </el-form-item>
        <el-form-item label="步骤数">
          <span>{{ recordedSteps.length }} 个操作步骤</span>
        </el-form-item>
        <el-form-item label="目标网址">
          <span class="target-url">{{ scriptStore.targetUrl }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="saveDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.dashboard {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.url-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;

  .el-input {
    flex: 1;
  }

  .url-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-left: 8px;
  }
}

.recording-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #f56c6c;
  font-size: 13px;
  font-weight: 600;

  .rec-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #f56c6c;
    animation: pulse 1.2s ease-in-out infinite;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
}

.workspace {
  flex: 1;
  display: flex;
  gap: 16px;
  min-height: 0;
}

.webview-section {
  flex: 1;
  min-width: 0;
  border-radius: 10px;
  overflow: hidden;
  border: 3px solid transparent;
  transition: border-color 0.3s;

  &.is-recording {
    border-color: #f56c6c;
    border-style: dashed;
    animation: recordBorder 2s ease-in-out infinite;
  }
}

@keyframes recordBorder {
  0%, 100% { border-color: #f56c6c; }
  50% { border-color: #f9a8a8; }
}

.webview-container {
  width: 100%;
  height: 100%;
  position: relative;
  background: #f5f7fa;
  border-radius: 8px;
  overflow: hidden;

  .script-running-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(245, 108, 108, 0.92);
    color: #fff;
    border-radius: 18px;
    box-shadow: 0 2px 8px rgba(245, 108, 108, 0.4);
    z-index: 10;
    font-size: 13px;
    font-weight: 500;
    backdrop-filter: blur(4px);

    .badge-text {
      white-space: nowrap;
    }

    .el-button.is-circle {
      width: 24px;
      height: 24px;
      padding: 0;
    }
  }
}

.webview-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 8px;
  color: #f56c6c;
  font-size: 14px;
  background: #fef0f0;
  padding: 12px 20px;
  border-radius: 8px;
}

.steps-panel {
  width: 340px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #f0f0f0;

  .panel-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 15px;
    font-weight: 600;
    color: #303133;
  }

  .panel-actions {
    display: flex;
    gap: 6px;
  }
}

.panel-footer {
  padding: 12px 16px;
  border-top: 1px solid #f0f0f0;
}

.target-url {
  font-size: 12px;
  color: #909399;
  word-break: break-all;
}
</style>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTemplateStore } from '@/stores/template'
import type { ProductTemplate } from '../../shared/types'

const store = useTemplateStore()

const searchKeyword = ref('')
const selectedId = ref<number | null>(null)

const filteredTemplates = computed(() => {
  if (!searchKeyword.value) return store.templates
  return store.templates.filter(t =>
    t.name.toLowerCase().includes(searchKeyword.value.toLowerCase())
  )
})

// 表单数据
const form = reactive<Partial<ProductTemplate>>({
  name: '',
  quantity: 1,
  unit: '万金',
  unitPrice: 0,
  publishCount: 1,
  contactMode: 1,
  phone: '',
  compensationType: '不包赔',
  tradeTimeRange: '全天',
  fundSettlement: '平台代收'
})

const compensationOptions = ['不包赔', '包赔', '包赔包售后']
const timeRangeOptions = ['全天', '上午', '下午', '晚上']
const fundOptions = ['平台代收', '即时到账', '次日到账']
const DEFAULT_UNITS = ['万金', '个', '件', '组']

const unitOptions = ref<string[]>((() => {
  try {
    const custom = JSON.parse(localStorage.getItem('custom_units') || '[]')
    return [...DEFAULT_UNITS, ...custom.filter((u: string) => !DEFAULT_UNITS.includes(u))]
  } catch {
    return [...DEFAULT_UNITS]
  }
})())

function addCustomUnit(unit: string) {
  const trimmed = unit.trim()
  if (!trimmed || unitOptions.value.includes(trimmed)) return
  unitOptions.value.push(trimmed)
  const custom = unitOptions.value.filter(u => !DEFAULT_UNITS.includes(u))
  localStorage.setItem('custom_units', JSON.stringify(custom))
}

// 实时计算
const feeRate = 0.05 // 手续费率 5%
const handlingFee = computed(() => (form.unitPrice || 0) * (form.publishCount || 0) * feeRate)
const estimatedIncome = computed(() => (form.unitPrice || 0) * (form.publishCount || 0) - handlingFee.value)

function selectTemplate(t: ProductTemplate) {
  selectedId.value = t.id
  Object.assign(form, t)
}

function newTemplate() {
  selectedId.value = null
  Object.assign(form, {
    id: undefined,
    name: '',
    quantity: 1,
    unit: '万金',
    unitPrice: 0,
    publishCount: 1,
    contactMode: 1,
    phone: '',
    compensationType: '不包赔',
    tradeTimeRange: '全天',
    fundSettlement: '平台代收'
  })
}

async function save() {
  if (!form.name) {
    ElMessage.warning('请输入模板名称')
    return
  }
  if (!form.unitPrice || form.unitPrice <= 0) {
    ElMessage.warning('请输入有效的单价')
    return
  }
  if (form.unit) addCustomUnit(form.unit)
  const res = await store.saveTemplate({ ...form, id: selectedId.value ?? undefined })
  if (res.success) {
    ElMessage.success(selectedId.value ? '模板已更新' : '模板已创建')
    if (!selectedId.value && res.data) {
      selectedId.value = res.data.id
    }
  } else {
    ElMessage.error(res.error || '保存失败')
  }
}

async function copyTemplate(t: ProductTemplate) {
  const { id, createdAt, updatedAt, ...rest } = t
  const res = await store.saveTemplate({ ...rest, name: `${t.name} - 副本` })
  if (res.success) ElMessage.success('模板已复制')
}

async function removeTemplate(t: ProductTemplate) {
  try {
    await ElMessageBox.confirm(`确定删除模板「${t.name}」吗？`, '提示', { type: 'warning' })
    const res = await store.deleteTemplate(t.id)
    if (res.success) {
      ElMessage.success('已删除')
      if (selectedId.value === t.id) newTemplate()
    }
  } catch {}
}

function resetForm() {
  newTemplate()
}

onMounted(() => {
  store.loadTemplates()
})
</script>

<template>
  <div class="template-page">
    <!-- 左侧模板列表 -->
    <div class="template-list">
      <div class="list-header">
        <el-input v-model="searchKeyword" placeholder="搜索模板..." :prefix-icon="'Search'" clearable size="small" />
        <el-button type="primary" size="small" @click="newTemplate">
          <el-icon><Plus /></el-icon> 新增
        </el-button>
      </div>
      <div class="list-body">
        <div
          v-for="t in filteredTemplates"
          :key="t.id"
          class="list-item"
          :class="{ active: selectedId === t.id }"
          @click="selectTemplate(t)"
        >
          <div class="item-name">{{ t.name }}</div>
          <div class="item-info">
            <span>{{ t.quantity }}{{ t.unit }}</span>
            <span>¥{{ t.unitPrice }}</span>
          </div>
          <div class="item-actions">
            <el-button text size="small" @click.stop="copyTemplate(t)">复制</el-button>
            <el-button text size="small" type="danger" @click.stop="removeTemplate(t)">删除</el-button>
          </div>
        </div>
        <el-empty v-if="!filteredTemplates.length" description="暂无模板" :image-size="60" />
      </div>
    </div>

    <!-- 右侧配置表单 -->
    <div class="template-form">
      <div class="form-section">
        <div class="section-header">
          <el-icon><Goods /></el-icon>
          <span>商品基础信息</span>
        </div>
        <el-form :model="form" label-width="100px" label-position="right">
          <el-form-item label="模板名称">
            <el-input v-model="form.name" placeholder="请输入模板名称" />
          </el-form-item>
          <el-form-item label="商品数量">
            <el-input-number v-model="form.quantity" :min="1" :max="999999" />
          </el-form-item>
          <el-form-item label="单位">
            <el-select v-model="form.unit" placeholder="选择或输入单位" filterable allow-create @change="(val: string) => addCustomUnit(val)">
              <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
            </el-select>
          </el-form-item>
          <el-form-item label="单价（元）">
            <el-input-number v-model="form.unitPrice" :min="0" :precision="2" :step="0.01" />
          </el-form-item>
          <el-form-item label="发布件数">
            <el-input-number v-model="form.publishCount" :min="1" :max="999" />
          </el-form-item>
          <el-form-item label="费用预估">
            <div class="fee-preview">
              <el-tag type="warning" effect="plain">手续费: ¥{{ handlingFee.toFixed(2) }}</el-tag>
              <el-tag type="success" effect="plain">预估收入: ¥{{ estimatedIncome.toFixed(2) }}</el-tag>
            </div>
          </el-form-item>
        </el-form>
      </div>

      <div class="form-section">
        <div class="section-header">
          <el-icon><Phone /></el-icon>
          <span>交易联系信息</span>
        </div>
        <el-form :model="form" label-width="100px" label-position="right">
          <el-form-item label="联系电话模式">
            <el-radio-group v-model="form.contactMode">
              <el-radio :value="1">平台代发联系电话</el-radio>
              <el-radio :value="2">自定义手机号</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.contactMode === 2" label="手机号">
            <el-input v-model="form.phone" placeholder="请输入手机号" maxlength="11" />
          </el-form-item>
        </el-form>
      </div>

      <div class="form-section">
        <div class="section-header">
          <el-icon><Setting /></el-icon>
          <span>交易属性</span>
        </div>
        <el-form :model="form" label-width="100px" label-position="right">
          <el-form-item label="包赔类型">
            <div class="card-select">
              <div
                v-for="opt in compensationOptions"
                :key="opt"
                class="card-option"
                :class="{ active: form.compensationType === opt }"
                @click="form.compensationType = opt"
              >{{ opt }}</div>
            </div>
          </el-form-item>
          <el-form-item label="交易时间段">
            <el-select v-model="form.tradeTimeRange">
              <el-option v-for="t in timeRangeOptions" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="资金到账方式">
            <el-select v-model="form.fundSettlement">
              <el-option v-for="f in fundOptions" :key="f" :label="f" :value="f" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>

      <!-- 底部操作栏 -->
      <div class="form-actions">
        <el-button @click="resetForm">重置表单</el-button>
        <el-button type="primary" @click="save">
          <el-icon><Check /></el-icon> 保存模板
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.template-page {
  display: flex;
  gap: 20px;
  height: 100%;
}

.template-list {
  width: 280px;
  background: #fff;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;

  .list-header {
    padding: 12px;
    display: flex;
    gap: 8px;
    border-bottom: 1px solid #f0f0f0;
  }

  .list-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }
}

.list-item {
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
  margin-bottom: 4px;

  &:hover { background: #f5f7fa; }
  &.active { background: #ecf5ff; border-left: 3px solid #409eff; }

  .item-name { font-size: 14px; font-weight: 600; color: #303133; margin-bottom: 4px; }
  .item-info {
    display: flex;
    gap: 12px;
    font-size: 12px;
    color: #909399;
    margin-bottom: 4px;
  }
  .item-actions { display: flex; gap: 4px; }
}

.template-form {
  flex: 1;
  background: #fff;
  border-radius: 10px;
  padding: 24px;
  overflow-y: auto;
}

.form-section {
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid #f0f0f0;

  &:last-child { border-bottom: none; }
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
}

.fee-preview {
  display: flex;
  gap: 12px;
}

.card-select {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.card-option {
  padding: 8px 20px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover { border-color: #409eff; color: #409eff; }
  &.active { background: #409eff; color: #fff; border-color: #409eff; }
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 16px;
}
</style>

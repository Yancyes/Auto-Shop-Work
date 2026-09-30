import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ipc } from '@/api'
import type { ProductTemplate } from '../../shared/types'

export const useTemplateStore = defineStore('template', () => {
  const templates = ref<ProductTemplate[]>([])
  const currentTemplate = ref<Partial<ProductTemplate>>({})
  const loading = ref(false)

  /** 加载模板列表 */
  async function loadTemplates() {
    loading.value = true
    const res = await ipc.invoke('template:list')
    if (res.success && res.data) {
      templates.value = res.data
    }
    loading.value = false
  }

  /** 获取单个模板 */
  async function getTemplate(id: number) {
    const res = await ipc.invoke('template:get', id)
    if (res.success && res.data) {
      currentTemplate.value = res.data
    }
    return res
  }

  /** 保存模板 */
  async function saveTemplate(template: Partial<ProductTemplate>) {
    const res = await ipc.invoke('template:save', template)
    if (res.success) {
      await loadTemplates()
    }
    return res
  }

  /** 删除模板 */
  async function deleteTemplate(id: number) {
    const res = await ipc.invoke('template:delete', id)
    if (res.success) {
      await loadTemplates()
    }
    return res
  }

  /** 重置当前编辑模板 */
  function resetCurrent() {
    currentTemplate.value = {}
  }

  return {
    templates, currentTemplate, loading,
    loadTemplates, getTemplate, saveTemplate, deleteTemplate, resetCurrent
  }
})

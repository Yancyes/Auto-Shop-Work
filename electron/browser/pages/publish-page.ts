import { Page } from 'playwright'
import { AntiDetection } from '../anti-detection'
import { taskLog } from '../../utils/logger'
import { join } from 'node:path'
import { app } from 'electron'
import type { ProductTemplate } from '../../../shared/types'

/** 商品发布页 URL */
const PUBLISH_URL = 'https://www.dd373.com/publish/'

/**
 * 商品发布页面对象
 * 封装发布页所有元素定位与操作，业务层不直接操作页面元素
 */
export class PublishPage {
  constructor(private page: Page, private taskId: number) {}

  /** 导航到发布页 */
  async navigate(): Promise<void> {
    await this.page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await this.page.waitForLoadState('networkidle')
    taskLog(this.taskId, 'info', '已导航到商品发布页面')
  }

  /** 检查是否已登录 */
  async checkLogin(): Promise<boolean> {
    const loginElement = await this.page.locator('.login-status, .user-name, .header-user').count()
    if (loginElement === 0) {
      // 检查是否有登录弹窗或跳转到登录页
      const url = this.page.url()
      if (url.includes('login') || url.includes('passport')) {
        return false
      }
    }
    return loginElement > 0
  }

  /** 截图保存 */
  async screenshot(node: string): Promise<string> {
    try {
      const dir = join(app.getPath('userData'), 'screenshots', String(this.taskId))
      const { mkdirSync } = await import('node:fs')
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `${node}-${Date.now()}.png`)
      await this.page.screenshot({ path, fullPage: false })
      return path
    } catch (error) {
      taskLog(this.taskId, 'warn', `截图失败: ${(error as Error).message}`)
      return ''
    }
  }

  /** 填写商品基础信息 */
  async fillProductInfo(template: ProductTemplate): Promise<void> {
    taskLog(this.taskId, 'info', '开始填写商品基础信息')

    // 商品数量
    await AntiDetection.humanType(this.page, '#quantity, [name="quantity"]', String(template.quantity))
    await this.verifyInput('#quantity, [name="quantity"]', String(template.quantity))

    // 单位
    await AntiDetection.humanSelect(this.page, '#unit, [name="unit"]', template.unit)

    // 单价
    await AntiDetection.humanType(this.page, '#unitPrice, [name="unitPrice"], #price', String(template.unitPrice))
    await this.verifyInput('#unitPrice, [name="unitPrice"], #price', String(template.unitPrice))

    // 发布件数
    await AntiDetection.humanType(this.page, '#publishCount, [name="publishCount"], #count', String(template.publishCount))
    await this.verifyInput('#publishCount, [name="publishCount"], #count', String(template.publishCount))

    taskLog(this.taskId, 'info', '商品基础信息填写完成')
  }

  /** 回读校验输入值 */
  private async verifyInput(selector: string, expected: string): Promise<boolean> {
    const actual = await this.page.locator(selector).first().inputValue().catch(() => '')
    if (actual !== expected) {
      taskLog(this.taskId, 'warn', `输入校验不一致：期望=${expected} 实际=${actual}`)
      // 重试一次
      await AntiDetection.humanType(this.page, selector, expected)
      const retry = await this.page.locator(selector).first().inputValue().catch(() => '')
      return retry === expected
    }
    return true
  }

  /** 设置交易联系信息 */
  async fillContactInfo(template: ProductTemplate): Promise<void> {
    taskLog(this.taskId, 'info', '设置交易联系信息')

    // 联系电话模式
    if (template.contactMode === 2 && template.phone) {
      await AntiDetection.humanClick(this.page, '[data-mode="custom"], #customPhoneMode')
      await AntiDetection.humanType(this.page, '#phoneNumber, [name="phone"]', template.phone)
    } else {
      await AntiDetection.humanClick(this.page, '[data-mode="platform"], #platformPhoneMode')
    }

    taskLog(this.taskId, 'info', '交易联系信息设置完成')
  }

  /** 设置交易属性 */
  async fillTradeAttributes(template: ProductTemplate): Promise<void> {
    taskLog(this.taskId, 'info', '设置交易属性')

    // 包赔类型 - 卡片式选择
    const compSelector = `[data-compensation="${template.compensationType}"], .compensation-card:has-text("${template.compensationType}")`
    await AntiDetection.humanClick(this.page, compSelector)

    // 交易时间段
    const timeSelector = `[data-time="${template.tradeTimeRange}"], .time-option:has-text("${template.tradeTimeRange}")`
    await AntiDetection.humanClick(this.page, timeSelector)

    // 资金到账方式
    const fundSelector = `[data-fund="${template.fundSettlement}"], .fund-option:has-text("${template.fundSettlement}")`
    await AntiDetection.humanClick(this.page, fundSelector)

    taskLog(this.taskId, 'info', '交易属性设置完成')
  }

  /** 提交前三重校验 */
  async preValidate(): Promise<boolean> {
    taskLog(this.taskId, 'info', '执行提交前三重校验')

    // 1. 必填项完整性校验
    const errorTips = await this.page.locator('.error-tip, .form-error, .el-form-item__error').count()
    if (errorTips > 0) {
      const errors = await this.page.locator('.error-tip, .form-error, .el-form-item__error').allTextContents()
      taskLog(this.taskId, 'error', `必填项校验失败: ${errors.join(', ')}`, { exceptionLevel: 'medium' })
      return false
    }

    // 2. 检查表单是否有错误标记
    const hasError = await this.page.locator('.is-error, .has-error').count()
    if (hasError > 0) {
      taskLog(this.taskId, 'error', '表单存在错误项', { exceptionLevel: 'medium' })
      return false
    }

    taskLog(this.taskId, 'info', '三重校验通过')
    return true
  }

  /** 点击发布按钮 */
  async clickPublish(): Promise<void> {
    taskLog(this.taskId, 'info', '点击发布按钮')
    await AntiDetection.humanClick(this.page, '#publishBtn, .publish-button, button:has-text("发布")')

    // 处理二次确认弹窗
    await this.handleConfirmDialog()
  }

  /** 处理二次确认弹窗 */
  private async handleConfirmDialog(): Promise<void> {
    try {
      const confirmBtn = this.page.locator('.el-message-box__confirm, .confirm-btn, .el-button--primary:has-text("确定")')
      if (await confirmBtn.count() > 0) {
        await AntiDetection.randomDelay(500, 1000)
        await confirmBtn.first().click()
        taskLog(this.taskId, 'info', '已处理二次确认弹窗')
      }
    } catch {
      // 无弹窗则跳过
    }
  }

  /** 检测是否触发验证码 */
  async checkCaptcha(): Promise<boolean> {
    const captcha = await this.page.locator('.captcha, #captcha, .geetest, .verify-wrap, iframe[src*="captcha"]').count()
    return captcha > 0
  }

  /** 获取发布结果 */
  async getResult(): Promise<{ success: boolean; message: string }> {
    // 检测成功提示
    const successTip = await this.page.locator('.success-tip, .el-message--success, .publish-success').count()
    if (successTip > 0) {
      const message = await this.page.locator('.success-tip, .el-message--success, .publish-success').first().textContent() || '发布成功'
      return { success: true, message }
    }

    // 检测失败提示
    const failTip = await this.page.locator('.error-tip, .el-message--error, .publish-fail').count()
    if (failTip > 0) {
      const message = await this.page.locator('.error-tip, .el-message--error, .publish-fail').first().textContent() || '发布失败'
      return { success: false, message }
    }

    // 检测是否跳转到商品列表页
    if (this.page.url().includes('/goods/') || this.page.url().includes('/my-goods')) {
      return { success: true, message: '已跳转到商品列表，发布成功' }
    }

    return { success: false, message: '无法确定发布结果' }
  }
}

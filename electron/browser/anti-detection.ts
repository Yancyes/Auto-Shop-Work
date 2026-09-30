import { Page } from 'playwright'
import { getSettings } from '../config'

/**
 * 反检测与真人行为模拟工具
 */
export class AntiDetection {
  /** 随机延迟（毫秒） */
  static async randomDelay(min = 300, max = 1200): Promise<void> {
    const settings = getSettings()
    if (!settings.antiDetection.randomDelay) return
    const delay = Math.floor(Math.random() * (max - min + 1)) + min
    await new Promise(r => setTimeout(r, delay))
  }

  /**
   * 模拟真人鼠标移动 - 贝塞尔曲线轨迹
   * 从起始点到目标点的自然移动
   */
  static async humanMouseMove(page: Page, targetX: number, targetY: number): Promise<void> {
    const settings = getSettings()
    if (!settings.antiDetection.mouseTrace) {
      await page.mouse.move(targetX, targetY)
      return
    }

    // 起点随机
    const startX = Math.floor(Math.random() * 200) + 100
    const startY = Math.floor(Math.random() * 200) + 100

    // 生成贝塞尔曲线中间点
    const steps = 15 + Math.floor(Math.random() * 10)
    const ctrlX = (startX + targetX) / 2 + (Math.random() - 0.5) * 100
    const ctrlY = (startY + targetY) / 2 + (Math.random() - 0.5) * 100

    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      // 二次贝塞尔曲线公式
      const x = (1 - t) ** 2 * startX + 2 * (1 - t) * t * ctrlX + t ** 2 * targetX
      const y = (1 - t) ** 2 * startY + 2 * (1 - t) * t * ctrlY + t ** 2 * targetY
      await page.mouse.move(x, y)
      await new Promise(r => setTimeout(r, 10 + Math.random() * 20))
    }
  }

  /**
   * 模拟真人点击 - 移动到元素后点击
   */
  static async humanClick(page: Page, selector: string): Promise<void> {
    const element = page.locator(selector).first()
    await element.waitFor({ state: 'visible' })
    const box = await element.boundingBox()
    if (!box) throw new Error(`元素不可见: ${selector}`)

    // 在元素范围内随机一个点击点
    const targetX = box.x + box.width * (0.2 + Math.random() * 0.6)
    const targetY = box.y + box.height * (0.2 + Math.random() * 0.6)

    await this.humanMouseMove(page, targetX, targetY)
    await this.randomDelay(100, 300)
    await page.mouse.click(targetX, targetY)
  }

  /**
   * 模拟逐字输入
   */
  static async humanType(page: Page, selector: string, text: string): Promise<void> {
    const settings = getSettings()
    const loc = page.locator(selector).first()
    await loc.click()
    await this.randomDelay(200, 500)

    // 先清空
    await loc.fill('')

    if (settings.antiDetection.typingDelay) {
      for (const char of text) {
        await page.keyboard.type(char, { delay: 50 + Math.random() * 100 })
      }
    } else {
      await loc.fill(text)
    }
    await this.randomDelay(100, 300)
  }

  /**
   * 模拟真人下拉选择
   */
  static async humanSelect(page: Page, selector: string, value: string): Promise<void> {
    await this.humanClick(page, selector)
    await this.randomDelay(200, 400)
    await page.locator(selector).first().selectOption(value)
    await this.randomDelay(100, 300)
  }
}

import { app } from 'electron'
import log from 'electron-log'
import type { Transporter } from 'nodemailer'

const DEV_EMAIL = '2362576803@qq.com'

// 内置授权码已在公开仓库泄露，请尽快到 QQ 邮箱轮换；
// 轮换后通过环境变量 FEEDBACK_SMTP_PASS 注入，内置值仅作为兜底以保证功能可用
const FALLBACK_SMTP_PASS = 'fqcooeeipfptechc'

interface FeedbackPayload {
  content: string
  contact?: string
}

/** HTML 转义，防止用户输入注入邮件模板 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendFeedback(payload: FeedbackPayload): Promise<boolean> {
  const pass = process.env.FEEDBACK_SMTP_PASS || FALLBACK_SMTP_PASS
  if (!process.env.FEEDBACK_SMTP_PASS) {
    log.warn('[feedback] 使用内置 SMTP 授权码（已泄露，建议轮换并通过 FEEDBACK_SMTP_PASS 注入）')
  }

  // nodemailer 体积不小且只有发反馈才用得到：动态导入，不占应用启动时间
  const nodemailer = (await import('nodemailer')).default
  const transporter: Transporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    connectionTimeout: 15000,
    auth: {
      user: DEV_EMAIL,
      pass
    }
  })

  const version = app.getVersion()
  const contact = escapeHtml(payload.contact?.trim() || '未提供')
  const content = escapeHtml(payload.content ?? '')

  await transporter.sendMail({
    from: `"影随TraceFlow反馈" <${DEV_EMAIL}>`,
    to: DEV_EMAIL,
    subject: `[功能建议] v${version}`,
    html: `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2 style="color: #ff6b35;">新功能建议</h2>
        <div style="background: #f5f7fa; padding: 16px; border-radius: 8px; margin: 12px 0;">
          <p style="margin: 0 0 8px; color: #606266; font-size: 13px;">用户反馈内容：</p>
          <p style="margin: 0; color: #303133; white-space: pre-wrap; line-height: 1.6;">${content}</p>
        </div>
        <p style="color: #909399; font-size: 12px;">
          联系方式：${contact}<br/>
          应用版本：v${version}<br/>
          发送时间：${new Date().toLocaleString('zh-CN')}
        </p>
      </div>
    `
  })

  log.info('[feedback] 反馈邮件发送成功')
  return true
}

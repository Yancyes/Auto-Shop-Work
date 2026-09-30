import nodemailer from 'nodemailer'
import { app } from 'electron'
import log from 'electron-log'

const DEV_EMAIL = '2362576803@qq.com'

interface FeedbackPayload {
  content: string
  contact?: string
}

export async function sendFeedback(payload: FeedbackPayload): Promise<boolean> {
  const transporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    auth: {
      user: DEV_EMAIL,
      pass: 'fqcooeeipfptechc'
    }
  })

  const version = app.getVersion()
  const contact = payload.contact?.trim() || '未提供'

  await transporter.sendMail({
    from: `"自动上架工具反馈" <${DEV_EMAIL}>`,
    to: DEV_EMAIL,
    subject: `[功能建议] v${version}`,
    html: `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2 style="color: #ff6b35;">新功能建议</h2>
        <div style="background: #f5f7fa; padding: 16px; border-radius: 8px; margin: 12px 0;">
          <p style="margin: 0 0 8px; color: #606266; font-size: 13px;">用户反馈内容：</p>
          <p style="margin: 0; color: #303133; white-space: pre-wrap; line-height: 1.6;">${payload.content}</p>
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

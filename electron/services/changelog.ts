import https from 'node:https'
import log from 'electron-log'
import type { ChangelogEntry } from '../../shared/types'

const OWNER = 'Yancyes'
const REPO = 'TraceFlow'
const API_PATH = `/repos/${OWNER}/${REPO}/releases?per_page=50`

/** 成功结果常驻内存：历史列表不会在一次运行里变化，失败不缓存以便用户重试 */
let cache: ChangelogEntry[] | null = null

/**
 * 历史更新记录直接读 GitHub Releases。
 * Release 正文本来就是发布时写入的 releaseNotes，再维护一份本地 changelog 只会和它漂移。
 */
export function getChangelog(): Promise<ChangelogEntry[]> {
  if (cache) return Promise.resolve(cache)

  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: 'api.github.com',
        path: API_PATH,
        headers: {
          'User-Agent': 'TraceFlow',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        timeout: 10000
      },
      res => {
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`获取历史更新记录失败（HTTP ${res.statusCode}）`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', c => chunks.push(c as Buffer))
        res.on('end', () => {
          try {
            const list = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            cache = (Array.isArray(list) ? list : [])
              .filter(r => !r.draft)
              .map(r => ({
                version: String(r.tag_name ?? '').replace(/^v/, ''),
                date: String(r.published_at ?? r.created_at ?? ''),
                notes: String(r.body ?? '').trim()
              }))
              .filter((e: ChangelogEntry) => e.version && e.notes)
            resolve(cache)
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)))
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('获取历史更新记录超时')))
    req.on('error', err => {
      log.warn('[changelog] 获取历史更新记录失败:', err.message)
      reject(err)
    })
  })
}

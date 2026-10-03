import { readFileSync, createReadStream, statSync } from 'node:fs'
import { request } from 'node:https'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OWNER = 'Yancyes'
const REPO = 'TraceFlow'
const RELEASE_DIR = join(root, 'release')
const VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const TAG = `v${VERSION}`
const TOKEN = process.env.GH_TOKEN
if (!TOKEN) { console.error('GH_TOKEN env missing'); process.exit(2) }

// 安装包文件名以 latest.yml 记录的 path 为准（由 electron-builder 的 nsis.artifactName 决定），
// 硬编码模板会在改名后上传到不存在的文件
const yml = join(RELEASE_DIR, 'latest.yml')
const ARTIFACT = readFileSync(yml, 'utf8').match(/^path:\s*(.+)$/m)?.[1]?.trim()
if (!ARTIFACT) { console.error('release/latest.yml 缺少 path 字段，无法确定安装包文件名'); process.exit(2) }

const notes = JSON.parse(readFileSync(join(root, 'public', 'version-info.json'), 'utf8')).releaseNotes || ''

function api(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const payload = body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8') : null
    const req = request({
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'publish-script',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...headers
      },
      timeout: 30000
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, text })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    if (payload) req.write(payload)
    req.end()
  })
}

function uploadAsset(uploadUrl, filePath, contentType) {
  return new Promise((resolve, reject) => {
    const size = statSync(filePath).size
    const base = uploadUrl.replace(/\{[^}]*\}$/, '').replace(/\?.*$/, '')
    const u = new URL(base + `?name=${encodeURIComponent(basename(filePath))}`)
    const req = request({
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'publish-script',
        'Content-Type': contentType,
        'Content-Length': size
      },
      timeout: 600000
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('upload timeout')))
    createReadStream(filePath).pipe(req)
  })
}

async function main() {
  // 1. 列出 releases，检查目标 tag 是否已存在
  const listRes = await api('GET', `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`)
  const releases = JSON.parse(listRes.text)
  let release = releases.find(r => r.tag_name === TAG)

  // 2. 创建 draft（如不存在）
  if (!release) {
    const created = await api('POST', `https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
      tag_name: TAG,
      name: TAG,
      body: notes,
      draft: true,
      prerelease: false,
      target_commitish: 'main'
    })
    if (created.status !== 201) { console.error('create failed', created.status, created.text.slice(0, 300)); process.exit(1) }
    release = JSON.parse(created.text)
    console.log('created draft', release.tag_name, 'id=' + release.id)
  } else {
    console.log('release exists', release.tag_name, 'draft=' + release.draft, 'id=' + release.id)
    // 清理可能的半上传资产，重新上传
    for (const a of release.assets) {
      await api('DELETE', `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${a.id}`)
      console.log('removed existing asset', a.name)
    }
  }

  // 3. 上传资产：exe / blockmap / latest.yml
  const exe = join(RELEASE_DIR, ARTIFACT)
  const blockmap = exe + '.blockmap'
  console.log('artifact =', ARTIFACT)
  const uploads = [
    [exe, 'application/octet-stream'],
    [blockmap, 'application/octet-stream'],
    [yml, 'text/yaml']
  ]
  for (const [file, ct] of uploads) {
    const res = await uploadAsset(release.upload_url, file, ct)
    const ok = res.status === 201
    console.log(`upload ${basename(file)} -> ${res.status} ${ok ? 'OK' : res.text.slice(0, 200)}`)
    if (!ok) process.exit(1)
  }

  // 4. 发布 draft -> published
  const pub = await api('PATCH', `https://api.github.com/repos/${OWNER}/${REPO}/releases/${release.id}`, { draft: false })
  console.log('publish ->', pub.status, pub.status === 200 ? 'OK' : pub.text.slice(0, 200))

  // 5. 清理旧版本资产：删掉旧的 .exe（94MB）和旧的 latest.yml（遗留会让跨版本用户
  //    读到旧版本信息、差分退化成全量），但保留旧的 .blockmap。
  //    差分的「旧包基准」来自客户端本地 %LOCALAPPDATA%\<app>-updater\installer.exe
  //    （NSIS 安装时自留的副本，与产物文件名无关），而「旧 blockmap」优先读本地缓存
  //    current.blockmap，缓存缺失（例如用户是手动装的、从没自动更新过）时会回源下载
  //    <旧版本 exe 名>.blockmap —— 删掉它就直接退化成全量下载。blockmap 只有约 100KB，留着即可。
  const older = releases.filter(r => r.tag_name !== TAG && r.draft === false && r.assets.length > 0)
  for (const old of older) {
    for (const a of old.assets) {
      if (a.name.endsWith('.blockmap')) {
        console.log(`keep  ${old.tag_name}: ${a.name}（差分需要）`)
        continue
      }
      const del = await api('DELETE', `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${a.id}`)
      console.log(`cleanup ${old.tag_name}: ${a.name} -> ${del.status}`)
    }
  }
  if (older.length === 0) console.log('no old release assets to clean')

  // 复查：除本次发布外，旧版本不得残留 latest.yml 或 exe（blockmap 允许保留）
  const verify = await api('GET', `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`)
  const remaining = JSON.parse(verify.text)
    .filter(r => r.tag_name !== TAG && r.draft === false)
    .flatMap(r => r.assets.filter(a => !a.name.endsWith('.blockmap')).map(a => `${r.tag_name}/${a.name}`))
  console.log(remaining.length === 0 ? 'verify OK: 旧版本 exe 与 latest.yml 已清空，blockmap 保留' : 'verify WARN 遗留资产: ' + remaining.join(', '))

  console.log('DONE', TAG)
}

main().catch(e => { console.error('ERR', e.message); process.exit(1) })

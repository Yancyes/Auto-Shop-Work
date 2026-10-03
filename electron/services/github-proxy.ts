/**
 * GitHub 请求代理
 *
 * electron-updater 用 Electron 的 net.request 发请求，国内直连 GitHub 下载大文件经常卡死，
 * 所以通过 gh-proxy.com 中转。但版本发现阶段的请求不能一起挂上去：
 * electron-updater 的 GitHubProvider 依次请求
 *   1. github.com/{owner}/{repo}/releases.atom      （解析最新版本条目）
 *   2. github.com/{owner}/{repo}/releases/latest     （拿最新 tag）
 *   3. github.com/{owner}/{repo}/releases/download/{tag}/latest.yml
 * 实测 gh-proxy 对 1 直接返回 404 网页（2 只在部分情况下可用），把元数据转过去只会让
 * electron-updater 报「Cannot parse releases feed」或超时——用户看到的「连接超时」就是这么来的。
 *
 * 策略：元数据（1、2）永远直连；安装包与差分块（体积大）始终走中转；
 * latest.yml 先直连，失败后由 updater 调 markProxyFallback() 升级为走中转再重试。
 */
import { net } from 'electron'
import log from 'electron-log'

const GITHUB_PROXY = 'https://gh-proxy.com/'

/** latest.yml 直连失败过一次，后续该文件改走中转 */
let proxyChannelFile = false

/** Release 资产直链：/releases/download/{tag}/{file} */
const ASSET_PATH = /\/releases\/download\/[^/]+\/[^/]+$/i

/**
 * 元数据请求不能中转（镜像不支持 .atom），由调用方保证直连。
 * updater 在直连失败后调用一次，用于把 latest.yml 也升级到中转。
 */
export function markProxyFallback(): void {
  if (proxyChannelFile) return
  proxyChannelFile = true
  log.info('[proxy] 直连 GitHub 失败，后续更新信息改走 gh-proxy 中转')
}

/**
 * 直连恢复后复位：中转域名自己出问题（国内常见 DNS 失败）时，
 * 不能让它把本来能用的直连路径一起拖死。
 */
export function resetProxyFallback(): void {
  if (!proxyChannelFile) return
  proxyChannelFile = false
  log.info('[proxy] 直连 GitHub 恢复正常，更新信息改回直连')
}

/** 需要中转到返回代理地址，不需要则返回 null */
export function toProxiedUrl(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  // 按 hostname 精确判断：api.github.com 之类不该被误当成 github.com 直链
  if (url.hostname !== 'github.com') return null
  if (!ASSET_PATH.test(url.pathname)) return null
  // 版本发现文件只有几 KB，直连更稳；大文件（exe / blockmap）始终走中转
  if (/\.ya?ml$/i.test(url.pathname)) return proxyChannelFile ? GITHUB_PROXY + rawUrl : null
  return GITHUB_PROXY + rawUrl
}

/** 包装 net.request：命中代理规则的请求改写到中转地址 */
export function installGitHubProxy(): void {
  if (net.request == null) return
  const originalNetRequest = net.request
  net.request = function (options: any) {
    const url = typeof options === 'string' ? options : options?.url
    const proxiedUrl = typeof url === 'string' ? toProxiedUrl(url) : null
    if (proxiedUrl) {
      log.info('[proxy] 中转 GitHub 请求:', url.substring(0, 80))
      return originalNetRequest.call(
        net,
        typeof options === 'string' ? proxiedUrl : { ...options, url: proxiedUrl }
      )
    }
    return originalNetRequest.call(net, options)
  } as typeof net.request
  log.info(`[proxy] GitHub 代理已启用（安装包走 ${GITHUB_PROXY}，版本信息直连优先）`)
}

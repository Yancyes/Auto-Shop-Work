export interface NlAction {
  action: string
  params: Record<string, any>
  description: string
}

interface PatternRule {
  patterns: RegExp[]
  handler: (match: RegExpMatchArray, raw: string) => NlAction
}

const rules: PatternRule[] = [
  {
    patterns: [
      /按[下]?键?\s*(\w+)$/,
      /敲击\s*(\w+)$/,
      /按\s*(Enter|Tab|Escape|Backspace|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|F\d+)$/i,
    ],
    handler: (match) => ({
      action: 'press',
      params: { key: match[1].trim() },
      description: `按下按键 ${match[1].trim()}`
    })
  },
  {
    patterns: [
      /双击[「""]?(.+?)[」""]?$/,
    ],
    handler: (match) => ({
      action: 'dblclick',
      params: { selector: `text=${match[1].trim()}` },
      description: `双击「${match[1].trim()}」`
    })
  },
  {
    patterns: [
      /右键点击[「""]?(.+?)[」""]?$/,
      /右键[「""]?(.+?)[」""]?$/,
    ],
    handler: (match) => ({
      action: 'rightclick',
      params: { selector: `text=${match[1].trim()}` },
      description: `右键点击「${match[1].trim()}」`
    })
  },
  {
    patterns: [
      /点击[「""]?(.+?)[」""]?$/,
      /点[一下]*[「""]?(.+?)[」""]?$/,
      /按下[「""]?(.+?)[」""]?$/,
    ],
    handler: (match) => ({
      action: 'click',
      params: { selector: `text=${match[1].trim()}` },
      description: `点击「${match[1].trim()}」`
    })
  },
  {
    patterns: [
      /(?:在|把)\s*[「""]?(.+?)[」""]?\s*(?:填写|输入|填入|改为|设为)\s*[「""]?(.+?)[」""]?$/,
      /(?:填写|输入|填入)\s*[「""]?(.+?)[」""]?\s*(?:为|成|值)\s*[「""]?(.+?)[」""]?$/,
      /(?:填写|输入|填入)\s*[「""]?(.+?)[」""]?$/,
    ],
    handler: (match) => {
      if (match[2] !== undefined) {
        return {
          action: 'fill',
          params: { selector: `text=${match[1].trim()}`, value: match[2].trim() },
          description: `在「${match[1].trim()}」填入「${match[2].trim()}」`
        }
      }
      return {
        action: 'type',
        params: { text: match[1].trim() },
        description: `输入「${match[1].trim()}」`
      }
    }
  },
  {
    patterns: [
      /清空[「""]?(.+?)[」""]?$/,
      /清除[「""]?(.+?)[」""]?$/,
    ],
    handler: (match) => ({
      action: 'clear',
      params: { selector: `text=${match[1].trim()}` },
      description: `清空「${match[1].trim()}」`
    })
  },
  {
    patterns: [
      /选择[「""]?(.+?)[」""]?$/,
      /勾选[「""]?(.+?)[」""]?$/,
    ],
    handler: (match) => ({
      action: 'click',
      params: { selector: `text=${match[1].trim()}` },
      description: `选择「${match[1].trim()}」`
    })
  },
  {
    patterns: [
      /向上滚动/,
      /往上滚/,
      /滚到上面/,
    ],
    handler: () => ({
      action: 'scroll',
      params: { direction: 'up' },
      description: '向上滚动页面'
    })
  },
  {
    patterns: [
      /向下滚动/,
      /往下滚/,
      /滚到下面/,
    ],
    handler: () => ({
      action: 'scroll',
      params: { direction: 'down' },
      description: '向下滚动页面'
    })
  },
  {
    patterns: [
      /打开(?:网址|页面|链接)\s*[「""]?(https?:\/\/\S+?)[」""]?$/,
      /(?:访问|跳转到|导航到)\s*[「""]?(https?:\/\/\S+?)[」""]?$/,
    ],
    handler: (match) => ({
      action: 'navigate',
      params: { url: match[1].trim() },
      description: `打开网址 ${match[1].trim()}`
    })
  },
  {
    patterns: [
      /后退/,
      /回退/,
      /返回上一页/,
      /回到上一页/,
    ],
    handler: () => ({
      action: 'goBack',
      params: {},
      description: '返回上一页'
    })
  },
  {
    patterns: [
      /前进/,
      /向前/,
    ],
    handler: () => ({
      action: 'goForward',
      params: {},
      description: '前进到下一页'
    })
  },
  {
    patterns: [
      /切换到第\s*(\d+)\s*(?:个|页|标签|页面)/,
      /切换第\s*(\d+)\s*(?:个|页|标签|页面)/,
    ],
    handler: (match) => ({
      action: 'switchPage',
      params: { index: parseInt(match[1]) - 1 },
      description: `切换到第 ${match[1]} 个页面`
    })
  },
  {
    patterns: [
      /截图/,
      /截屏/,
    ],
    handler: () => ({
      action: 'screenshot',
      params: {},
      description: '截取当前页面截图'
    })
  },
  {
    patterns: [
      /等待\s*(\d+)\s*秒/,
      /等\s*(\d+)\s*秒/,
    ],
    handler: (match) => ({
      action: 'evaluate',
      params: { script: `new Promise(r => setTimeout(r, ${parseInt(match[1]) * 1000}))` },
      description: `等待 ${match[1]} 秒`
    })
  },
  {
    patterns: [
      /刷新(?:页面)?/,
      /重新加载/,
    ],
    handler: () => ({
      action: 'evaluate',
      params: { script: 'location.reload()' },
      description: '刷新页面'
    })
  },
]

export function parseNlCommand(input: string): NlAction | null {
  const text = input.trim()
  if (!text) return null

  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern)
      if (match) {
        return rule.handler(match, text)
      }
    }
  }

  return null
}

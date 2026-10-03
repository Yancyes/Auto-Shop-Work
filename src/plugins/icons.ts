import type { App } from 'vue'
import {
  ArrowRight,
  Bell,
  Bottom,
  Calendar,
  ChatDotRound,
  Check,
  CircleCheck,
  Clock,
  Close,
  CopyDocument,
  Delete,
  Download,
  Edit,
  Expand,
  Fold,
  FolderOpened,
  Hide,
  Link,
  List,
  Loading,
  Monitor,
  Plus,
  Promotion,
  Refresh,
  Setting,
  Timer,
  Top,
  VideoCamera,
  VideoPause,
  VideoPlay,
  WarningFilled
} from '@element-plus/icons-vue'

/**
 * 界面用到的图标。
 * 必须显式列出：`import * as 全部图标` 会让 293 个图标组件全进首屏 chunk（约 400KB），
 * 而侧栏/卡片是通过 `<component :is="'List'">` 按名字动态取的，走的是全局注册表。
 * 新增图标时在这里补一行即可。
 */
const icons = {
  ArrowRight,
  Bell,
  Bottom,
  Calendar,
  ChatDotRound,
  Check,
  CircleCheck,
  Clock,
  Close,
  CopyDocument,
  Delete,
  Download,
  Edit,
  Expand,
  Fold,
  FolderOpened,
  Hide,
  Link,
  List,
  Loading,
  Monitor,
  Plus,
  Promotion,
  Refresh,
  Setting,
  Timer,
  Top,
  VideoCamera,
  VideoPause,
  VideoPlay,
  WarningFilled
}

export function registerIcons(app: App): void {
  for (const [name, icon] of Object.entries(icons)) {
    app.component(name, icon)
  }
}

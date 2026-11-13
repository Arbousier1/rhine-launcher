# 默认启动器界面

## 当前默认：侧边栏工作台（feature-plugin shell）

默认入口 `/` → `app.html` → `src/main.tsx`。这是本会话早期已完成、用户在截图中指定要恢复的那版界面。

**它本身就是 DSH 式插件结构**，不是单一巨型组件：

- `src/plugins/catalog.ts` 用 `import.meta.glob('./features/**/*.plugin.{ts,tsx}')` 自动发现并注册，shell 与路由都不知道具体页面存在。
- `features/views/`：10 个页面视图插件（archive、instance、versions、mods、market、accounts、java、logs、settings、plugins），一页一个 `.plugin.tsx`。
- `features/shell/`：7 个外壳行为插件（document-title、help、locale-cycle、reload、sessions、theme-cycle、theme-sync）。
- `features/ui/`：toasts 插件。
- 路由由 `app/routes.tsx` 从注册表派生；slot 由 `plugins/slots.tsx` 提供。

界面要点：左侧分组导航（档案系统／工具）、顶部 `PAGE 中文名` 面包屑、内容区统计条（TOTAL / MICROSOFT / OFFLINE / EXPIRING）、右侧 CURRENT 与 GUIDE 侧栏、底部会话状态与版本。

## 其它入口（保留，非默认）

| 入口 | 构建配置 | 说明 |
| --- | --- | --- |
| `/experimental.html` | `vite.console.config.ts` | 三维档案终端，插件 `archive.ui.experimental`，默认不加载 |
| `/index.html` | `vite.default.config.ts` | 简版 DOM 启动器（`console/default-ui` 的 surface 拆分实验） |

三个入口独立构建，`emptyOutDir: false` 互不覆盖；服务端 `ENTRY_DOCUMENT = 'app.html'`。

## 验证

- 真实浏览器 1600×1000：`/` 渲染侧边栏工作台，导航含档案库／版本／模组／市场／账号／运行时／日志／设置／插件；`#/accounts` 显示 1 个离线账号的完整详情，无浏览器错误。
- 完整回归 1014 通过 / 0 失败 / 1015 总数，68 个文件；三个入口均构建成功。

截图：[账号页](.shots/shell-accounts.png)。

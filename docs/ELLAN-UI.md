# 艾尔岚（Ellan Launcher）风格主页

复刻来源：`https://github.com/EllanStudio/ellanlauncher`（MIT），本会话已 `git clone --depth 1` 到 `.reference/ellanlauncher` 并阅读其源码。

## 只复刻可见 UI

用户明确要求“只把看得见的 UI 作为插件复刻进来”，因此：

- **复刻**：版式、配色、圆角、卡片结构与导航形态。
- **不复刻**：XMCL 的 Electron 主进程、`xmcl-runtime` RPC、`@xmcl/*` 安装与资源库。
- 数据全部来自本启动器的真实能力；没有伪造 XMCL 独有功能。

## 取自源码的实际参数

`xmcl-keystone-ui/src/composables/theme.ts`（品牌调色板，注释即为 “deep pine green, parchment cream, gold accents”）：

| 用途 | 值 |
| --- | --- |
| 深松绿主背景 | `#0b1a16` / 卡片 `#10261fcc` |
| 侧栏半透明 | `#0b1a16b3` |
| 羊皮纸前景 | `#e9e5d3` / `#f7f4e8` |
| 金色主色 | `#d9a441`，强调 `#f0cf7a` |
| 信息/成功/警告/错误 | `#5fb3a8` / `#6bbf8a` / `#f0a23b` / `#e4685c` |

`xmcl-keystone-ui/src/composables/surfaceTokens.ts`：圆角 16px（对话框 32px）、卡片模糊 18px、栏模糊 6px、阴影 `0 12px 40px -8px rgba(0,0,0,.35)`。

版式取自 `windows/main/App.vue` 与 `views/AppSideBarClassic.vue`：左侧窄图标栏（头像 / 主页 / 商店 / 实例列表 / 设置）+ 右侧可滚动内容区，内容为 `HomeGrid` 卡片网格。

## 实现

- `packages/web/src/plugins/features/views/ellan.plugin.tsx` — view 插件 `view.ellan`，占用根路由 `/`，别名 `/ellan`，侧栏名「艾尔岚主页 / ELLAN」。
- `packages/web/src/pages/ellan/EllanPage.tsx` — 页面本体：状态、账号、模组、实例列表、快捷操作五张卡片 + 右上主按钮。
- `packages/web/src/features/ellan/ellan-theme.css` — 上述色票与圆角的实现，作用域限定在 `.ellan`。
- 原档案库移到 `/archive`，仍可访问；`ArchivePage` 的返回链接同步改为 `/archive`。

## 验证

- 真实浏览器 1600×1000，根路由渲染侧栏（艾尔岚主页 / 档案库 / 版本 / 模组 / 市场 / 账号 / …）与五张卡片，主按钮为金色，无浏览器错误。
- 完整回归 **1019 通过 / 0 失败 / 1020 总数，69 个文件**；两个入口均构建成功。
- 过程中修正的真实缺陷：主按钮被宿主样式压成竖排且无底色（提高选择器优先级并禁用 writing-mode）；商店图标路径为空；测试对新根路由的假设。

## 已知限制

- 只做了主页。艾尔岚的其余页面（实例详情、Mod 管理、设置等）仍是本启动器原有界面。
- 卡片为静态网格，未实现其 `grid-layout-plus` 的拖拽与缩放。
- 未移植其背景图、粒子与音效等主题资源。

截图：[艾尔岚主页](.shots/ellan-home.png)。

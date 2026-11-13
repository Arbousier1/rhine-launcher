# 按 DSH 理念插件化

## 参照的 DSH 范式（本会话实际读取）

读取 `E:/software/dsh/resources/app.asar/dsh/node_modules/@deepseek-ai/`（297 个 `dsh-*` 包）与其中三个包后确认：

- **一个能力一个包**：`dsh-atomic-write`、`dsh-client-ui-goal`、`dsh-client-ui-layout` 各自只提供一个能力，包名即能力名。
- **Node 半区 + 客户端半区分离**：`lib/index.js` 是宿主侧，`exports["./client"]` 是浏览器侧；纯 UI 插件的宿主半区是空 `apply()`，只为在 cordis.yml 中出现。
- **依赖显式声明**：`package.json` 的 `dsh.client.inject` 列出该 surface 需要注入的其他客户端插件；`peerDependencies` 只含 `@deepseek-ai/cordis`。
- **文案集中管理**：`locale/zh.json`、`locale/en.json`，键为 `meta.title` 等。
- **UI 由共享 primitives 组合**，surface 插件自身不实现基础控件。

## 改造前的问题

- 默认界面是**一个巨型插件**：三页 UI 与全部事件编排都在 `mount.ts`（231 行），任意一页改动都影响整体，无法单独卸载。
- 23 个动作插件的 `title` 直接等于 capability id，不是人类可读名称。
- 文案硬编码在代码里。

## 改造后的结构

```
console/default-ui/
  shell.plugin.ts        surface.shell      外壳（导航 + 插槽 + 账户/状态栏）
  layout.ts              布局实现，只渲染骨架，不含任何业务页
  slots.ts               表面插槽注册表（共享数据，不暴露能力）
  locale/zh.json         文案目录
  locale.ts              t() 取值与替换，缺失键在开发期告警
  shell-state.ts         共享 UI 状态（非插件）
  surfaces/
    instances.plugin.ts  surface.instances  实例列表、启动、实例设置
    downloads.plugin.ts  surface.downloads  版本、组件卡片、安装任务
    settings.plugin.ts   surface.settings   账户、Java、全局、关于
  views-*.ts / api.ts    纯渲染与只读协议辅助，不含能力
```

- 每个 surface 是独立 `defineFeature`，自己声明 `optionalDepends`、自己持有监听与清理。
- 外壳通过 `listSurfaces()` 枚举插槽并切换，**不引用任何具体页面**。
- 卸载某个 surface 只移除它的标签与内容，其余不受影响。
- 动作插件全部改为中文可读标题（如「检查 Modrinth 更新」「导入整合包」）。

## 验证

- 新增 `packages/web/test/default-ui-plugins.test.ts`（4 项）：插槽按 order 排序、卸载只移除自身、订阅通知、locale 取值与替换。
- 真实浏览器：导航渲染出「游戏实例 / 下载 / 设置」三项，对应 capability `surface.instances` / `surface.downloads` / `surface.settings`，实例页完整显示启动按钮与信息卡，无浏览器错误。
- 完整回归 **1014 通过 / 0 失败 / 1015 总数，68 个文件**；两个入口构建成功。

## 已知限制

- 仍是单一 web 包内的多模块插件，而非 DSH 那样每个 surface 一个 npm 包；原因是要复用现有 Vite 构建与插件宿主，尚未拆包发布。
- `dsh.client.inject` 式的跨包注入未引入，依赖仍用 cordis 的 `optionalDepends` 表达。
- Node 与客户端半区未分离（本项目无宿主侧 surface 需求）。

# Rhine Launcher 架构说明

> **当前性能/边界修复状态：** 高级账号认证、模组/市场和整合包导入已接入原生面板；已补齐取消、重开、实例绑定与不兼容构建边界。原图形质量保留，GPU 提交和 UI 帧率分别统计。最新证据见[性能记录](docs/PERFORMANCE.md)。下方较早章节的兼容入口说明属于历史状态。


> **2026-10-26 原生入口说明：** 默认入口现在是实际 RhineLabUI 源码衍生；实例/安装版本分开，保留原镜头与抽取，操作通过独立 capability 接入。旧 React 章节描述兼容管理入口，不代表全部管理页面已原生化。本轮状态以[验证记录](VERIFICATION.md)和[来源接缝](packages/web/src/console/VENDOR.md)为准。


> 一个功能 = 一个描述文件 = 一个 capability = 一个 Cordis fiber。
> 设计依据：Cordis 的 context 范式（[arXiv:2608.25512](https://arxiv.org/abs/2608.25512)）
> 与 DeepSeek Harness 的插件加载器实现。详见 [docs/CONTEXT-PARADIGM.md](./docs/CONTEXT-PARADIGM.md)。

## 0. 落盘位置

```
packages/plugin-api   单功能插件契约（defineFeature）+ FeatureRuntime
packages/core         单功能后端插件（plugins/features/**）与纯算法实现
packages/core/test    vitest（算法回归 + 真实插件图 + 内容事务 + 真实进程）
packages/server       Hono + ws 通用传输宿主
packages/web          React 19 + Vite + three.js，单功能前端插件
```

Node 24 / pnpm 12 workspace。`packages/core/src/types.ts` 与 `contracts.ts` 是跨包编译期契约，
新增字段可以，改已有字段需要协调。

## 1. 单功能插件契约

```ts
import { defineFeature } from '@rhine/plugin-api'

export default defineFeature<Input, Output>({
  id: 'file.write',              // 稳定 id，同时是 capability
  capability: 'file.write',      // 必须与 id 相同
  title: '写入实例文本文件',
  depends: ['paths.get', 'instance.get'],
  optionalDepends: ['events.emit'],   // 缺失不阻塞，也不级联卸载
  http: { method: 'PUT', path: '/api/instances/:id/file', decode, encode, status },
  execute(input, env) { /* 唯一公开动作 */ },
  setup(env) { /* 可选的运行期副作用，必须登记逆操作 */ },
})
```

规则：

- 一个文件、一个默认导出、一个 capability。运行时拒绝 `capabilities` / `features` / `routes` 这类多能力描述。
- 跨插件调用只能走声明的依赖：`env.use<Output>('capability', input)`；未声明会抛
  `UNDECLARED_DEPENDENCY`。旧的 `ctx.*` 命名空间只是宿主生成的转发投影，不能绕过声明。
- 状态用 `env.state(key, init, cleanup)`；副作用用 `env.onDispose(...)`；
  取消用 `env.signal`，长任务还要调用 `env.task.throwIfCancelled()`。

## 2. 运行时语义（FeatureRuntime）

- 每个插件一个真实 `ctx.plugin()` fiber，而不是注册表里的布尔位。
- 依赖缺失 → `blocked`；依赖恢复 → 自动重新激活；`optionalDepends` 只影响自身可用性。
- 停用会 abort 在途调用、等待可协作的取消、按依赖逆序释放 fiber；调用方收到 503。
- 配置以稳定 id 描述：`reconcile(entries)` 只重载语义发生变化的节点及其下游；
  校验失败不产生任何变更；激活失败恢复旧组合。
- `replace(id, definition)` 事务性替换同一 id 的实现，失败恢复旧实现与旧依赖图。
- 关闭/重启：`plugins.json` 保存 `{ disabled, entries }`；重启后恢复相同组合。

## 3. 启动装配（server 的 main.ts）

```ts
const ctx = await createLauncherContext({ root })   // 扫描 features/**/*.plugin.ts
const app = createServerApp(ctx)                    // 通用 HTTP 转发
const ws = attachWebSocket(server, ctx)             // 通用事件转发
```

没有功能清单、没有 `ctx.plugin(metaPlugin)` 之类的硬编码装配。新增功能只需新增一个描述文件。

## 4. HTTP / WS 约定

- 全部 JSON，前缀 `/api`；错误统一 `{ code, message, detail? }`。
- 路由来自插件的 `http` 元数据：`{ method, path, decode, encode, status, background, notFoundMessage }`。
  未声明路由 → 404；插件被停用 → 503 `PLUGIN_UNAVAILABLE`。
- `background` 由 `task.submit` 执行，返回 `202 { taskId, title }`，进度通过事件流推送。
- 请求体上限 1 MiB；只接受本机 Host/Origin；静态资源只从 `packages/web/dist` 读取。
- `WS /ws` 只转发 `events.subscribe.public`（脱敏后的 `ServerEvent`），另支持 `ping` / `bootstrap`。
- 前端统一走 `packages/web/src/api/client.ts`，不要在组件里手写 `fetch`。

## 5. 数据目录

```
<dataDir>/                    默认 %APPDATA%/RhineLauncher（可在设置里覆盖）
  instances/<id>/             .minecraft 等价目录（instance.json 存配置）
  versions/<id>/<id>.json     版本 json（含加载器合并结果）
  libraries/                  maven 布局
  assets/indexes|objects/     资源
  java/<component>/           自动下载的 JRE
  logs/                       启动器日志
  launcher.json               全局设置
  accounts.json               账号
  plugins.json                插件启停与配置
```

实例目录就是 `.minecraft`，`mods/`、`resourcepacks/`、`shaderpacks/`、`saves/` 与 HMCL 一致。

## 6. 持久化与事务

- 配置文件写入复用 `@deepseek-ai/dsh-atomic-write`（`writeFileAtomic` + `withFileLock`）：
  随机后缀临时文件、独占创建、rename 提交、Windows 重试、权限保留。
- 整合包导入：严格 ZIP 预检 → 下载并校验每个文件 → 写入私有 staging → 原子 rename 发布实例；
  取消或失败只清理本次 staging。
- 模组更新：服务端签发一次性提案（绑定旧文件快照与远端哈希）→ 校验旧文件未变 → 下载校验 →
  备份 → rename → 失败恢复；`.disabled` 状态随文件名保留。
- 游戏、模组、世界、账号属于已提交数据，插件卸载不会删除它们。

## 7. 安全边界

- 不接受 http 远端下载（仅本机回环）；所有下载必须提供哈希或明确大小，失败不静默跳过。
- 路径统一白名单校验：实例内相对路径、拒绝符号链接与 Windows 保留名、ZIP 条目逐条校验。
- 凭据（accessToken / refreshToken / clientToken / password / deviceCode / CurseForge key）
  不进入 HTTP 快照、会话命令行、日志或公开事件。
- 论文 §6.3 明确指出 context 访问约束不是恶意代码沙箱；本项目只自动加载内置或用户明确指定的可信插件目录。
- 微软登录只使用使用者自己的 OAuth public client；不借用他人应用身份。

## 8. 视觉规范（web）

从 RhineLabUI 提取的基线：

- 底色 `#f2f0eb`，文字 `#171713`，暖杏金 `#c98b3f` / `#d8a15a`，分割线 `#bdb8ad`，
  次要文字 `#77756d`，面板 `#e9e6df`，输入底 `#f7f5f1`。
- 字体 MiSans（后备 PingFang SC / Microsoft YaHei / system-ui）；字号阶 12 / 13 / 15 / 20 / 28 / 44。
- 1px 细线、圆角 ≤ 4px；不要大圆角卡片与渐变光晕。
- 动效 180 / 220 / 300ms 三档；`prefers-reduced-motion` 全部瞬时化。
- 主结构：左侧窄导航、中部内容、顶部细线 + 英文小标。

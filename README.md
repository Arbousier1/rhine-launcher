# Rhine Launcher

**TypeScript + Cordis 的 Minecraft 启动器。** 后端行为参考 [HMCL](https://github.com/HMCL-dev/HMCL)，不采用 HMCL 的界面；插件和可逆副作用遵循 [context 范式](https://arxiv.org/abs/2608.25512)。主界面直接基于 [RhineLabUI](https://github.com/LBEILC/RhineLabUI) 原源码衍生，并参考 [Rhine-Music-Database](https://github.com/MikeQu223/Rhine-Music-Database) 把业务融入场景的方式。

## 选的是游戏环境，不是一串裸版本号

- **我的实例**是默认入口：大标题显示玩家命名/整合包名称，摘要标明 Minecraft 版本、加载器与最近启动日期。不同配置的同版本实例不会合并。
- **安装版本**与已有实例分开：默认稳定版，快照/历史版显式选择，再按版本系列缩小范围。大量记录仍只显示最多 8 个可见刻度。
- 保留原 GLB、镜头、波浪、垂直抽取与归位。点击实体或原生读取按钮，在同一张档案里查看概况。
- 已有实例显示账号、启动/停止；待安装版本显示官方 Java 要求与真实查询的加载器构建，再创建独立实例。缺少兼容构建或元数据失败，不伪装为可安装。
- 安装与准备状态来自真实任务/请求；可取消安装，不用固定时长的假进度。

![原生实例档案](.shots/operations-derived-instance-detail.png)

主入口：[http://127.0.0.1:6550/](http://127.0.0.1:6550/)。高级账号认证、整合包预检/导入、模组与内容市场现已接入原生弹窗。设置中可直接打开这些管理功能，不再依赖兼容页。

性能与已知边界修复说明见[性能记录](docs/PERFORMANCE.md)：保留原画质，减少目录扫描、无效 DOM 工作、资源分配和 GPU 排队；UI 回调与实际绘制 FPS 分开记录。

[来源、许可与改动接缝](packages/web/src/console/VENDOR.md) · [真实验证范围](VERIFICATION.md)

## 一切皆插件

> 一个功能 = 一个描述文件 = 一个 capability = 一个可单独启停、可单独卸载的真实 Cordis fiber。

- 后端按目录自动发现单功能插件（`packages/core/src/plugins/features/**/*.plugin.ts`），目录扫描自动发现，
  没有任何硬编码的功能路由表或功能装配清单。
- 原生主界面使用真实 FeatureRuntime：数据、目录、任务、认证、模组、整合包及各面板均由独立能力装配。
  React 兼容入口保留自己的插件宿主；不能把它的插件数量冒充原生界面的完成程度。
- HTTP 宿主只做「方法 + 路径 + decode/encode」的通用匹配转发；WebSocket 宿主只转发
  `events.subscribe.public`。校验、策略与错误语义属于插件本身。
- 依赖是声明式的：缺少依赖的插件显示 `blocked` 并返回 503，兄弟功能继续工作；依赖恢复后自动重新激活。
- 停用/卸载只撤销该插件登记的运行期副作用（监听器、fetch、子进程、Three.js renderer、定时器）；
  **已经下载并校验完成的游戏、模组、世界与账号不会被删除**（论文 §6 的 acquisition / emission 边界）。

## 快速开始

```bash
pnpm install
pnpm build          # 构建前端到 packages/web/dist
pnpm start          # 本地服务，默认 http://127.0.0.1:6550
```

开发模式（前端热更新）：

```bash
pnpm dev:server                     # 后端 :6550
pnpm --filter @rhine/web dev        # 前端 :5183（已代理 /api 与 /ws）
```

数据目录默认 `%APPDATA%\RhineLauncher`，可用 `RHINE_HOME` 覆盖，或在设置页修改。
插件启停持久化在数据目录的 `plugins.json`。

## 能力状态

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 原版安装（client jar / libraries / assets / logging） | ✅ | 四个独立安装插件组合成工作流；均校验 SHA1 与大小 |
| Fabric / Quilt 安装 | ✅ | 纯 profile 合并，独立 `loader.*.install` |
| Forge / NeoForge 安装 | ✅ | 真实 installer `--installClient`，预取 processors 依赖并校验；失败恢复旧版本 |
| OptiFine 安装 | ✅ | 真实 `optifine.Patcher` 打补丁 + 内置 launchwrapper；失败恢复旧补丁与旧 json |
| Java 扫描 / Mojang JRE 下载 | ✅ | 独立 `java.scan` / `java.pick` / `java.install` |
| 启动（真实进程、日志、退出码、游玩时长） | ✅ | 不经 shell；凭据在日志与会话快照中脱敏；卸载启动插件会终止其子进程 |
| 离线账号 | ✅ | RFC4122 v3 UUID |
| 微软设备码登录 | 🟡 | 完整 device-code → XBL → XSTS → Minecraft 链路；**必须使用你自己注册的 public client app**（设置页或 `RHINE_MICROSOFT_CLIENT_ID`），不借用他方应用身份 |
| authlib-injector 外置登录 | ✅ | Yggdrasil 认证、刷新、校验；启动时注入 agent |
| 整合包导入（mrpack / CurseForge zip） | ✅ | 严格 ZIP 预检、哈希校验、路径穿越拒绝、暂存后原子提交 |
| 模组更新检查（Modrinth / CurseForge） | ✅ | 每种来源独立插件；区分 `update` / `current` / `unknown` / `error`，不伪报「全部最新」 |
| 模组更新应用 | ✅ | 服务端签发的一次性提案；校验哈希与旧文件未变、保留 `.disabled`、失败回滚 |
| 模组市场 | ✅ | 每种来源的 search / project / versions / install 各自独立；**CurseForge 零密钥即可搜索与下载**（自有 Key 直连，无 Key 自动走镜像） |
| 实例、文件、日志、崩溃分析、任务、插件管理 | ✅ | 均为单功能插件 |

## 凭据配置

凭据一律通过环境变量注入，优先级为 **请求参数 → 环境变量 → `launcher.json`**：

```bash
cp .env.example .env          # 然后填写
RHINE_MICROSOFT_CLIENT_ID=    # 你自己的 Entra 应用 ID（设备码登录，公开客户端，无需 secret）
RHINE_CURSEFORGE_API_KEY=     # 可选；不填则走镜像，仍可搜索与下载
```

- 微软 App ID 的注册流程与实测记录：[docs/MICROSOFT-OAUTH-APP-ID.md](docs/MICROSOFT-OAUTH-APP-ID.md)
- CurseForge 的端点差异、PCL2/HMCL 对照与实测：[docs/CURSEFORGE.md](docs/CURSEFORGE.md)
- 密钥永不进入 HTTP 响应、前端产物或日志（`packages/core/src/config/secrets.ts`）。

## 与 HMCL 的差异

- 不提供借用第三方 OAuth 应用身份的微软登录；这是有意的合规限制。
- 更新只做检查与应用，不静默替换用户文件。
- CurseForge 支持零密钥镜像回退，可用 `mirror: null` 关闭。

## 目录结构

```
packages/plugin-api     单功能插件契约 + FeatureRuntime（真实 Cordis fiber、配置协调、事务替换）
packages/core           121 个单功能后端插件 + 纯算法实现
packages/server         Hono + ws 通用传输宿主（只按插件声明的元数据转发）
packages/web            原生 DOM + 原版 three.js 场景；React 仅用于兼容管理入口
```

## 前端视觉

保留原项目的场景、镜头与交互状态，不再使用自制托盘或居中三维核心。字体与模型由构建前校验保证完整，图形依赖锁定原版本。详细来源和允许的差异见[衍生记录](packages/web/src/console/VENDOR.md)。

## 开发

```bash
pnpm test        # vitest：36 个文件 / 760 个用例
pnpm typecheck   # tsc --noEmit
```

架构约定见 [ARCHITECTURE.md](./ARCHITECTURE.md)、[docs/PLUGIN-CONTRACT.md](./docs/PLUGIN-CONTRACT.md) 与
[docs/CONTEXT-PARADIGM.md](./docs/CONTEXT-PARADIGM.md)；功能对照见 [FEATURE-PARITY.md](./FEATURE-PARITY.md)；
真实验证记录见 [VERIFICATION.md](./VERIFICATION.md)。

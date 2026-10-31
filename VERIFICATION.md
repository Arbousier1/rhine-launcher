# 验证记录

> 最新 ENTER SYSTEM 专项：[说明](docs/ENTER-SYSTEM.md)、[回归](.reference/enter-final-regression.json)、[正常/重播/取消](.reference/enter-lifecycle.json)。55 个文件，884 项通过、1 项可选联网用例跳过、0 失败；点击后着色器链接长任务消失。

> 本轮性能与原生管理更新以[性能记录](docs/PERFORMANCE.md)、[原生管理结果](.reference/native-management-final.json)及[最终回归](.reference/performance-final-regression.json)为准。最终类型检查与构建通过：53 个测试文件，876 项通过、1 项可选联网用例跳过、0 失败。原生认证、模组/市场、整合包已接入，不再以兼容页作为这些功能的完成标准。

## 当前原生界面（2026-10-26）

此前自制托盘、侧栏页面的截图和 DOM 检查不作为当前界面验收证据。当前根入口是实际 RhineLabUI 源码的原生衍生。

- 构建先校验 766 个字体/模型相关文件；Three.js 0.183.2 与原项目一致。
- Chromium 使用 NVIDIA RTX 5060 Laptop / D3D11，1440×810；保持默认画质和原动画。先前强制 SwiftShader 的测试只有约 0.1 FPS，不以改动画方程或降低默认画质掩盖该测试环境瓶颈。
- 真实鼠标/键盘进入系统，点击可见跳过按钮，抽取、归位、筛选与配置；不调用内部 archive()/detail() 强制模式，也不强行显现隐藏按钮。截图等待原解密 phase=clear 和抽取完成。
- 真实实例：验证实例 / Minecraft 1.20.1 / Fabric 0.20.1，账号 Steve（离线）。大标题是实例名，内部编号为次要信息。
- 实际读取 103 个稳定版本（该次响应，不写死），按 1.20.x 筛选、检索 1.20.1。官方元数据给出 1.20.6 需要 Java 21。
- Fabric 1.20.1 的兼容列表返回 255 个构建，实际选择 0.20.1；未把仅有版本列表当成该加载器全部安装链路的验证。
- 在实例卡内点击启动：请求的 instanceId/accountId 与当前选择一致，创建了实际进程 PID 49424，随后在同一卡内点击停止，确认 stopped。
- 从待安装版本配置创建唯一临时实例，原版安装任务实际 succeeded（该次 3575/3575 资源，已有缓存被校验/复用）；界面跟随新实例，没有跳到另一套安装页面。
- 任务验收依据是界面实际等待的任务 ID，而不是猜测记录包含 startedAt 字段。
- 仅删除本轮创建且核对绝对路径的临时实例；共享游戏库、原实例与账号保留。
- 两轮真实操作中浏览器 errors=[]；最终受控操作脚本 exit 0。

### 可复查记录

- [选择与构图检查](.reference/native-derivative-review.mjs) / [结果](.reference/native-derivative-review.json)
- [真实操作与受控清理](.reference/native-operations-review.mjs) / [结果](.reference/native-operations-review.json)
- [实例详情](.shots/operations-derived-instance-detail.png) / [安装配置](.shots/operations-derived-version-config.png)

最终回归：42 个测试文件，836 项通过、1 项条件跳过、0 失败；类型检查与两套生产入口构建通过。原生目录、桥接、资源完整性、平台效果清理与任务等待均已覆盖。数量不替代视觉和真实操作验证。

最终还验证了：在真实 3D 画布 (380,320) 悬停命中当前卡片后直接点击，进入同一实例详情；原暗色配色渐变完成；兼容管理入口独立加载而不执行原生入口。见[最终视觉记录](.reference/native-final-visual.json)。

源码对照确认运动、循环索引、拖拽、材质、视口布局、基础样式与开场实现除行尾外保持原样；场景差异仅在数据标签、点击激活与载入取消接缝。见[对照结果](.reference/native-derivation-audit.json)。

## 明确边界

- 原生界面覆盖选择/创建/启动及高级账号认证、模组/市场、整合包导入；合法 OAuth/第三方 API 配置仍需用户提供。
- 实际安装复用已有 1.20.1 资源，不冒充再次下载全部 702 MB。
- 微软登录需要用户合法注册的 public client ID，不能把 unauthorized_client 当作成功。
- NeoForge 版本查询与完整安装处理器的真实验证不同，保留记录按各自实际范围理解。

## 以下为保留的后端历史验证

## 3. 原版安装（真实下载）

| 项 | 数值 |
| --- | --- |
| 文件总数 | 3644 |
| 占用空间 | 702 MB |
| 内容 | client jar + 88 个 libraries + 3600+ assets + assetIndex + version json |

安装被拆为 `minecraft.client.install`、`minecraft.libraries.install`、`minecraft.assets.install`、
`minecraft.logging.install`，由 `version.install` 组合调用；每步独立可停用。

## 3b. 真实加载器链路（运行中的服务，真实网络）

```
GET  /api/loaders/fabric?gameVersion=1.20.1     → 255 个版本
GET  /api/loaders/optifine?gameVersion=1.20.1   → 14 个版本
GET  /api/loaders/neoforge?gameVersion=1.20.1   → 61 个版本
POST /api/loaders/fabric/install {0.20.1}       → task succeeded
GET  /api/versions/installed                    → 1.20.1, fabric-loader-0.20.1-1.20.1, 1.20.1-OptiFine_HD_U_I6
POST /api/loaders/optifine/install {HD_U_I6}    → task succeeded
GET  /api/versions/1.20.1/loaders               → fabric 0.20.1 + optifine HD_U_I6
POST /api/launch/build (fabric 实例)            → KnotClient / 52 条 classpath / 41 参数 / 凭据脱敏
```

OptiFine 生成物（真实 Patcher 输出）：

```
libraries/optifine/OptiFine/1.20.1_HD_U_I6/OptiFine-1.20.1_HD_U_I6.jar   6,638,739 B
libraries/optifine/launchwrapper-of/2.3/launchwrapper-of-2.3.jar            15,930 B
```

Fabric 启动计划的 mainClass 为 `net.fabricmc.loader.impl.launch.knot.KnotClient`，
classpath 同时含继承的原版 `1.20.1.jar` 与 fabric 运行库，说明 `inheritsFrom` 合并与加载器选择正确。

## 3c. 微软认证的真实网络行为

`POST /api/accounts/microsoft/start`（使用一个格式合法但未注册的 client_id）得到微软真实响应：

```
400 {"code":"unauthorized_client","message":"…当前应用不允许使用设备码登录。请在应用注册中启用公共客户端流…"}
```

即：请求确实到达 Microsoft identity platform；启动器不会回退到他人的应用身份，也不会把失败伪装成成功。

## 4. Java 运行时

自动下载的 Mojang JRE：`.rhine-dev/java/java-runtime-gamma/bin/java.exe`（17.0.15）。

## 5. 启动命令行

`POST /api/launch/build` → 39 个参数 / 44 条 classpath（1.20.1 原版）。
加载器版本选择现在依据版本 json 的 `inheritsFrom` 与加载器元数据，而非目录名字符串推断，
因此 NeoForge 1.20.1 的 `net.neoforged:forge` 过渡命名也能正确识别。

## 6. 内容事务（真实 HTTP + 真实文件）

`packages/core/test/content-plugins.test.ts`（12 项，本地 HTTP 服务器）：

- Modrinth 整合包：下载 `files[].downloads`、校验 sha1/sha512、override → client-override 覆盖顺序。
- CurseForge 整合包：真正读取 `manifest.files` 并下载每个 fileID，而不是只解压 overrides。
- 作者禁止第三方下载时明确失败，并**不创建实例**。
- 清单/压缩包路径穿越、损坏下载、仅停用 Modrinth 导入插件等负路径均按预期拒绝或隔离。
- 更新检查区分 `update` / `current` / `unknown` / `error`；应用更新校验哈希与旧文件未变、
  保留 `.disabled`、坏哈希回滚、伪造/过期提案被拒绝。

## 7. 启动进程（真实子进程）

`packages/core/test/process-feature.test.ts`（3 项）：

- 捕获真实子进程 stdout/stderr 并写入会话日志；访问令牌被替换为 `<redacted>`。
- 退出码、结束时间、游玩时长持久化；卸载 `launch.spawn` 会终止子进程，但`session.list` 仍可查看历史。
- 拒绝把 `.cmd`/`.bat`/`.ps1` 当 Java 可执行文件。

## 8. 微软登录的边界

设备码流程本身已实现并有单元测试（含自有 client app 校验、authority 限制、令牌刷新）。
端到端登录必须由使用者提供自己注册的 public client application；启动器不内置、不借用他方应用身份，
因此这一项标记为 🟡 而不是「已完全跑通」。

# 功能对照表（HMCL ↔ Rhine Launcher）

> **当前性能/边界修复状态：** 高级账号认证、模组/市场和整合包导入已接入原生面板；已补齐取消、重开、实例绑定与不兼容构建边界。原图形质量保留，GPU 提交和 UI 帧率分别统计。最新证据见[性能记录](docs/PERFORMANCE.md)。下方较早章节的兼容入口说明属于历史状态。


> **2026-10-26 原生入口说明：** 默认入口现在是实际 RhineLabUI 源码衍生；实例/安装版本分开，保留原镜头与抽取，操作通过独立 capability 接入。旧 React 章节描述兼容管理入口，不代表全部管理页面已原生化。本轮状态以[验证记录](VERIFICATION.md)和[来源接缝](packages/web/src/console/VENDOR.md)为准。


状态：✅ 已实现并通过测试 · 🟡 已实现但有外部前提/已知限制 · ⬜ 未实现

「实现位置」一律是**单功能插件**文件；算法细节在同目录的纯实现模块里。

## 版本与安装

| 能力 | 状态 | 插件 |
| --- | --- | --- |
| Mojang 版本清单（缓存 + 失败回退旧清单） | ✅ | `version/list.plugin.ts` |
| 版本 json / 继承链合并 | ✅ | `version/get.plugin.ts`、`version/chain.plugin.ts` |
| 规则求值、参数求值、classpath/natives | ✅ | 纯函数 `core/src/meta/**`、`core/src/runtime/**` |
| 原版安装 | ✅ | `version/install.plugin.ts` + `minecraft/{client,libraries,assets,logging}-install` |
| 下载校验（SHA1/256/512、大小、限流、镜像重试） | ✅ | `download/{text,buffer,file,batch}.plugin.ts` |
| 镜像切换 | ✅ | `settings/update.plugin.ts`（仅 HTTPS，本机回环例外） |
| Fabric / Quilt | ✅ | `loaders/{fabric,quilt}-{list,install}.plugin.ts` |
| Forge / NeoForge | ✅ | `loaders/{forge,neoforge}-{list,install}.plugin.ts`（真实 installer + processor 预取） |
| OptiFine | ✅ | `loaders/optifine-{list,install}.plugin.ts`（真实 Patcher + launchwrapper） |
| LiteLoader | ⬜ | 未实现 |

## Java

| 能力 | 状态 | 插件 |
| --- | --- | --- |
| 扫描 JAVA_HOME / PATH / 常见目录 / 托管目录 | ✅ | `java/scan.plugin.ts` |
| 按版本挑选运行时 | ✅ | `java/pick.plugin.ts` |
| Mojang JRE 下载安装 | ✅ | `java/install.plugin.ts` |
| Adoptium / Zulu / Microsoft 多源 | ⬜ | 目前只接 Mojang 官方 JRE |

## 实例与启动

| 能力 | 状态 | 插件 |
| --- | --- | --- |
| 实例 CRUD / 复制 / 删除 | ✅ | `instance/*.plugin.ts`（create/get/list/update/remove/duplicate…） |
| 文件浏览 / 文本读写 / 删除 | ✅ | `file/*.plugin.ts`（读写分离，符号链接与越界拒绝） |
| 启动计划构造（含 Java 检查、加载器选择） | ✅ | `launch/prepare.plugin.ts`、`version/select.plugin.ts` |
| 参数预览（凭据脱敏） | ✅ | `launch/build.plugin.ts` |
| 真实进程启动 / 日志 / 退出码 | ✅ | `launch/spawn.plugin.ts`、`launch/start.plugin.ts` |
| 会话列表 / 读取 / 停止 / 日志 | ✅ | `session/*.plugin.ts` |
| 崩溃分析 | ✅ | `diagnostics/analyze.plugin.ts` |

## 账号

| 能力 | 状态 | 插件 |
| --- | --- | --- |
| 离线账号（RFC4122 v3） | ✅ | `auth/offline-login.plugin.ts` |
| 微软设备码登录 | 🟡 | `auth/microsoft-{begin,complete,refresh}.plugin.ts`；需自建 public client app |
| 账号读取 / 删除 / 授权 | ✅ | `accounts/*.plugin.ts`、`accounts/authorize.plugin.ts` |
| Yggdrasil 外置登录 / 刷新 / 校验 | ✅ | `auth/yggdrasil-*.plugin.ts` |
| authlib-injector agent 准备 | ✅ | `auth/agent-prepare.plugin.ts`（官方清单校验 + 镜像回退） |

## 模组与内容

| 能力 | 状态 | 插件 |
| --- | --- | --- |
| 扫描与元数据解析 | ✅ | `mods/list.plugin.ts`、`mods/inspect.plugin.ts` |
| 启用/禁用、删除、URL 安装、本地导入 | ✅ | `mods/{toggle,remove,install,import}.plugin.ts` |
| Modrinth / CurseForge 搜索、项目、版本、安装 | ✅ | `market/<source>-{search,project,versions,install}.plugin.ts` |
| 整合包导入（mrpack / CurseForge） | ✅ | `modpacks/{identify,modrinth-import,curseforge-import,import}.plugin.ts` |
| 更新检查（分来源） | ✅ | `updates/{modrinth,curseforge}-check.plugin.ts` |
| 更新应用（事务 + 回滚） | ✅ | `updates/apply.plugin.ts` |
| 依赖自动补全 | 🟡 | 展示依赖，不自动下载缺失依赖 |

## 宿主与系统

| 能力 | 状态 | 插件 |
| --- | --- | --- |
| 启动快照 / 健康检查 | ✅ | `system/{bootstrap,health}.plugin.ts` |
| 插件列表 / 启停 / 配置协调 | ✅ | `system/plugins-{list,enable,disable,configure}.plugin.ts` |
| 打开目录 / 外部链接 | ✅ | `system/{reveal,open-external}.plugin.ts` |
| 公开事件脱敏与订阅 | ✅ | `events/{redact,public-subscribe}.plugin.ts` |

## 前端

| 能力 | 状态 |
| --- | --- |
| 暖灰白 / 墨黑 / 暖杏金设计令牌 | ✅ |
| 启动动画、三维档案核心、扫描线、解密文字、滚动数字、FLIP、尘埃 | ✅（各自独立插件） |
| 档案库 / 版本库 / 实例详情 / 模组 / 市场 / 账号 / 设置 / Java / 日志 / 插件页 | ✅（各自独立视图插件） |
| 插件管理（前后端可分别启停，状态含 blocked/failed） | ✅ |
| 三套主题 | ✅ |
| 减少动态效果适配 | ✅ |

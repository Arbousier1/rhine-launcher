# Microsoft OAuth 应用注册（App ID / Client ID）获取指南

> 结论先说：CSDN 问答 [8810914](https://ask.csdn.net/questions/8810914) 里**没有任何密钥**。
> 该页是 AIGC 生成的「如何注册 Azure 应用」教程（`fromType: aigc`），全文 0 个 GUID、
> 0 次 `client_secret`。所谓「第三方登录密钥」不是一个可以复制粘贴的字符串，而是
> **必须由你自己的 Microsoft 账号在 Microsoft Entra 中注册后生成的应用 ID（GUID）**。
> 本文给出从零到可用的完整流程，并给出本仓库可直接验证的检查方式。

## 1. 先分清三个概念

| 名词 | 是什么 | 能否「索取」 |
| --- | --- | --- |
| App ID / Application (client) ID | 应用在 Entra 中的唯一 GUID，公开值，会出现在授权 URL 里 | 不能索取，只能自己注册生成 |
| Client Secret | 机密客户端的密码，等同密钥 | 不能索取；**公开客户端不需要** |
| Tenant ID | 目录 GUID | 由账号所属租户决定 |

Minecraft 启动器的微软登录走 **OAuth 2.0 设备码流（device code）**，属于**公开客户端**，
只需要 App ID，**不需要 Client Secret**。所以网上任何「给你一个 client secret」的说法
对本场景既无用又危险。

## 1b. 本次实际执行的结果

已用上面的脚本在本机真实完成一次注册，全部字段都来自 Microsoft Graph 的回读，不是本地编造：

| 项 | 值 |
| --- | --- |
| 应用显示名 | `Rhine Launcher` |
| **App ID（client id）** | **`c0161cf4-3180-4a1a-919b-19f75d039d32`** |
| Object ID | `c577820c-bb7a-4f92-9973-cb41acf4ee58` |
| 租户 | `ba687425-da5a-40b3-9c3f-e91b31bcc1ae`（发布者域 `v4dwx.onmicrosoft.com`） |
| 账户类型 | `AzureADandPersonalMicrosoftAccount`（个人号与企业号都能登录） |
| 公共客户端流 | 已启用（`isFallbackPublicClient: true`） |
| device-code 端点 | `consumers` / `common` / 自有租户 三个端点均返回 200 并签发 user_code |

注意：最初按 `PersonalMicrosoftAccount` 创建时，`consumers` 端点返回 `AADSTS700016`
（应用对新目录尚未可见）。改成 `AzureADandPersonalMicrosoftAccount` 后立即通过——
这正是本节表格里「帐户类型」建议选最宽档的原因。

该 App ID 已写入 `.rhine-dev/launcher.json` 的 `microsoftClientId`，并通过真实运行中的
服务验证：`POST /api/accounts/microsoft/start` 返回 `userCode: KQG7B6WQ`（200）。

Client Secret 另存于 `.tmp-msapp/app-registration.json`（`keyId 46fb008d-…`，2027-04-29 过期），
**仅供服务端机密流程使用；设备码登录不需要它，绝不要打进客户端**。它已用
`client_credentials` 真实换到过 Graph 令牌（HTTP 200），确认有效。引导用的
`Application.ReadWrite.All` 令牌已在使用后立即删除。

## 2. 手动注册（Azure 门户，约 5 分钟）

1. 用你自己的 Microsoft 账号登录 <https://portal.azure.com> → **Microsoft Entra ID** → **应用注册** → **新注册**。
2. 名称随意（例：`Rhine Launcher`）。
3. **受支持的帐户类型**：
   - 只玩正版 Minecraft / Xbox 个人账号 → 选「**个人 Microsoft 帐户**」（会得到 `PersonalMicrosoftAccount`）。
   - 需要组织账号 → 选「任何组织目录中的帐户和个人 Microsoft 帐户」。
4. **重定向 URI**：设备码流**留空**即可。若填，选「公共客户端/本机」并填
   `https://login.microsoftonline.com/common/oauth2/nativeclient`。
5. 点「注册」，页面上的 **应用程序(客户端) ID** 就是你要的 App ID。
6. 进入该应用 → **身份验证** → 拉到底 → **允许公共客户端流** → 设为「**是**」→ 保存。
   不开这一项，设备码请求会返回 `unauthorized_client`（AADSTS700016 / AADSTS7000218 系列）。
7. 不需要添加任何 API 权限，不需要 client secret。

## 3. 命令行注册（本仓库脚本，等价于上面全部步骤）

`.tmp-msapp/register-app.mjs` 用设备码登录（借用微软第一方 Azure CLI 公开客户端 ID 引导），
拿到 `Application.ReadWrite` 委派权限后，直接调用 Graph 创建应用并读回校验：

```powershell
cd E:\project\uc
node .tmp-msapp\register-app.mjs          # 按提示在浏览器输入 code
```

脚本依次执行：请求设备码 → 轮询登录 → `POST /v1.0/applications` → 读回 `appId` →
用新 App ID 真实发起一次 `devicecode` 请求，确认可用于 Xbox Live 登录 → 结果写入
`.tmp-msapp/app-registration.json`（已用 `icacls` 收紧 ACL）。

它不是「猜」一个 GUID，而是让微软真实签发。

## 4. 验证 App ID 真的能用

本仓库的启动器已内置真实链路（`packages/core/src/accounts/`）：

```powershell
cd E:\project\uc\rhine-launcher
$env:RHINE_MICROSOFT_CLIENT_ID = "<你的 App ID>"
pnpm start          # 另开：pnpm dev:web
```

或在界面 **设置 → 账号** 填入 client ID（等价环境变量 `RHINE_MICROSOFT_CLIENT_ID`，
也可走 `POST /api/accounts/microsoft/start {clientId}`）。

判定标准只有一条：`POST /api/accounts/microsoft/start` 返回 200 且带 `userCode`。
- 返回 `unauthorized_client` → 第 2 节第 6 步没开「允许公共客户端流」。
- 返回 `AADSTS700016` → 这个 App ID 在该租户下不存在（拼错，或用了别人的 ID）。
- `invalid_client` → authority 与账户类型不匹配（个人号用 `consumers`）。

## 5. 本仓库内置自有 App ID，但 Minecraft API 接入必须另行审核

> **纠正此前验收结论**：设备码返回 200 只证明 Microsoft OAuth 接受了应用注册，不能证明
> `login_with_xbox`、Java 版档案或购买检查已成功。内置 Rhine 应用目前没有在仓库中可验证的
> Minecraft API 审核通过证据，因此不能承诺“开箱完整登录可用”。
>
> [Minecraft 官方说明](https://minecrafthelp.zendesk.com/hc/en-us/articles/16254801392141-Java-Edition-Game-Service-API-Review-or-Application-Process)
> 要求新应用通过 [审核表单](https://aka.ms/mce-reviewappid) 人工加入 API 允许列表。
> 这是发布方的应用接入要求，与玩家是否已经买了游戏是两个问题。
>
> 已购但登录失败时，先查看 `GET /api/accounts/microsoft/diagnostics` 的安全阶段与状态；
> `MINECRAFT_APP_NOT_APPROVED` 代表明确的应用注册拒绝；未知 403 不等于未购买，也不能
> 仅凭状态认定未审核。完成审核或配置你获准使用的已审核应用后，仍需用户完成真实授权。

早期版本把 `MICROSOFT_CLIENT_ID` 留空，要求每位使用者自己注册。现在保留本项目的自有
注册作为默认 ID，省去手工填写，但是否能兑换 Minecraft 令牌必须另行验收。分层方式如下：

| 环节 | HMCL | Rhine |
| --- | --- | --- |
| 应用 ID 来源 | 构建期 `MICROSOFT_AUTH_ID` → jar manifest `hmcl.microsoft.auth.id` | 源码常量 `packages/core/src/accounts/builtin-app.ts` |
| 运行时读取 | `System.getProperty(...)`，否则 manifest 属性 | 环境变量 → 设置 → 内置常量 |
| 开发者覆盖 | `-Dhmcl.microsoft.auth.id=<App ID>` | `RHINE_MICROSOFT_CLIENT_ID=<App ID>` |
| 未注册时 | 显示「非官方构建」提示并禁用登录 | `RHINE_MICROSOFT_CLIENT_ID=off` 关闭内置值 |

内置的是**本项目自己注册**的应用（`Rhine Launcher`，公共客户端），不是 Prism / MultiMC
等其他项目的应用——第 4 节那条「不借用他方身份」的边界依然成立。

App ID 不是密钥：它出现在每一个授权 URL 里，任何人都能看到，所以公共客户端流程不配
client secret。真正不能外发的是 client secret，本启动器从未使用也不保存它。

解析优先级（`packages/core/src/config/secrets.ts`）：

```
显式请求参数 → RHINE_MICROSOFT_CLIENT_ID → launcher.json 的 microsoftClientId → 内置应用
```

`RHINE_MICROSOFT_CLIENT_ID=off` 只关闭**内置**值，不会丢弃你已保存或显式传入的 ID，
便于下游发行方在不继承本项目注册的前提下重新打包。

## 6. 与 PCL2 / HMCL 的实际做法对照

下表为核对真实源码后的上游取值方式：

| 项目 | 取值方式 | 出处 |
| --- | --- | --- |
| PCL2 | `Environment.GetEnvironmentVariable("PCL_MS_CLIENT_ID")` | [ModSecret.vb](https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Modules/ModSecret.vb) 第 10 行 |
| HMCL（微软登录） | `System.getProperty("hmcl.microsoft.auth.id", JarUtils.getAttribute("hmcl.microsoft.auth.id", ""))` | `OAuthServer.java` 第 207-210 行；构建期注入见 `HMCL/build.gradle.kts` |
| HMCL（CurseForge） | `System.getProperty("hmcl.curseforge.apikey", JarUtils.getAttribute("hmcl.curseforge.apikey", ""))` | `CurseForgeRemoteAddonRepository.java` 第 47 行 |

本仓库采用同样的分层思路并统一成环境变量：

```
RHINE_MICROSOFT_CLIENT_ID   应用（客户端）ID；设为 off 关闭内置应用
RHINE_MICROSOFT_AUTHORITY   consumers / organizations / 租户 GUID
RHINE_CURSEFORGE_API_KEY    CurseForge API Key（可选，见 CURSEFORGE.md）
```

PCL2 第 10 行的 `If(...)` 是典型 bug 温床：环境变量缺失时会得到空串而不是默认值。
本仓库用 `packages/core/src/config/secrets.ts` 显式区分「未设置 / 空 / 有值 / off」，
空环境变量不会覆盖已保存的配置（有测试覆盖）。

## 7. 本次实测记录（2026-10-31）

真实网络、真实服务端，无 mock：

| 检查项 | 结果 |
| --- | --- |
| 环境变量注入（文件里清空 clientId） | `/api/settings` 返回 `microsoftClientIdFromEnv: true`、`microsoftClientIdConfigured: true` |
| 正版登录启动 | `POST /api/accounts/microsoft/start` → 200，`userCode` 签发，`clientId` 来自环境变量 |
| 令牌轮询 | `POST /api/accounts/microsoft/complete` → `authorization_pending`（证明真实 token 端点已联通） |
| CurseForge 零密钥搜索 | `GET /api/market/search?source=curseforge` → 200，251 条结果 |
| CurseForge 零密钥下载 | 安装任务 `succeeded`，落盘 4,759,629 字节，SHA1 `7e095c4c…` 与官方一致，JAR 魔数正确 |
| 模组识别 | `/api/instances/:id/mods` 解析出 `Just Enough Items · 15.74.0.232` |


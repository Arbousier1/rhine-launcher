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

## 5. 为什么本仓库不内置 App ID

`packages/core/src/accounts/microsoft.ts` 里 `MICROSOFT_CLIENT_ID = ''` 是**有意为之**：
借用第三方（Prism / MultiMC 等）注册的应用身份违反 Microsoft 服务条款，且对方可随时吊销，
导致所有下游用户同时登不上。`README.md`「与 HMCL 的差异」与 `VERIFICATION.md`「明确边界」
都记录了这条边界。因此正确做法是**每个使用者注册自己的 App ID**，这也是本文存在的原因。

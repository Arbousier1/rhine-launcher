# Rhine Launcher：Minecraft API 审核提交清单

准备日期：2026-11-07

**当前状态：仅完成本地申请草稿；尚未提交，尚未获批，真实 Minecraft 登录仍被拒绝。**

## 一、已经确认的事实

| 项目 | 已确认内容 |
| --- | --- |
| 应用名称 | Rhine Launcher；提交人仍需在 Entra 核对显示名和所有权 |
| Application (client) ID | `c0161cf4-3180-4a1a-919b-19f75d039d32` |
| 公开项目地址 | https://github.com/Arbousier1/rhine-launcher；准备时匿名访问返回 200，页面标为 Public |
| 真实失败位置 | Minecraft 令牌兑换，不是游戏购买检查 |
| 安全错误分类 | `MINECRAFT_APP_NOT_APPROVED`，内置应用，HTTP 403 |
| OAuth scope | `XboxLive.signin offline_access` |
| 当前 Minecraft API 调用 | `POST /authentication/login_with_xbox`、`GET /minecraft/profile` |
| 最近相关回归 | 7 个文件、111 项通过，TypeScript 检查通过；这不是 Mojang 的审核或真人完整登录通过证明 |

**购买游戏、注册 Entra 公共客户端、设备码签发和 Minecraft API 审核，是不同环节。** 此次 403 指向我们的应用注册，不应要求玩家重新购买。

## 二、提交前仍需补齐的信息

请填写[英文申请草稿](<E:/project/uc/rhine-launcher/docs/minecraft-api-review/MOJANG-APPLICATION-DRAFT.en.md>)中的所有占位字段：

- `[REPLACE_PUBLISHER_NAME]`：实际应用所有者、个人或组织名称。
- `[REPLACE_CONTACT_EMAIL]`：由发布方持续接收审核回复的邮箱；不要从现有登录账号或机器用户名猜测。
- `[REPLACE_PUBLIC_PRIVACY_POLICY_URL]`：已经公开、实际可访问的隐私政策地址。此次未确认有符合当前构建的已发布政策。
- `[REPLACE_REVIEW_BUILD_OR_COMMIT]`：审核对应的版本或提交号。
- `[REPLACE_REVIEW_DOWNLOAD_OR_ACCESS_INSTRUCTIONS]`：如表单要求，提供经过检查的下载方式和审核说明。

不要填虚构网址、未授权邮箱或其他启动器的应用 ID。如果没有隐私政策，先准备并由发布方审阅政策，再发布；未发布的本地草稿不能当作公开政策 URL。

## 三、必须如实披露的安全边界

### 已在相关代码中核实

- 微软登录采用公共客户端设备码流程；用户在微软页面授权，当前流程不使用 client secret。
- Xbox 与 XSTS 的身份 hash 必须存在且一致，异常时不向 Minecraft 提交该授权。
- 公共账号响应剔除认证令牌；安全失败诊断只保留固定错误码、阶段、状态和内置/自定义应用标记，不保留原始上游消息。
- 认证请求使用 HTTPS，并拒绝重定向；本地 HTTP 后端绑定 `127.0.0.1`，有 Host / Origin 限制。
- 只有收到有效 Java 游戏档案后才持久化成功登录的微软账号，不把失败自动替换成在线成功或伪造身份。

### 不能写成“已经完成”

- **令牌存储目前仍是本地 JSON，未实现应用级加密。** 原子写入和请求 `0600` / `0700` 文件模式不等于加密，也不等于已完成 Windows 文件权限审计。
- 没有独立的 entitlements API 购买凭据检查，不能声称已完整复制 HMCL 的所有权检查或验证了所有许可证签名。
- 本地移除账号只删除本地账号记录，不自动撤销微软端应用同意，也不承诺磁盘安全擦除。
- 没有完成全部可选插件、市场/新闻网络访问及遥测路径的全面隐私审计。不要承诺整个应用“无任何遥测、无任何第三方请求”而不核实。
- 自有应用还没有本次 Minecraft API 审核通过证明；设备码 200、单测通过、发布者徽章都不能代替这个证明。

建议发布方在公开发行前优先评估令牌加密、账号数据权限和隐私政策。**这是材料中的现状披露，不是未经确认的后续功能承诺。**

## 四、核对公开版本

仓库地址确实可公开访问，公开首页仍使用旧的认证与验收说明；本次尚未核实最新本地修复已出现在可供审核的公开提交。因此提交前应：

1. 确认打算给审核人员看的版本/提交。
2. 核对它实际包含新的错误分类、XSTS 校验和安全诊断。
3. 审查待公开文件，不把真实用户数据或凭据提交到 Git。
4. 如需发布或推送，由发布方确认后进行；本次没有自动执行 Git push、创建 Release 或上传二进制。

下列内容不要作为附件或随发布包上传：

```text
真实账号存储与用户数据目录
包含 client secret 的应用注册记录
access token / refresh token / XSTS token / identityToken
Authorization 请求头、私有 device_code
带账号身份或凭据的原始网络抓包、完整日志
```

可以使用英文草稿中的安全诊断 JSON。截图也应先检查账号名、邮箱、角色 UUID、文件路径等个人信息；不要为了“证据完整”暴露令牌。

## 五、手动提交步骤

1. 在 Microsoft Entra 的应用注册页面，确认你是该应用的所有者或获授权代表。核对 **Application (client) ID**，不要把 Object ID 当作 client ID。
2. 打开 [Mojang 官方申请表](https://aka.ms/mce-reviewappid)。
3. 按现场表单的实际问题填写。文本抓取只返回加载页面，因此英文稿不声称精确复现表单字段顺序。
4. 从[英文申请草稿](<E:/project/uc/rhine-launcher/docs/minecraft-api-review/MOJANG-APPLICATION-DRAFT.en.md>)复制对应描述；先替换所有 `[REPLACE_…]`。
5. 发布方检查用途、凭据存储、隐私说明和审核版本一致后，自行确认并提交。
6. 保存提交时间、确认信息和后续回复。Mojang 是人工审核，本次不承诺固定处理时间。
7. 在得到明确接入批准前，不把文档或界面改成“已审核、正版登录已完全可用”。

本次仅 GET 访问了公开项目及官方表单/说明，没有登录 Entra、修改云端应用、提交审核或代填私密信息。

## 六、审批后的验收

在批准同一个 client ID 后，再进行完整真人登录验收：

- 用户在微软页面完成授权。
- Xbox 和 XSTS 身份一致。
- Minecraft 令牌兑换成功，而不仅仅是设备码成功。
- 读取到该用户的 Java 游戏档案与正确角色。
- 公共响应、诊断和日志不泄露凭据。
- 刷新仍使用原应用身份，且不会绑定到不同玩家。
- 原账号、实例、存档和历史数据保留。

若仍出现未知 403、401、限流或档案 404，按新阶段和固定错误码继续分析，不笼统归因成“未购买”。

## 七、本地实现依据（供发布方核对，不直接当作公开审核源码链接）

| 声明 | 本地源码依据 |
| --- | --- |
| 自有应用 ID | [builtin-app.ts:42–49](<E:/project/uc/rhine-launcher/packages/core/src/accounts/builtin-app.ts#L42-L49>) |
| 设备码请求及 scope | [microsoft-begin.plugin.ts:18–30](<E:/project/uc/rhine-launcher/packages/core/src/plugins/features/auth/microsoft-begin.plugin.ts#L18-L30>) |
| XSTS 一致性与 Minecraft 调用 | [microsoft-chain.ts:43–75](<E:/project/uc/rhine-launcher/packages/core/src/accounts/microsoft-chain.ts#L43-L75>) |
| 本地 JSON 账号记录 | [repository.ts:38–54](<E:/project/uc/rhine-launcher/packages/core/src/accounts/repository.ts#L38-L54>) |
| 原子写入，未加密 | [storage.ts:41–49](<E:/project/uc/rhine-launcher/packages/core/src/services/storage.ts#L41-L49>) |
| 账号响应脱敏 | [repository.ts:90–92](<E:/project/uc/rhine-launcher/packages/core/src/accounts/repository.ts#L90-L92>) |
| 安全错误诊断 | [auth-diagnostics.ts:23–40](<E:/project/uc/rhine-launcher/packages/core/src/accounts/auth-diagnostics.ts#L23-L40>) |
| 后端 loopback 绑定 | [main.ts:17–24](<E:/project/uc/rhine-launcher/packages/server/src/main.ts#L17-L24>) |
| Host / Origin 验证接入 | [app.ts:11–19](<E:/project/uc/rhine-launcher/packages/server/src/app.ts#L11-L19>) |
| 认证请求拒绝重定向 | [http.ts:22–36](<E:/project/uc/rhine-launcher/packages/core/src/accounts/http.ts#L22-L36>) |
| 账号移除只处理本地记录 | [remove.plugin.ts:5–8](<E:/project/uc/rhine-launcher/packages/core/src/plugins/features/accounts/remove.plugin.ts#L5-L8>) |

## 官方政策依据

- [Java Edition Game Service API Review or Application Process](https://minecrafthelp.zendesk.com/hc/en-us/articles/16254801392141-Java-Edition-Game-Service-API-Review-or-Application-Process)
- [已直接读取的官方文章 API](https://minecrafthelp.zendesk.com/api/v2/help_center/en-us/articles/16254801392141.json)
- [官方申请入口](https://aka.ms/mce-reviewappid)

官方政策要求新应用经人工审核加入允许列表；已有应用的既有接入不代表新应用自动获得同样许可。

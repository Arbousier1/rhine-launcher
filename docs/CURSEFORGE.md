# CurseForge 接入说明

> 一句话：**下载不需要 API Key，搜索/列表需要**。本仓库因此同时支持「自有 Key 直连」
> 与「零密钥走镜像」两种形态，行为对齐 PCL2 与 HMCL 的真实实现。

## 1. 哪些请求真的需要密钥

| 端点 | 需要 `x-api-key` | 说明 |
| --- | --- | --- |
| `api.curseforge.com/v1/mods/search` | ✅ | 搜索 |
| `api.curseforge.com/v1/mods/{id}` | ✅ | 项目详情 |
| `api.curseforge.com/v1/mods/{id}/files` | ✅ | 文件列表 |
| `edge.forgecdn.net/files/...` | ❌ | 文件本体 CDN，实测无 Key 返回 200 |

这条区分很重要：很多资料笼统说「CurseForge 要 Key」，从而让人误以为下载也必须带密钥。
实测（见第 6 节）表明 CDN 直链不需要。

## 2. 上游是怎么做的

### HMCL

```java
// CurseForgeRemoteAddonRepository.java
public static final String API_KEY = System.getProperty(
    "hmcl.curseforge.apikey",
    JarUtils.getAttribute("hmcl.curseforge.apikey", ""));

private static <R extends HttpRequest> R withApiKey(R request) {
    if (request.getUrl().startsWith(PREFIX) && !API_KEY.isEmpty()) {
        request.header("X-API-KEY", API_KEY);
    }
    return request;
}
```

下载地址在 `downloadUrl` 为 null 时自行拼接：

```java
return String.format("https://edge.forgecdn.net/files/%d/%d/%s", id / 1000, id % 1000, fileName);
```

### PCL2

```vb
' ModSecret.vb
Public CurseForgeAPIKey As String = If(Environment.GetEnvironmentVariable("PCL_CURSEFORGE_API_KEY"), "")

' ResourceVersion.vb — downloadUrl 为空时拼接
If Url = "" Then Url = $"https://edge.forgecdn.net/files/{CInt(.Id.Substring(0, 4))}/{CInt(.Id.Substring(4))}/{ .FileName}"

' ModDownload.vb — 镜像映射
Public Function DlSourceModGet(Original As String) As String
    Return Original.
        Replace("api.curseforge.com", "mod.mcimirror.top/curseforge").
        Replace("edge.forgecdn.net", "mod.mcimirror.top").
        Replace("mediafilez.forgecdn.net", "mod.mcimirror.top").
        Replace("media.forgecdn.net", "mod.mcimirror.top")
End Function
```

PCL2 还会在请求 `forgecdn.net` 时也附加 `x-api-key`（`SecretHeadersSign` 第 37 行），
并对下载地址做多源回退与超时分级。

## 3. 本仓库的实现

`packages/core/src/market/curseforge.ts`：

- `curseForgeCdnUrl(fileId, fileName)` —— 与 HMCL/PCL2 相同的拼接规则，
  文件名逐段编码（对齐 PCL2 的 `UrlEscape`）。
- `toMarketVersion()` —— 优先用 API 的 `downloadUrl`，为空时回退到上面的拼接。
- `mirrorUrl(url, mirror)` —— PCL2 `DlSourceModGet` 的等价映射。
- `CurseForgeClient.request()` —— 先试「自有 Key 直连」，401/403 或未配置 Key 时
  自动回退镜像；镜像 URL 禁止重复协议前缀（有测试覆盖）。

关闭镜像：构造时传 `mirror: null`。

## 3b. HMCL 的搜索实现逐项对照

以下逐行核对自 `CurseForgeRemoteAddonRepository.search()`（本地 `.reference/HMCL`）：

| HMCL 的做法 | 本仓库对应 | 状态 |
| --- | --- | --- |
| `query.put("gameId", "432")` | `MINECRAFT_GAME_ID = 432` | ✅ 一致 |
| `query.put("classId", toSectionId(type))`，**总是发送** | 默认 `classId=6`，可传 `projectType` | ✅ 已对齐 |
| `categoryId`（仅当选中分类） | `params.categoryId` | ✅ |
| `gameVersion` / `searchFilter` | `gameVersion` / `searchFilter` | ✅ |
| `sortField`：RELEVANCY=1、POPULARITY=2、LAST_UPDATED=3、TOTAL_DOWNLOADS=6、DATE_CREATED=11 | `curseForgeSortField()` 同值 | ✅ |
| `sortOrder`：ASC/DESC | `params.sortOrder`，默认 `desc` | ✅ |
| `index = pageOffset * pageSize` | `index = offset`（调用方传绝对偏移） | ✅ 等价 |
| `pageSize` | `pageSize`，上限 50 | ✅ |
| `withApiKey()`：仅官方前缀加 `X-API-KEY` | 仅官方目标带 `x-api-key` | ✅ |
| `getDownloadCandidates(...)` 多候选轮询，失败聚合 suppressed 异常 | 官方 → MCIM 镜像双目标 | ✅ 更强（无 Key 也可用） |
| `Semaphore(16)` 限制并发 | 由宿主并发设置约束 | ⚠️ 未逐一对齐 |
| `calculateTotalPages` 用 `min(totalCount, 10000)` | 直接回传 `totalCount` | ⚠️ 未截断 |

两个 ⚠️ 是**有意的差异**，不是遗漏：并发由启动器统一设置控制；`totalCount` 未截断是
因为我们的分页上限本来就在调用侧约束（`offset` ≤ 100000）。

## 4. 搜索是怎么解决的

搜索是**唯一**需要凭据的环节。本仓库用两级策略解决：

```
有 Key  → api.curseforge.com（带 x-api-key）
         ↓ 401/403 或未配置 Key
无 Key  → mod.mcimirror.top/curseforge/v1（PCL2 的 DlSourceModGet 映射）
```

请求顺序与重试都在 `CurseForgeClient.request()` 里：

- 每个目标最多尝试 2 次；网络异常、5xx、429 会退避重试，401/403 直接换目标。
- **失败必须抛错**，不允许把失败降级成「0 条结果」——那会让用户以为搜不到东西。
  有测试专门锁死这条（`reports a clear failure when both the key and the mirror fail`）。

### 一个容易踩的坑：必须带 classId

CurseForge 搜索接口**不会**默认只返回模组。不带 `classId` 时会混入整合包（classId 4471）
和资源包，实测同样的 `jei` 查询：

| 请求 | `pagination.totalCount` | 首屏 classId |
| --- | --- | --- |
| 不带 `classId` | 612（混入整合包与资源包） | `{"6":20}` |
| `classId=6`（模组，HMCL 的做法） | 463（全部是模组） | `{"6":20}` |

注意两者**首屏看起来一样**，差别在总数和后续分页——翻几页就会开始出现整合包，
这也是这个坑不容易被发现的原因。

现在 `CurseForgeClient.search()` **默认就发 `classId=6`**（对齐 HMCL 的
`query.put("classId", ...)` 总是发送），调用方不传 `projectType` 也不会再混入整合包。
`packages/core/test/market.test.ts` 有断言锁定这个默认值。

### 依赖关系枚举：3 是必装，不是冲突

CurseForge 的 `relationType` 与直觉相反，HMCL 的 `RELATION_TYPE` 表写明：

| 值 | CurseForge 官方名 | HMCL 映射 | 本仓库映射 |
| --- | --- | --- | --- |
| 1 | EmbeddedLibrary | EMBEDDED | `embedded` |
| 2 | OptionalDependency | OPTIONAL | `optional` |
| 3 | **RequiredDependency** | **REQUIRED** | **`required`** |
| 4 | Tool | OPTIONAL | `optional` |
| 5 | Incompatible | INCOMPATIBLE | `incompatible` |
| 6 | Include（CF 会隐藏） | EMBEDDED | `embedded` |

早期实现把 `3` 当成 `incompatible`，直接后果是**安装模组时漏掉必装前置**，游戏启动后
才报缺依赖崩溃。已修正为 `curseForgeDependencyType()`，并有逐项断言。
实测真实数据（`jei` 的 1.20.1 文件）确实返回 `relationType: 3` 的必装依赖。

### 为什么不直接内置 Key

内置等于把服务端凭据发给所有用户，几分钟内就会被提取滥用，进而连累整个项目被封。
PCL2 和 HMCL 也都选择由使用者自己提供。若要让终端用户「零配置」用上搜索，
正确做法是自建一个持有 Key 的转发服务，客户端只连它——本仓库的 `baseUrl`
与 `mirror` 选项已支持这种部署，无需再改客户端代码。

> **注意与微软应用 ID 的区别**：微软的 App ID 是**公开标识**（出现在每个授权 URL，配的是
> 无 secret 的公共客户端流），所以可以随发行版内置；CurseForge 的 API Key 是**真正的密钥**，
> 一旦内置给所有人就等于泄露。两者不能套用同一策略。

### 5b. 当前推荐：零配置走镜像（本仓库已实测可用）

默认配置下**不需要任何 CurseForge 凭据**：`CurseForgeClient` 会在官方接口拒绝时自动回退到
MCIM 镜像（PCL2 的同款映射）。2026-11-03 实测：

| 请求 | 结果 |
| --- | --- |
| 官方 `api.curseforge.com`（无 Key） | HTTP 403 `Forbidden: API Key missing or invalid` |
| `mod.mcimirror.top/curseforge`（无 Key） | HTTP 200，`jei` 命中 459 条 |
| 本仓库 `GET /api/market/curseforge/search?query=jei&projectType=mod` | 200，返回真实项目与版本 |

## 5. 申请自己的 Key（可选）

CurseForge 的 Key 只能人工申请，**不存在可以自助注册或从公开页面推导出来的途径**：

1. 填写官方表单：<https://forms.monday.com/forms/dce5ccb7afda9a1c21dab1a1aa1d84eb?r=use1>
2. Overwolf 审核（官方说明 48–72 小时），通过后邮件发送唯一 Key。
3. 审核关注：对作者收益的影响、对 CurseForge 服务器/CDN 的压力、是否尊重作者对第三方分发的授权。

拿到后按 `docs/MICROSOFT-OAUTH-APP-ID.md` 第 6 节注入环境变量 `RHINE_CURSEFORGE_API_KEY`。
**不要把它提交到仓库或打进客户端**——它是服务端凭据。

## 6. 实测记录（2026-10-31，真实网络）

| 检查项 | 结果 |
| --- | --- |
| 无 Key 直连 `api.curseforge.com` | HTTP 403 `Forbidden: API Key missing or invalid` |
| 无 Key 直连 CDN 直链（真实文件名） | HTTP 200，`content-length` 与 API 一致 |
| 镜像搜索（`mod.mcimirror.top/curseforge/v1`） | HTTP 200，可用 |
| 镜像文件列表 | HTTP 200，50 条 |
| 本仓库 `GET /api/market/search?source=curseforge`（零配置） | 200，251 条结果 |
| 本仓库安装任务（零配置） | `succeeded`，落盘 4,759,629 B，SHA1 `7e095c4c5b95a478002df0822975920a4201263e` 与官方一致 |
| 下载产物 | `PK` 魔数正确，可被解析为 `Just Enough Items · 15.74.0.232` |

> 早期尝试用猜测的文件名请求 CDN 得到 403，一度被误判为「CDN 拒绝无 Key 请求」。
> 用真实文件名复测后确认 403 只是因为文件名不存在——这一点已写入本文件避免再犯。

## 7. 合规边界

- 拼接 CDN 地址是对齐上游的既有行为；作者若真的禁止第三方分发，该直链同样 404/403，
  下载会明确失败，不会伪造成功。
- 镜像只是路由/缓存，它把下载 302 回官方 CDN，不改写作者的分发决定。
- 本仓库不会内置他人的 API Key。

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
实测（见第 5 节）表明 CDN 直链不需要。

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

## 4. 申请自己的 Key（可选）

CurseForge 的 Key 只能人工申请，**不存在可以自助注册或从公开页面推导出来的途径**：

1. 填写官方表单：<https://forms.monday.com/forms/dce5ccb7afda9a1c21dab1a1aa1d84eb?r=use1>
2. Overwolf 审核（官方说明 48–72 小时），通过后邮件发送唯一 Key。
3. 审核关注：对作者收益的影响、对 CurseForge 服务器/CDN 的压力、是否尊重作者对第三方分发的授权。

拿到后按 `docs/MICROSOFT-OAUTH-APP-ID.md` 第 6 节注入环境变量 `RHINE_CURSEFORGE_API_KEY`。
**不要把它提交到仓库或打进客户端**——它是服务端凭据。

## 5. 实测记录（2026-10-31，真实网络）

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

## 6. 合规边界

- 拼接 CDN 地址是对齐上游的既有行为；作者若真的禁止第三方分发，该直链同样 404/403，
  下载会明确失败，不会伪造成功。
- 镜像只是路由/缓存，它把下载 302 回官方 CDN，不改写作者的分发决定。
- 本仓库不会内置他人的 API Key。

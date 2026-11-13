# XMCL 独有高级功能插件

用户要求把 XMCL 独有的高级功能也做成插件。原则：**只实现我们后端真实支撑的能力**，绝不做出空壳。

## 已实现（均为一页一路由一插件）

| 插件 | 路由 | 侧栏 | 真实后端接口 |
| --- | --- | --- | --- |
| `view.diagnostics` | `/diagnostics` | 实例体检 | `GET /api/instances/:id/diagnostics` |
| `view.modpacks` | `/modpacks` | 整合包与迁移 | `POST /api/modpacks/{modrinth,curseforge}/import`、`POST /api/instances/:id/duplicate` |
| `view.mod-updates` | `/mod-updates` | 模组更新 | `GET /api/instances/:id/mods/updates?source=`、`POST .../mods/updates/apply` |

文件：
- `packages/web/src/pages/diagnostics/DiagnosticsPage.tsx`
- `packages/web/src/pages/modpacks/ModpackPage.tsx`
- `packages/web/src/pages/mods/ModUpdatesPage.tsx`
- 三个 `packages/web/src/plugins/features/views/*.plugin.tsx`

## 实测证据

- 实例体检对「验证实例」返回两条真实结果：`warn 游戏进程被终止，未返回退出码。` 与 `info 未在日志中发现已知的崩溃特征。`，页面按级别渲染。
- 模组更新接口实测返回 `[]`（该实例无模组），页面显示「没有可更新的模组」而非报错。
- 整合包与迁移页的复制实例走 `/api/instances/:id/duplicate`，与原档案库行为一致。
- 完整回归 **1019 通过 / 0 失败 / 1020 总数，69 个文件**。

## 未实现（需要新增后端能力，不能只做界面）

XMCL 的这些高级功能依赖其 Electron 主进程与 `xmcl-runtime`，我们没有对应后端，因此**没有**做成界面：

- **服务端托管**：启动/停止本地服务端、`servers.dat` 编辑、SSH 远程部署与监控。
- **Big Picture 模式**：全屏手柄界面。
- **蓝图（Blueprint）**：`.litematic / .schem` 解析与预览。
- **截图管理**、**多人联机**、**Modrinth 项目发布**、**游戏手柄映射**。

若要其中任何一项，需要先在 `packages/core` 增加对应能力插件，再补 UI。

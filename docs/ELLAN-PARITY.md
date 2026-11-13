# 原 Vue UI 插件接入与莱茵生命布局：验证记录

## 当前交付范围

原 Ellan Vue 前端与操作逻辑已接入 Rhine 默认桌面 UI，不是 React 换肤。原组件、视图与语言源码未修改，原构建固定在 c1e65d9439abe3b51f98d98dd954831e9d2f827e。布局不再逐像素 1:1，而融合 PCL2/HMCL 的启动与实例信息层级，使用最早莱茵生命暖纸／墨黑／琥珀配色。

根 UI、主题、布局、高级提示、原生文件路径为独立能力，公开服务每个方法一个描述符；共享实现只做私有协议/状态/文件适配，不打包多个公开功能。

## 实际证据

- 默认 ui.ellan 已实测禁用：Vue 文档卸载并回到恢复页；重新启用：Vue 恢复，后端保持在线。
- ui.theme.rhine-life / ui.layout.hybrid / ui.hints.advanced / ui.files.native-path 在当前实际文档分别禁用/启用，sameVue=true，原应用不重挂载。
- 默认1200×720与最小800×400已检查；最小窗口 documentWidth=800、账号姓名区82.8px，姓名可读，无横向溢出；原删除/展开控件保留。
- 原生鼠标实测命中caption=2，LeftHeld=true，实际窗口位置变化147×88px，恢复指针。
- 原控制器得到真实 Chromium 原生选中文件路径；生成 File 返回空路径，不猜 File.name。原 Vue 拖放处理器把有效小模组导入临时实例并真实落盘，之后清理。
- 原账号表单通过真实鼠标事件创建临时离线账号，并经原 removeUser 清理；账号选择与登录历史恢复。Microsoft/Yggdrasil设备码、密码、两个renderer取消、HTTP实际中止与令牌不外泄由隔离loopback协议测试验证。
- 原共享状态按rendererId引用计数，其他界面释放不影响仍持有者；关闭释放引用与观察器；真实 options 文件修改已触发原 commit。
- 原设置commit实际改变核心下载并发；实例CRUD返回规范绝对路径，核心名称/内存/运行时不被旧UI字段遮盖，保留原额外元数据，复制与失败创建回滚已验证。
- 使用已安装Fabric1.20.1及真实Java17在临时实例启动实际Minecraft：OS PID51352、真实原窗口就绪事件；保留launchId/原参数，随后只终止该进程并清理临时实例和历史。
- 原 install/installInstance 采用维护库文件诊断、实际Java探测；资源、库、索引损坏与真实tiny localhost修复均通过。原安装RPC保留结果，后端任务拥有进度和取消；关闭UI仅取消等待，不取消任务。
- 模组/材质包/光影读取真实路径、哈希、大小、时间、加载器元数据、图标和依赖；ResourceActionTuple与错误增量正确，刷新始终生成新快照。存档、servers.dat和options/eula采用维护库实际解析。
- 原 market/manifest 操作验证实际ID、所选文件、必要依赖、游戏/加载器筛选、暂存下载与校验、冲突拒绝和最佳努力回滚。实际公共Modrinth返回lithium-fabric-mc1.20.1-0.11.4.jar，691483bytes，SHA1 048227ed60a3005cf9fa55880dfe0cf20b0ba680，非编造CDN/ID。
- 完整原Vue/桥/Node适配器重新构建成功；最终TypeScript检查通过，全量85文件、1201通过、1跳过、0失败。
- 原“验证实例”、Steve、六条已有会话历史保留；所有识别出的临时实例/账号/文件/历史已清理。

## 配置与兼容边界

这完成的是当前请求的默认原UI插件接入、混合布局及主要Rhine流程验证，不代表原仓库所有额外产品功能都由Rhine实现。无能力的操作不会返回假成功。

Microsoft设备码登录需配置自己获授权的clientId；CurseForge官方接口需自己的API密钥，密钥仅后端持有，未借用或暴露上游密钥。原在线多游戏profile操作、上游锁/pending/resume整合包API、部分旧ASM模组解析/服务器加载器/额外LabyMod/Bedrock/远程社交/未配置AI等不在已验证兼容范围。

Manifest使用逐文件检查rename和最佳努力回滚，不是多文件OS事务或跨进程崩溃恢复日志；遇到检测到的并发修改拒绝覆盖，不安全恢复保留备份并明确报错。原字体/图片等独立许可应在再分发前复查，MIT源码归属保留。

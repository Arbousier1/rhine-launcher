# Rhine Launcher 视觉布局精修

本轮按“优化 UI 布局，注重美观性”实施。保留最早莱茵生命色板、原 Vue 控件和操作逻辑；没有修改上游 Vue 组件、后端、包依赖或工作区构建配置。

## 视觉调整

- 44px 标题栏与 72px 导航栏，品牌、环境入口和原生窗口操作分层。
- 224px 身份栏，统一账号卡、淡网格皮肤展示和低干扰的离线说明。窄窗口缩为 176px，账号文字不被删除/展开按钮挤掉。
- 实例标题、搜索、启动卡和新闻共用左右对齐线。单实例卡填满可用宽度，明确的深色启动按钮使用原按钮的可访问名称，不创建第二套启动处理器。
- 保留暖纸、墨黑与琥珀色，减轻边框和阴影，统一圆角、标题字号与辅助文字层级。
- 新闻降为辅助内容，图文比例约 1:2。标题回到左侧，轮播指示点缩小；上一条/下一条按钮放到底部，不遮挡正文，命中区域保留。
- 环境信息改为分组信息面板，展示真实配置、账号、任务和目录。未指定 Java 时显示“自动选择 · 已发现 N 个”，不把发现数量当作启动就绪。
- 保留键盘焦点、关闭按钮、Esc、外部点击关闭与减少动态效果设置；关闭面板取消其读取请求，不取消后台任务。

## 独立能力与源文件

| 单一能力 | 实现 |
| --- | --- |
| 布局 | [layout-hybrid.css](<../packages/ellan-ui/src/styles/layout-hybrid.css>) |
| 色板与表面样式 | [theme-life.css](<../packages/ellan-ui/src/styles/theme-life.css>) |
| 高级提示 | [advanced-hints.plugin.ts](<../packages/ellan-ui/src/plugins/advanced-hints.plugin.ts>)、[advanced-hints.css](<../packages/ellan-ui/src/styles/advanced-hints.css>) |
| 提示回归测试 | [advanced-hints.test.ts](<../packages/ellan-ui/test/advanced-hints.test.ts>) |

布局、主题和高级提示仍能各自禁用与启用。实际文档逐项切换时，原 Vue 根始终是同一个对象；没有借此替换原始应用或隐藏不可用接口。

## 验证证据

- 复用既有 Electron 启动器、既有后端与 DevTools 9600；没有另开开发服务器或修改 DSH GUI。
- 默认实际文档：1200×720 CSS px，DPR 1.25，截图 1500×900。
- 在同一实际文档使用 DevTools 视口覆盖检查 800×400 和 1440×900，结束后清除覆盖，恢复原窗口。最小尺寸 documentWidth=800；身份栏 clientHeight=scrollHeight=356，无账号控件裁切。
- 小窗口环境面板范围 x=112、y=52、388×336，可滚动到目录与说明；右/下边缘没有超出视口。
- 原搜索输入：1 个实例 → 搜索无匹配时 0 个 → 恢复输入后 1 个。
- 真实鼠标打开原账号菜单，添加账号入口可见；未创建或删除账号。
- 真实鼠标点击原轮播下一条：活动索引 0 → 1。移动后的按钮实际命中自身，正文底边与控制区顶边有间距。
- 环境面板打开后焦点进入关闭按钮；Esc 后关闭并回到触发按钮，外部点击也能关闭。减少动态效果时卡片 transitionDuration=0s、面板 animationName=none。
- 标题栏保持 drag 区域，环境按钮保持 no-drag 区域。
- 重新组装渲染器成功，TypeScript 检查通过。全量测试：86 文件，1205 通过、1 跳过、0 失败。最后 UI 范围复测：5 文件、89 通过；新增 4 个测试覆盖真实数据展示、独立生命周期、关闭取消/旧响应隔离和读取失败。
- 只读核对用户数据仍为“验证实例”、Steve 和 6 条已有会话；本轮未改变账号、实例配置或历史。

## 截图

- [精修后的默认桌面](<../.shots/rhine-refined-desktop.png>)
- [分组环境面板](<../.shots/rhine-refined-hints.png>)
- [800×400 布局](<../.shots/rhine-refined-minimum.png>)
- [精修前基线](<../.shots/rhine-before-aesthetic.png>)

截图为实际 Vue 页面，不是设计稿。新闻来自原轮播，图片与条目会随轮播切换。

## 范围说明

本轮没有扩展上游 API 兼容性。重载时仍观测到原有服务限制，例如 instanceGroupsSet、PresenceService/setActivity 及实例路径校验错误；没有将其隐藏或返回假成功。上述构建、测试和视觉验证不代表这些额外接口已完成。

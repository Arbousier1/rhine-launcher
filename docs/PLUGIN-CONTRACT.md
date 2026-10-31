# 单功能插件契约（本轮重构的硬约束）

用户明确要求：**所有功能都是插件，不允许一个插件同时提供多个功能**。

## 功能粒度

每个公开动作各自一个模块、一个插件、一个 capability、一份依赖和生命周期：
- account.list / account.get / account.remove / auth.offline.login
- auth.microsoft.begin / auth.microsoft.complete / auth.microsoft.refresh
- auth.yggdrasil.login / auth.yggdrasil.refresh / auth.agent.prepare
- loader.fabric.list / loader.fabric.install（Quilt、Forge、NeoForge、OptiFine 同理）
- instance.list / get / create / update / remove / duplicate
- file.list / file.read / file.write / file.remove
- mod.list / toggle / remove / import / install
- mod.update.modrinth.check / mod.update.curseforge.check / mod.update.apply
- modpack.identify / modpack.modrinth.import / modpack.curseforge.import
- view.archive / view.instance / view.versions / view.mods / view.market / view.accounts / view.settings / view.java / view.logs
- motion.boot / motion.archive-core / motion.dust / motion.scanline / motion.route-transition / motion.text-decrypt / motion.rolling-number / motion.card-expand 等。

一个用户动作可以**组合调用其依赖插件**（例如启动游戏需下载和认证），但不能自己再注册另一个公开动作。
纯函数、ZIP/JSON工具、数据仓库与UI原子组件是实现细节，不算应用功能；它们不可自行注册公开服务。

## 后端接口（@rhine/plugin-api 已实现）

每个文件导出一个 default descriptor，使用同一个 defineFeature：

~~~ts
import { defineFeature } from '@rhine/plugin-api'
export default defineFeature<{name:string}, Promise<Account>>({
  id: 'auth.offline.login',
  capability: 'auth.offline.login',
  title: '离线登录',
  depends: ['paths.get', 'storage.read', 'storage.write'],
  http: {method:'POST',path:'/api/accounts/offline',decode: async req => req.json(),status:201},
  execute(input, env) { return accountRepository(env).createOffline(input.name) },
})
~~~

运行时接口：new FeatureRuntime(ctx)；register(descriptor, source?)；registerAll(list)；load(entries 或 Promise)；start({disabled, entries})；reconcile(entries)；replace(id, descriptor)；enable(id)；disable(id)；call<T>(id,input?,{task?,signal?})；has(id)；list()；definitions()；settled()；configuration()；state<T>(key,init,cleanup?)；seedState(key,value)；subscribe(listener)；dispose()。

- definition只能有一个capability（必须等于id），execute为唯一公开动作。依赖填capability id。
- execute环境 env.context 为 Cordis Context；env.task 为进度/cancel handle；env.signal 在卸载时会abort；env.state为纯仓库缓存。
- env.use(id,input) 用于声明过的依赖动作；不能导入别的功能实现实例。
- 每个 *.plugin.ts 文件只default export **一个**插件。聚合列表/自动发现是catalog，不是插件。
- 保留现有HTTP线格式（plain JSON），http描述属于对应单一动作；不再使用一个group router把多种功能写死进宿主。
- 旧Context namespace可保留为**自动生成的转发投影**（如 ctx.instances.create -> instance.create），但它们不是功能实现；禁用插件后投影调用也必须失败。
- 原 services/* 的业务实现可转为不继承Service、不注册ctx的纯仓库/实现类；禁止用薄插件再new一个多功能Service。
- 老测试可用test-only context fixture直接提供纯实现来回归算法；生产必须只加载单功能descriptors。
- 插件缺依赖应blocked/503，而不是静默返回空列表。禁用只卸载本功能及必需的依赖下游，不连带卸载无关兄弟。

## 写入分工

Lead：packages/plugin-api/**，core/src/plugins/{boot,catalog,facades,kernel,types}.ts，core基础/meta/java/instanceCRUD插件与实现、core/index.ts/contracts.ts/types.ts、workspace配置、最终文档。
账号队友：accounts/**、services/accounts.ts，plugins/features/accounts/**、auth/**、accounts/Yggdrasil测试。
加载器队友：loader/**、services/loader.ts，plugins/features/loaders/**、loader测试。
内容队友：modpack/**、mods/updates/**、services/mods.ts、plugins/features/mods/**、modpacks/**、updates/**；相关测试。
Web队友：web/src/**与web/test/**（api/client.ts不要修改；由Lead统一桥接）；每页每动效独立注册。
Server队友：server/src/**与server/test/**；host只转发插件http元数据；没有业务分支。

各队友不要改根依赖/契约/其他队友文件；需要契约字段请消息Lead。启动后台工作都记录job id并collect；不启动新服务。
## 取消与事务补充

instance.create 已原子保留唯一目录，绑定 env.signal，每步检查取消，内部 finally 自行回滚新目录/cache，不通过已取消的 env.use 删除；调用者在 create 途中被取消不必获得 id 才能清理。导入读取用户选定的本地文件（read-only），所有写入必须受 staging/实例边界限制；不要强制用户预先手动复制包到 temp，HTTP 上传可作为另一单功能插件。
## 当前落地情况（2026-10）

- 后端 **121 个**单功能插件，前端 **30 个**，均由目录扫描发现；`packages/core/src/plugins/catalog.ts` 与 `packages/web/src/plugins/catalog.ts` 只负责发现。
- HTTP 宿主 `packages/server/src/plugin-http.ts` 只按插件声明的 `http` 元数据匹配与转发；未知路由 404，停用插件 503。
- WebSocket 只转发脱敏后的公开事件（`events.redact` + `events.subscribe.public`），宿主不含业务分支。
- 旧的多功能 Service 与 group router 已删除；`services/*.ts` 中的类都是不接受 Context 注册的纯实现，仅测试夹具显式注入。
- 兼容命名空间（`ctx.instances.*`、`ctx.meta.*` 等）是宿主生成的转发投影：每个方法映射到单个 capability，且会检查声明与生命周期，不能绕过插件直接实现功能。
- 配置以稳定 id 描述并写入 `plugins.json`；`reconcile` 只重载语义改变的节点，失败恢复旧组合。
- 已提交数据（游戏文件、模组、世界、账号）不因插件停用而删除；只有插件自己创建的运行期资源会被逆操作回收。

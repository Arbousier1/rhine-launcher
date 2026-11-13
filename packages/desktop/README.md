# Rhine 桌面宿主

构建前端后运行 pnpm start:desktop。启动脚本仅为本 GUI 清除 ELECTRON_RUN_AS_NODE；桌面进程先验证或启动匹配数据目录的后端，再加载应用。

RHINE_PORT 可设为 0 分配动态端口；RHINE_DATA_DIR 指定数据目录。HTTP 留在 rhine-app://app 同源，由主进程代理。WebSocket 使用主进程传入的 streamBaseUrl，仅对本窗口、准确主机端口及 /ws 重写 Origin。

主进程仅终止自己启动的后端。检查应用名、数据目录和 PID 不等同于实现 DSH 的 Cookie 认证协议。

转发与门控适配自 DeepSeek Harness 提交 ce7073d51254c26cd63b22a60835b8f948deb447。完整 [MIT 许可](<E:/project/uc/rhine-launcher/packages/desktop/LICENSES/DeepSeek-Harness-MIT.txt>) 已保留。private: true 只限制 npm 发布，不禁止源码复用。

桌面基础通信、读写与冷启动已验证。Ellan 原始 UI 的服务适配及默认替换仍在进行，不能把当前旧页面称为完成复刻。

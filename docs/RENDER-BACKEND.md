# 渲染后端：WebGL2 与 WebGPU 实测结论

## 结论

**默认继续使用 WebGL 2。** 同画质交替实测中，WebGPU 在本场景没有性能收益，CPU 开销反而明显更高，因此自动选择保持关闭（`NATIVE_AUTOMATIC_ENABLED = false`）。WebGPU 实现完整保留，可通过 `?renderer=webgpu` 显式启用并继续验证。

## 实测数据（1600×900，DPR 1，原始画质：AO 32、景深 100、阴影 2048、透射 1）

交替顺序 webgl2-A → webgpu-A → webgpu-B → webgl2-B，避免单边偏差。

| 场景 | WebGL2 绘制 FPS | WebGPU 绘制 FPS | WebGL2 CPU | WebGPU CPU |
| --- | --- | --- | --- | --- |
| 实例空闲 | 10.0 / 10.0 | 10.0 / 9.8 | 244 / 225 ms | 1072 / 978 ms |
| 快照浏览 | 9.8 / 9.8 | 9.8 / 9.8 | 755 / 776 ms | 1033 / 950 ms |
| 详情空闲 | 10.0 / 10.0 | 9.8 / 9.8 | 190 / 195 ms | 263 / 251 ms |

- 两轮交替结果一致，绘制帧率都被同一外部上限压住（约 10 FPS），因此差异体现在 CPU 上。
- WebGPU 在实例空闲时出现 13 个长任务，WebGL2 为 0。
- 结论只针对当前场景与当前实现，不代表 WebGPU 普遍更慢。

## 已实现（保留可切换）

- `ArchiveBackend` 抽象：`WebGLArchiveBackend`（完整 GLSL 管线，默认）与 `WebGPUArchiveBackend`。
- WebGPU 侧包含：材质节点化（表面清透、磨砂透射 LOD、主题、印刷面、选择性遮罩、内部光学捕获）、精确移植的 SSAO 32/25 tap 模糊、41 tap 打包深度 Bokeh、SMAA、4× 光学捕获、显式相位捕获。
- 队列背压、设备丢失与校验错误处理、取消与完整资源释放。

## 回退验证

屏蔽 `navigator.gpu` 并强制 `?renderer=webgpu`：

- 后端实际为 `webgl2`，原因「当前浏览器无可用 WebGPU」。
- 场景正常加载与准备（1 canvas），点击 ENTER SYSTEM 后进入 archive，渲染 252 张卡片，无浏览器错误。

## 复现

```powershell
node .reference/render-backend-performance.mjs webgl2 A
node .reference/render-backend-performance.mjs webgpu A
node .reference/render-fallback-check.mjs
```

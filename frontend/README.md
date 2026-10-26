# 前端

P3 已实现偏好、默认城市、天气展示与手动覆盖、首页条件草稿；保留 P2 衣橱/双导入和 P1 Fake 诊断。正式搭配与日历未实现，真实天气账号待验。技术栈见 [ARCHITECTURE](../ARCHITECTURE.md)，规则见 [AGENTS](AGENTS.md)。

## 环境与安装

Node 固定 24.19.0（根目录 .nvmrc），使用 npm 和单一 package-lock.json。在 frontend 目录执行：

```sh
npm ci
npm run dev
```

默认开发地址为 http://localhost:5173；/api 代理到 http://localhost:8088，因此先按 [根 README](../README.md) 启动 Compose。若后端在本机 8000 端口运行：

```sh
API_PROXY_TARGET=http://localhost:8000 npm run dev
```

局域网手机可访问电脑 IP 的 5173 或 Compose 的 8088 端口；目前只验证浏览器桌面/手机视口，不等于真机验收。

## 实际目录

```text
src/
├── app/                  # 路由/外壳、页面、分职责 CSS
├── components/ui/        # Base UI Button、统一样式入口
├── features/system/      # 能力查询、诊断表单、任务恢复
├── features/wardrobe/    # 列表、详情、属性表单、标签
├── features/profile/     # 偏好、城市、天气、条件草稿与边界校验
├── features/imports/     # 两种上传、审核、草稿冲突处理
├── generated/api.d.ts    # 后端 OpenAPI 生成，不手改
├── lib/                  # HTTP、SSE、操作键、样式组合
├── main.tsx
└── test/                 # 组件测试设置
e2e/                      # 对实际 Compose 服务执行的浏览器测试
tools/openapi/            # 隔离类型生成器依赖的 npm workspace
```

其他业务 feature 在对应阶段建立，不预先创建空模块。单个页面不承担完整网络协议；当前诊断页面、hook、API、SSE 已分开。样式按 shell/pages/responsive 分文件。

## 验证命令

```sh
npm run typecheck
npm run format:check
npm run build
npm test
npx playwright install chromium --no-shell
npm run test:e2e
```

E2E 默认访问 http://localhost:8088，必须先启动 Compose 且启用 Fake Provider。可用 E2E_BASE_URL 修改目标；测试创建诊断任务及合成照片/模板批次，确认的测试单品在结束时软删除，审核批次/原件按保守保留策略留下。P3 测试临时修改偏好和城市，并在 finally 中恢复原值。不调用真实模型。测试使用单个浏览器 worker，避免争用默认单个图像 worker 导致无关排队超时。桌面与 Pixel 7 视口使用 Chromium，不代表 Safari/iPhone 真机。

组件测试用 MSW 验证刷新不 POST、网络失败复用幂等键、后台更新不覆盖未保存草稿；SSE 测试验证 UTF-8 分片及重复事件去重。没有通过关闭类型检查绕过契约不一致。

## API 类型更新

先在 backend 目录执行：

```sh
uv run python -m app.export_openapi
```

再回到 frontend：

```sh
npm run api:generate
npm run typecheck
```

OpenAPI 和生成声明都纳入源文件管理；修改 Pydantic 后同时更新，检查生成差异。Zod 对网络数据做运行时验证，并与生成类型做静态兼容检查。

应用使用 TypeScript 6.0.3；openapi-typescript 7.13.0 暂只接受 TS 5，其 workspace 使用 5.9.3。只有生成工具使用 TS 5，应用仍用 TS 6；不加 legacy-peer-deps 或 force。完整版本见锁文件。

## 当前交互边界

- 只有点击运行/重试才 POST；刷新及查询不发模型请求。
- 提交前保存幂等键，模糊网络失败提供“重发同一操作”；完成后恢复同一个 Job。
- SSE 失败回退到只读任务轮询；终态停止订阅。服务数据世代变化时清理旧任务缓存。
- UI 明确显示 Fake；真实服务失败不会自动伪装成模拟成功。
- 审核页只读轮询。编辑器保留打开时版本，发生冲突可保留输入并读取新版本，再保存；确认操作失败重发原始负载与操作键。
- 路由按功能懒加载；首次能力查询不会重挂载业务页面，只有已知 data_epoch 变化才清理旧缓存/草稿。
- 生成器配置采用 Base UI 的 shadcn 风格，当前只落地 Button；不宣称全部业务 UI 已实现。

P3 条件草稿按北京时间日期/城市保存在本浏览器；查询不自动 POST。偏好表单保留编辑时版本及草稿；失败保存可在刷新后恢复并显式重发原操作，或放弃并重新载入。条件草稿提供已删除标签的移除入口。天气失败显示手动入口，过期值只供参考。正式会话及生成将在 P4 接入。

实际验收证据见 [P3](../docs/P3.md)、[P1](../docs/P1.md)、[P2](../docs/P2.md) 与 [开发记录](../docs/DEVELOPMENT.md)。

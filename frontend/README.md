# 前端

P3 已实现偏好、默认城市、天气展示与手动覆盖、条件子页草稿；保留 P2 衣橱/双导入和 P1 Fake 诊断。P4 正式搭配、锁定/替换/聊天和会话恢复已实现；P5 历史/收藏/日历和备份恢复已实现，真实云服务已有小样本证据，范围见[开发记录](../docs/DEVELOPMENT.md)。技术栈见 [ARCHITECTURE](../ARCHITECTURE.md)，规则见 [AGENTS](AGENTS.md)。

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
├── features/outfits/     # 正式会话、生成/调整、结果卡片与只读恢复
├── features/imports/     # 两种上传、审核、草稿冲突处理
├── generated/api.d.ts    # 后端 OpenAPI 生成，不手改
├── lib/                  # HTTP、SSE、操作键、样式组合
├── main.tsx
└── test/                 # 组件测试设置
e2e/                      # 对实际 Compose 服务执行的浏览器测试
tools/openapi/            # 隔离类型生成器依赖的 npm workspace
```

其他业务 feature 在对应阶段建立，不预先创建空模块。单个页面不承担完整网络协议；当前诊断页面、hook、API、SSE 已分开。样式按 shell/pages/responsive 与 wardrobe/imports 分职责维护；界面设计与本地 UI/UX Pro Max 来源见 [界面设计](../docs/design/UI.md)。

## 验证命令

```sh
npm run typecheck
npm run format:check
npm run build
npm test
npx playwright install chromium --no-shell
npm run test:e2e
```

E2E 默认访问 http://localhost:8088，必须先启动 Compose，且确认 PROVIDER_MODE 与 RECOGNITION_MODE 均为 fake；当前本机已启用真实千问时不能直接运行该套件。可用 E2E_BASE_URL 修改目标；测试创建诊断/搭配任务及合成照片/模板批次，确认的测试单品在结束时软删除，审核批次/原件按保守保留策略留下。P3 测试临时修改偏好和城市，并在 finally 中恢复原值。不调用真实模型。测试使用单个浏览器 worker，避免争用默认单个图像 worker 导致无关排队超时。桌面与 Pixel 7 视口使用 Chromium，不代表 Safari/iPhone 真机。

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
- 审核页仅在父任务或行级步骤排队/执行/取消处理中每 2 秒只读轮询，全部结束后停止；显式重试刷新状态后恢复轮询。系统能力仍每 15 秒检查维护状态和数据世代。编辑器保留打开时版本，发生冲突可保留输入并读取新版本，再保存；确认操作失败重发原始负载与操作键。
- 路由按功能懒加载；首次能力查询不会重挂载业务页面，只有已知 data_epoch 变化才清理旧缓存/草稿。
- 生成器配置采用 Base UI 的 shadcn 风格，当前只落地 Button；不宣称全部业务 UI 已实现。

P3 条件草稿按北京时间日期/城市保存在本浏览器；查询不自动 POST。偏好表单保留编辑时版本及草稿；失败保存可在刷新后恢复并显式重发原操作，或放弃并重新载入。条件草稿提供已删除标签的移除入口。天气失败显示手动入口，过期值只供参考。正式会话在点击生成时创建或更新，已提交条件、锁定和结果跨浏览器恢复；详见 [P4](../docs/P4.md)。

实际验收证据见 [P3](../docs/P3.md)、[P1](../docs/P1.md)、[P2](../docs/P2.md) 与 [开发记录](../docs/DEVELOPMENT.md)。

## P5 页面与恢复验证

`/collections` 和 `/calendar` 提供历史、收藏及实际穿着操作；`/collections/:revisionId` 提供固定快照和复用入口。设置页可备份、下载、上传验证和明确确认覆盖。普通 E2E 只导出和验证，不覆盖运行库；覆盖流程单独用 `playwright.restore.config.ts` 在 8099 隔离栈验证，运行要求见 [P5 记录](../docs/history/2026-10-26-p5.md)。

恢复控制 ID 使用独立 localStorage 命名空间保留；业务草稿、待发操作和 Query 缓存仍在 data_epoch 变化时清除。恢复上传网络失败后需重选同一文件再重发原键，服务器校验内容哈希；刷新不会自动上传或应用恢复。

## 当前版本 P6 隔离回归

使用 [独立 Compose](../scripts/compose.regression.json)，按[回归记录](../docs/history/2026-10-27-p6-regression.md)启动并确认卷/网络隔离后，在本目录运行：

```sh
P6_ISOLATED_REGRESSION=1 E2E_BASE_URL=http://localhost:8099 npx playwright test -c playwright.p6.config.ts
```

专用配置包含普通 E2E、运行中刷新/SSE 故障和确认覆盖恢复，覆盖桌面与 Pixel 7 Chromium。前置检查核实实际项目、卷、内部网络和 Fake 能力；`generating-isolated.scenario.ts` 通过 Docker CLI 控制专用 worker 的有界暂停，只允许该隔离栈。不要把本命令指向业务环境；不会请求真实模型。TypeScript 检查包含全部 `playwright*.ts` 配置。

## 只读界面回归

针对已运行的本地服务，可执行（在本目录，Node 24）：

```sh
E2E_BASE_URL=http://localhost:8088 npx playwright test -c playwright.ui.config.ts
```

该套件拦截 API 写请求（写入用例由浏览器本地模拟），验证条件展开、导航、衣橱筛选/分页/滚动恢复、详情编辑与弹层以及多尺寸布局。衣橱需有至少一件可穿单品供详情返回测试。截图输出到忽略目录 `data/acceptance/ui-refresh/browser-results`。它不替代隔离 Fake 栈里的生成/导入/恢复业务回归。

## H5 穿搭页面

首页和 `/outfits/:sessionId` 优先展示衣服组合；`/outfits/prepare`、`/outfits/:sessionId/prepare` 填写条件与查看天气；锁定、替换和聊天由当前页“调整这套”面板承载，旧 edit 链接重定向打开面板。进入页面或恢复面板都是只读；生成按钮获得任务响应后返回展示页。方案切换仅预览，点击“选用这套”才保存选择。页面行为以 [PRODUCT](../docs/PRODUCT.md) 为准。

2026-10-28 今日穿搭改造：收藏/穿着在原页面板完成；单品面板可锁定与替换，调整面板分单品/文字两种方式；条件草稿自动本地保存。测试范围、已知限制和证据见 [本轮记录](../docs/history/2026-10-28-today-refinement.md)。

2026-10-28 穿搭记录：主导航四项，`/collections?view=history|favorites|calendar` 提供三个分栏，旧 `/calendar` 自动跳转。详情返回来源分栏与日期，月历读取整月分页。UI 回归增加 `records-ui.spec.ts`，写入通过浏览器模拟；实现与验证见 [本轮记录](../docs/history/2026-10-28-records-refinement.md)。

2026-10-28 设置优化：四个设置子页增加摘要分组、表单离开保护、城市原请求恢复与条件来源返回、备份覆盖确认面板和独立服务状态。`settings-ui.spec.ts` 验证只读浏览及模拟保存/覆盖操作，禁止在业务环境执行真实恢复测试。证据见 [设置优化](../docs/history/2026-10-28-settings-refinement.md)。

2026-10-28 录入优化：上传前缩略图与逐文件校验、Excel 指引、审核分类与面板编辑、入库请求原对象恢复。`imports-ui.spec.ts` 的上传/确认请求全部模拟；正常业务 `wardrobe.spec.ts` 同步新控件，但只能在隔离 Fake 环境运行。证据见 [录入流程优化](../docs/history/2026-10-28-imports-refinement.md)。

2026-10-28 移动端统一：公共面板支持浏览器返回先关闭、嵌套草稿确认和独立底部提交；`mobile-polish.spec.ts` 覆盖返回历史、标签草稿、小屏上传入口和字号。弹窗历史监听在 Router 创建前安装，测试时仍拦截所有 API 写入。证据与真机限制见 [移动端收尾](../docs/history/2026-10-28-mobile-polish.md)。

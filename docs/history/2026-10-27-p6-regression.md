# 2026-10-27 · P6 逐项台账与当前版本隔离回归

基线 `90f1bab`。用户授权整理 A-01 至 A-34，并补当前版本隔离回归；禁止真实模型调用和影响业务数据。本轮没有修改应用实现或迁移，新增/加强测试与隔离验收工具。

## 台账与发现

先建立 [34 项逐项台账](../plans/P6-acceptance.md)，对照 PRODUCT 的原始可观察结果及现有测试源码，逐条分开记录工程覆盖与外部边界。保留 P1–P5 和真实服务历史证据，不把计划、测试名称或同组其他项目当成通过证据。

发现并补充：

- A-02：模型不可用时仅人工填品类也可确认，默认可穿，全部其他属性保持未知。
- A-03/A-26：三张有效照片中一张识别失败，另两张可确认；同一确认请求同时存在有效、缺品类、版本冲突三行，逐行结果及幂等重放明确，修正后各自确认。
- A-11/A-22：仅一件上衣不凑三套，未拥有鞋履无 garment_id；锁定运动外套遇正式场合时保留锁定并明确不匹配。
- A-14/A-16：真正删除快照中引用的衣服后，复用会话列出失效 ID，旧快照与图片不变；穿着记录修改/删除后完整搭配快照不变。
- A-27：导入、搭配、备份三个实际终态的 SSE result 与 GET 结果逐字段一致，类型不串用，游标末尾读取为空且不重执行。
- A-08/A-25：聊天调整后断言锁定外套完整快照仍相同；第二个浏览器上下文读取相同选择、锁定、条件和任务，零写请求。
- A-12/A-13/A-27：在 Fake Provider 调用中暂停，数据库状态确认为 running，再刷新、关闭页面及新上下文重开。注入 SSE 断连和 410 过期游标，恢复只读查询；释放后同一任务完成，账本恰好一次调用，无额外浏览器写请求。
- A-20：设置页明确显示 Fake 提示，不只检查后台 mode 字段。

## 隔离环境

使用 [compose.regression.json](../../scripts/compose.regression.json)，不继承业务 Compose 或 `.env`：

- 项目 `wardrobe-p6-regression`，全新三卷 `wardrobe-p6-regression_postgres_data/media_data/control_data`，实际 Mounts 已检查。
- 应用库 `regression_test`；单元/集成套件使用另一个 `regression_suite_test`，测试夹具不能清理浏览器目标库。
- 专用镜像 `wardrobe-p6-regression-web:local` 从当前前端源码/锁文件构建，不覆盖业务 Web 镜像；后端复用 `wardrobe-test:latest` 依赖，挂载当前 app/migrations/tests 只读。
- Web 仅宿主回环 8099。Compose 声明的数据库端口 55441 在 OrbStack 内部网络下未实际暴露；测试通过容器内连接数据库，不依赖该端口。
- API/worker/controller/db 只连接 internal 网络。仅 Web 额外连接 ingress 网络供宿主浏览器访问；后端不能访问云端。两种 Provider 均为 fake，无千问或天气凭据。
- Playwright globalSetup 在写请求前检查项目标签、卷前缀、后端网络、Fake 环境、无真实凭据以及 HTTP capabilities；发现不匹配即拒绝。
- 专用 `regression_worker.py` 只在隔离库/Fake 模式/显式标识下运行。文件标记暂停下一次 Fake 调用，最多 60 秒；没有给应用增加生产故障开关。
- Node 24.19.0，真实 PostgreSQL 18.4；Chromium 桌面与 Pixel 7 视口，不能视为 Safari/真机。

## 实际命令与结果

原始日志与截图位于 Git 忽略的 `data/acceptance/p6-regression/`。

```sh
docker compose --env-file /dev/null -f scripts/compose.regression.json up -d --build --wait
docker exec wardrobe-p6-regression-db-1 createdb -U wardrobe regression_suite_test
docker compose --env-file /dev/null -f scripts/compose.regression.json --profile test run --rm test pytest -q -p no:cacheprovider
# 在 frontend 目录，PATH 指向 Node 24.19.0：
npm test
npm run typecheck
npm run format:check
P6_ISOLATED_REGRESSION=1 E2E_BASE_URL=http://localhost:8099 npx playwright test -c playwright.p6.config.ts
```

- 后端全套 **140 passed，48.69 秒**；先补的五项独立运行 **5 passed，1.16 秒**。
- 全套之后补历史复用、穿着快照和三类 SSE 断言；`tests/test_p6_acceptance.py tests/test_collections.py` 定向 **12 passed，1.68 秒**。因此最终源码新增九项参数化验收案例，未把 12 项与全套相加冒充无重复总数。
- 前端组件 **9 文件 / 21 tests passed**，2.80 秒；包括人工草稿、幂等重发、终态停止订阅和 SSE 分片去重。

## 首轮失败与修正

首次浏览器预检因 OrbStack internal 网络不能暴露宿主端口失败，尚未执行测试写入；随后只为 Web 增加 ingress 网络，后端继续无外网。

第一轮实际浏览器回归存在测试准备错误：Fake 来源提示位于设置页，新增断言却在首页查找；运行中恢复测试依赖已有衣物，但空衣橱合法直接返回 no_match，未进入 Fake 调用。其暂停标记又被后续搭配测试消耗，导致该测试超时。修正为自行上传并确认合成单品、在设置页检查来源、finally 清理未消费标记并释放等待，保留原有业务断言。

首轮日志和失败截图/trace 分别保留在 `browser-first.log`、`browser-first-results/`，没有清空数据库、删失败测试或降低断言来通过。最终全套用同一份修正后的测试源码重新执行。

## 最终浏览器与静态检查

最终 **18 passed（1.6 分钟）**，桌面和 Pixel 7 Chromium 各 9 项；实际执行导入、生成、按钮/聊天局部调整、两上下文恢复、收藏/穿着、删除/隐藏历史、手动天气、备份上传验证和确认覆盖恢复。A-12 两个项目均断言真实 running 状态、断连/过期游标后的只读恢复、同一 Job、一次 Fake 调用账本和零额外页面写请求。恢复测试验证 data_epoch 改变、偏好还原及旧 localStorage 操作清除。

抽查桌面搭配和移动恢复截图，内容可见、Fake 标识明确；既有场景的无横向溢出和 pageerror 断言通过。不是 Android/iOS 真机，也不证明真实网络环境或所有页面的全局无错误。

前端 typecheck / format:check，修改后端测试的 Ruff / format，隔离 worker 的 Ruff / format，文件结构、文档链接、台账 ID 完整性与 `git diff --check` 均通过。TypeScript include 改为全部 `playwright*.ts`，新增专用配置也纳入检查。专用前端镜像本轮实际构建成功；未修改应用源文件，因此没有部署业务服务。

## 数据保护与剩余项

业务栈开始/结束只读逐表和媒体 SHA-256 对照：**25 张表、373 个媒体文件、96,015,421 字节完全一致**。媒体集合哈希仍为 `dc70f9e881dc9da24c34fe152cff222d3d5f468ee2bba25130cbf944736ef753`；80个历史快照、119条媒体元数据、12条识别账本、51条搭配账本及系统世代均不变。原始摘要在忽略目录，没有将用户照片、数据库内容、凭据、原始日志或控制令牌纳入源码。

隔离浏览器库的搭配任务 provider_mode 与识别调用 config.mode 均为 fake，后端内部网络无外网；本轮零真实模型/天气调用。停止本轮所有服务，不删除命名卷；业务 api/db/web 保持健康，worker/controller 继续运行。

本轮完成全部34项的工程证据整理及已识别回归缺口，**不是 P6 外部条件全部验收完成**。真实HEIC原片、Microsoft Excel客户端保存文件、设备/双平台/跨手机明细、真实模型复杂场景与软属性质量、真实规模及物理存储故障等仍按台账保留。没有为填满状态将合成照片、故障注入或模拟HTTP写成真实外部验收。

## 提交前复核

复核测试断言、逐项证据、独立 Compose 卷/网络、暂停工具与覆盖恢复入口，未发现阻断提交的问题。再次运行上述隔离后端全量命令，最终源码 **144 passed，57.27 秒**，日志为忽略目录下的 `backend-review.log`；此前 140 项与定向 12 项保留为执行历史，不相加。前端 typecheck、format:check、修改 Python 文件的 Ruff/format、结构与文档链接检查、34 项编号完整性均再次通过。结构检查最初使用系统 Python 被版本保护拒绝，改用项目 Python 3.13 后通过。

本次只启动隔离测试所需数据库，测试容器运行后自动移除，随后停止隔离栈并保留卷。业务只读摘要 `review-business.json` 与上一轮 `business-after.json` 完全一致。浏览器未改动，沿用最终 18 项成功证据，本次未重复执行。提交范围仅测试、验收工具、配置和文档，排除本地数据、原始回执和真实凭据；独立配置中的密码为公开测试占位值。

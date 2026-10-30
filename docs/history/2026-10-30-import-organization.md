# 2026-10-30 · 导入与衣橱整理资料补齐

用户要求先计划、逐项实现并验证。按 [I1～I4](../plans/import-organization.md) 串行完成，字段与边界见 [导入资料契约](../IMPORT-DETAILS.md)。同目录另一个会话实施 P7.1，本任务保留其文件；使用独立 wardrobe-import-regression 项目、数据库和卷验证。在 P7.1 部署完成后对照其发布清单，文件完全一致，再冻结包含两项能力的发布源码。

## 逐项交付

| 阶段 | 实现 | 定向验证 |
|---|---|---|
| I1 审核与正式入库 | 子类、状况、合身、获得资料、收纳及备注；草稿与正式属性分层，同品类子类在确认时才创建/复用 | 后端新档案 9 项；含既有导入共 19 项；前端编辑/轮询 5 项 |
| I2 Excel v2 | 原 12 列后增加 9 个可选列、中文下拉、日期/金额说明；兼容完整 v1、按字段报错并可修正 | Excel 新资料、媒体与既有导入 25 项；旧 v1 完整入库后仍保留未知 |
| I3 AI 子类 | garment-vision-v3 按品类限定候选；可见破损只给核对提示；不猜合身/价格/日期/收纳 | 识别输出、调用恢复、人工保护 32 项；补充停用候选排除后随最终回归通过 |
| I4 整体流程 | 照片/Excel→审核→档案→盘点；旧草稿与完整备份恢复、窄屏与部署 | 完整后端 264 项；最终备份版本/恢复 2 项；桌面/手机流程 2 项 |

初始资料不伪造过去的维修/退出事件。未知与 0 元分开，已收纳与不可穿分开；只有图片与品类必填。四季目标、补充计划与换季会话仍独立维护。

## 发现与修复

- 新表单的辅助说明与下拉选项会影响精确标签定位；为字段增加明确无障碍名称，错误与说明采用描述关联；修改字段后清除该字段过期错误。浏览器复验通过。
- 原导入测试模拟识别器仅接受两个参数，新候选目录增加第三参数；更新模拟接口。基础品类编辑测试先明确清空识别子类，不绕过 W1 的跨品类子类保护。首次全套 3 项失败，修正后定向 19 项、完整 264 项通过。
- 恢复对比剔除每次实时生成的 stats_at，继续核对计划、数量、单品和正式/草稿资料。盘点浏览器定位改为实际打开的单品明细弹层，并检查“已确认 1 / 待核对 0”。
- 备份数据库迁移仍为已部署的 0011_manual_outfits，但草稿 JSON 已扩展；app_version 改为 0.6.1-import，防止旧应用误接受新字段。旧版本拒绝与新版完整恢复均通过。
- 下载复查发现响应文件名仍写 v1，内容已为 v2；改为 wardrobe-template-v2.xlsx，增加下载头与实际工作簿版本联合断言，最终 Excel 3 项通过。

## 实际验证

- 后端完整：`docker compose -f data/acceptance/import-organization/compose.json run --rm test pytest -q -p no:cacheprovider`，**264 passed，99.62 秒**。最终备份版本隔离修改后 `tests/test_import_recovery.py`：**2 passed，19.64 秒**。
- 前端：Node 24 的 `npm test -- --maxWorkers=1`，**23 文件 / 79 项通过**；表单无障碍修复后相关 **2 项通过**；TypeScript、Prettier 和构建通过。
- 浏览器：`IMPORT_ISOLATED_REGRESSION=1 E2E_BASE_URL=http://localhost:8100 npx playwright test -c playwright.import.config.ts`，**2 passed，7.2 秒**；桌面与 320×568 Chromium 模拟手机，修改、负金额拒绝、0 元、保留草稿、刷新读取、确认、生命周期与盘点均通过，零额外识别请求和 pageerror。
- 最终 Excel：`docker compose -f scripts/compose.import-regression.json run --rm test pytest -q -p no:cacheprovider tests/test_import_excel_details.py`，**3 passed，22.00 秒**；新可复用配置通过实际运行，仍使用专用测试卷。
- Ruff/格式、mypy（116 源文件）、规模/静态依赖和文档链接检查通过。OpenAPI 与前端类型同步生成，不手改声明。

最初专用 Compose 保存在忽略目录，现将相同配置整理为 [可复用配置](../../scripts/compose.import-regression.json)，数据库不暴露宿主端口。基于已有 wardrobe-test:latest 镜像，启动 `db`，创建独立 regression_suite_test，然后启动 api/worker/controller/web；不能连接业务库。浏览器使用 regression_test，后端 pytest 使用另一 regression_suite_test。运行证据、冻结源码与截图位于忽略目录 `data/acceptance/import-organization/`。

## 部署与数据保护

- 升级前完整包 `pre-upgrade-5b8bdf42-01d6-4f5d-a285-faf730c05c3e.zip`，127,573,928 字节，ZIP CRC 通过，SHA-256 `2f4e56bb2e63c01e3015be31bfd01fa5498255c6db0eb962b39ab814b28863d9`，保存在忽略目录。当前镜像另存 rollback 标签，原包和用户照片未提交。
- 冻结源码位于同目录 release，清单包含 426 个前后端文件；生产源码包含本任务及已部署 P7.1。后端从冻结目录构建，Web 使用经浏览器验证的同版镜像。通过 `docker compose -f compose.yaml -f data/acceptance/import-organization/deploy.json up -d --no-build --no-deps --wait api worker controller web` 部署，下载文件名最终修正后仅更新三个后端服务，全部健康。
- 沿用 0011_manual_outfits，无新迁移、不重启业务数据库，不改 .env、真实服务配置或数据卷。`pre-deploy.json` / `post-deploy.json` 的 **35 张表和 390 个媒体文件路径/摘要完全一致**，无活动业务任务，结果存 preservation-result.json。
- 部署后 `E2E_BASE_URL=http://localhost:8088 npx playwright test -c playwright.ui.config.ts imports-ui.spec.ts`：**8 passed，11.5 秒**。写请求被拦截或模拟，未实际上传/识别。正式 HTTP 只读检查确认模板下载名 v2、meta=2、21 列、9 个新字段的 OpenAPI schema，以及 P7.1 手动搭配接口仍在。
- 最终 TypeScript、Prettier、Ruff/格式、mypy、结构及文档链接检查通过；人工查看 320 像素手机表单截图，保存/取消可见，内容可滚动。独立导入测试栈停止，保留卷、日志和截图；正式服务继续运行。

## 验证边界

本轮没有调用真实千问；v3 的提示及响应校验通过 Fake/模拟 HTTP 验证，不能把原 v2 真实小样本结果当作新版质量验收。未声明 iOS/安卓真机或新版 Excel 经所有办公客户端保存后兼容。没有向正式衣橱创建测试衣服、改用户盘点目标或清理照片；未提交 Git。

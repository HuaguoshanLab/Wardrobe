# 2026-10-29 · W1 单品生命周期

状态：**W1 已完成实现、验证与本地业务部署**。用户要求“按计划开始实现 W1，做完一个，验证一个”。本轮仅 W1，保留此前未提交的规划文档。

## 实现

P-30 生命周期资料、独立状态、追加事件、更正、退出/撤销、稳定子类、穿着天数、移动端入口与档案筛选；统一搭配排除及锁定保留。具体字段和兼容边界见 [W1](../W1.md)。追加迁移 `0007_lifecycle`；未改写历史迁移。

UI 使用项目 UI/UX 技能与现有设计。生命周期独立子页、公共面板、离开保护、原操作重发；新增表单标签检查发现帮助文字被并入标签名称，已修正标签及说明关联。

## 验证证据

- 首轮真实 PostgreSQL 定向：`docker compose --profile test run --build --rm test pytest -q tests/test_lifecycle.py tests/test_outfits.py tests/test_imports.py`，23 passed。
- 迁移/备份定向：测试服务挂载最新 tests，执行 `pytest -q tests/test_lifecycle_recovery.py tests/test_backups.py`，12 passed。新生命周期资料/子类/关联事件/回执/图片完整恢复；事务内独立 schema 的旧 garments 升级前后原字段一致。
- 前端 `npm test`：55 passed；包括打开零写入、退出明确确认、失败后刷新原键原负载重发、草稿关闭保护。Node 24.19.0。
- 完整后端：测试服务挂载最新 app/tests，`pytest -q -p no:cacheprovider`，180 passed。随后补充分页无关的退出事件定位及更精确的冲突断言，最终 W1 两文件定向 8 passed。
- 前端最终全套 55 passed；中间一次同时构建时已有 records 组件用例等待超时，未改动该实现/测试，定向11项及最终全套复跑通过。没有跳过或删除失败测试。
- `ruff check app migrations tests`、`ruff format --check app migrations tests`、`mypy app`、OpenAPI 导出与 `npm run api:generate`、`npm run typecheck`、`npm run format:check`、生产构建通过。
- `P6_ISOLATED_REGRESSION=1 E2E_BASE_URL=http://localhost:8099 npx playwright test -c playwright.p6.config.ts lifecycle-isolated.scenario.ts --timeout=45000`：最终桌面/Pixel 7 Chromium 共2项通过。覆盖创建/选择子类、精确金额、待洗收纳、退出归档、撤销、更正、刷新零写入及图片保持。首次两项因子类 label 精确匹配超时，补充明确 aria-label 后通过，不绕过断言。
- 同隔离配置下 `wardrobe.spec.ts outfits.spec.ts collections.spec.ts restore-isolated.scenario.ts`：12 passed，覆盖照片/Excel、锁定/替换/聊天、收藏/穿着/旧图和浏览器确认覆盖恢复。
- `E2E_BASE_URL=http://localhost:8088 npx playwright test -c playwright.ui.config.ts lifecycle-ui.spec.ts --timeout=45000`：部署后2项只读通过，拦截所有API写入；读取/打开/关闭/刷新零写请求、零页面错误、无横向溢出。
- 检查隔离移动端完整截图，沿用现有暖白/深绿、可换行档案、公共面板与底部导航。截图在忽略目录 `data/acceptance/p6-regression/browser-results/`；业务只读截图在 `data/acceptance/ui-refresh/browser-results/`。
- `backend/.venv/bin/python scripts/check_structure.py`：238个手写文件通过；生命周期页面345行，职责为页面组合/操作状态，表单及历史展示已独立；`python3 scripts/check_docs.py` 和 `git diff --check` 通过。

## 部署与数据保护

- 升级前通过旧版 `/backups` 完整导出：`2ac44eb0-59a1-4c19-885a-19cff36a3d48`，125,877,880字节，保存在忽略目录 `data/acceptance/w1/pre-upgrade-2ac44eb0-59a1-4c19-885a-19cff36a3d48.zip`。未进行业务恢复覆盖。
- 确认活动任务0。构建 api/web，停止业务 web/api/worker/controller，运行 `docker compose run --rm migrate`，随后 `docker compose up -d --wait api worker controller web` 成功。正常服务保留运行在8088。
- `docker compose exec -T api alembic check` 无差异，current 为 `0007_lifecycle (head)`。
- 升级前后比较24张原业务/检查点表（排除迁移版本，并剔除 garments 新增列）和390个媒体文件，行数及SHA-256完全一致。包含120个单品档案（含既有软删除）及99个搭配快照。摘要保存于 `data/acceptance/w1/before.json` 与 `after.json`。
- 不改真实服务配置，不进行真实模型生成；新资料保持未知。备份恢复同版限制见 [W1](../W1.md)。

## 边界

全部写入测试使用独立 wardrobe_test 或 wardrobe-p6-regression；真实业务栈不执行导入/退出/恢复测试。无新增真实模型调用。浏览器手机视口不能替代 iOS/安卓真机。

下一步：W2 可编辑四季盘点。本轮到 W1 为止，不提前实现 W2～W4。

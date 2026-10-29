# 2026-10-29 · W2 可编辑四季盘点

用户要求“按计划继续实现 W2 可编辑四季盘点”。状态：W2 已实现、验证并完成本地部署。本轮只实施 W2，保留此前 W1 和 W1 界面改动，不开始 W3。

## 已实现

- 四季独立版本化目标、稳定需求 ID；新增、改名、排序、停用、删除、规则和目标区间编辑。0～0 与未设目标分开，实际数量只读。
- 整季草稿显式保存、逐层放弃保护、原操作键重发、冲突保留输入。跨季复制追加新 ID，不覆盖目标季节已有行。
- 服务端从完整衣橱计算匹配、有效、待核对、不可用及共享覆盖；同一 REPEATABLE READ 快照返回配置版本、时点和明细。失效标签规则要求修复，不偷偷扩大匹配。
- 子类可选参考名称、新建、改名、停用/重新启用、引用影响确认；现有关联使用稳定 ID，停用不破坏已有需求。
- 日常轮换容量估算显示公式和参数，显式采用到草稿，用户设上限；参数改变后旧响应不能被采用。局域网 HTTP 的新需求/复制使用 getRandomValues 生成 UUID。
- 入口“我的衣橱 → 四季盘点”，四季切换、事实卡片、单品分组明细、打开档案修改后返回重新核算；沿用暖白/深绿、公共面板与底部导航。

契约见 [W2](../W2.md)，规则依据 [计划 §4](../plans/wardrobe-organization.md#4-w2--可编辑四季盘点)。追加 0008_inventory，备份版本 0.3.0-w2；未改写旧迁移。

## 运行验证

- 后端隔离 PostgreSQL 全套 `docker compose -f scripts/compose.regression.json run --rm test pytest -q`：205 passed；只有只读测试目录的 pytest 缓存警告。规范化保存响应后，四个 inventory 测试文件加 `-p no:cacheprovider` 定向复验：25 passed。
- 覆盖非法/零/未知目标、字段 AND/OR、未知和明确不匹配优先级、待洗/收纳/维修/退出、跨季共享、标签删除、子类跨类/停用、版本冲突、首次并发保存、幂等重放。500 件隔离数据完整统计、10 条以内 SQL、5 秒以内；并发修改不污染当前统计快照。
- 升级与完整备份恢复测试验证旧单品字段保留、新目标/子类状态恢复，未在真实业务库执行恢复测试。
- `ruff check app migrations tests`、`ruff format --check app migrations tests`、`mypy app` 通过；OpenAPI 导出和前端类型生成完成。Node 24.19.0；生产镜像构建通过。
- 组件覆盖目标草稿/0～0、复制追加、新需求取消不清父草稿、网络失败刷新后原键原负载重发、非法区间保留输入，以及估算参数改变后的晚到结果。
- 首次浏览器验收错误地假设其他旧单品的未知子类可以排除，已改为检查真实待核对集合及核对后的精确差值；未改业务规则来迎合断言。随后复制下拉框测试改用可访问 combobox 角色定位。最终隔离命令 `P6_ISOLATED_REGRESSION=1 E2E_BASE_URL=http://localhost:8099 npx playwright test -c playwright.p6.config.ts inventory-isolated.scenario.ts inventory-ui.spec.ts lifecycle-isolated.scenario.ts --timeout=60000`：桌面/Pixel 7 共6项通过，包含 W1 兼容；关闭 randomUUID 仍能新增/复制。
- 最终 `npm test`：19文件63项通过；`npm run typecheck`、`npm run format:check`、生产构建通过。估算测试首次存在 TS 括号及模拟 request_id 非 UUID 的夹具错误，修正后验证晚到响应已成功返回但不可采用，没有放宽生产校验。
- 部署后 `E2E_BASE_URL=http://localhost:8088 npx playwright test -c playwright.ui.config.ts inventory-ui.spec.ts lifecycle-ui.spec.ts --timeout=45000`：8项只读检查通过，拦截全部 API 写请求。320px、横屏、长名称、嵌套返回、草稿关闭与按钮可达性通过；零页面错误。截图保留于忽略目录 `data/acceptance/p6-regression/browser-results/` 和 `data/acceptance/ui-refresh/browser-results/`，已人工查看移动端页面与编辑面板。
- `backend/.venv/bin/python scripts/check_structure.py`：260个手写文件通过，无新增超过400行源文件；DEVELOPMENT 已超过300行，评估后仅保留本轮索引，详细证据放独立文件，未向概览追加实施全文。文档链接与差异空白检查通过。

## 本地部署与数据

升级前使用旧版备份 API 完整导出并下载 `a8dc2866-0226-44f7-a414-fe6651b3f33e`：125,887,494 字节；SHA-256 `ab032f0c740bfc9a797280eacb9b2d4bbf32c66f509630bca8a773b9f8032870` 与接口一致，ZIP CRC 检查通过。位于忽略目录 `data/acceptance/w2/pre-upgrade-a8dc2866-0226-44f7-a414-fe6651b3f33e.zip`。

升级前活动任务为 0；业务 26 张表、390 个媒体文件摘要保存于 `data/acceptance/w2/before.json`。构建镜像后停止 web/api/worker/controller，运行 `docker compose run --rm migrate`，`docker compose up -d --wait api worker controller web` 成功。`alembic current` 为 0008_inventory head，`alembic check` 无差异。升级后 `after.json` 与 `before.json` 完全一致，包含120份单品档案（含既有软删除）、99份搭配快照；新盘点配置保持空白，由用户设定。真实服务配置保留，无业务恢复覆盖。

## 已知边界与下一步

统计仅基于已录入衣橱，资料未知仍需用户核对；衣服件数不能由城市直接推断。自动购买、自动退出和 W3 清单尚未实现。所有写入验收在独立 Fake 栈，真实业务只做备份、升级和只读检查，无新模型调用。Chromium 手机视口不能代表安卓/iOS 真机验收。

下一阶段：W3 补充、观察和处理清单；本轮不展开。

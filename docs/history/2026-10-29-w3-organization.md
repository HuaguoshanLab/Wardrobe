# 2026-10-29 · W3 补充、观察与处理

用户授权按计划继续 W3，逐项实现验证。契约见 [W3](../W3.md)，P-32；保留此前 W1/W2 未提交改动，未开始 W4。

## 实现

- 补充计划：手工/缺口创建、跨季共享来源、数量/总预算/理由/备注、计划中/已购待入库；不同正式单品核销数量，部分完成、独立取消剩余和显式重开。一个 garment_id 只核销一个计划；后续退出不抹掉采购完成事实。
- 观察决定：明确超额、已确认状况/合身问题、可证明的多需求覆盖及主动标记；稳定原因键保存保留/观察/待处理/撤销。W1 保留与撤销同步当前原因，新问题只提示不自动改决定。无穿着记录不推断闲置。
- 处理：全部季节 K/U 前后数量、目标和失效规则提醒；确认时锁定统计依据并重算，过期则拒绝。维修/改衣和实际退出复用 W1 状态、事件、版本与幂等事务；原 W1 retire API 也要求预览令牌。
- 前端：衣橱/盘点进入双页签清单；单品详情可主动整理，返回恢复原清单。新衣服仍走照片/Excel 审核，入口与审核页携带返回计划链接，确认入库后明确关联。原请求恢复、离开保护和单独退出确认保留。
- 数据：追加 0009_organization 四张表；外键/唯一约束保护引用，软删除来源和已归档单品保留历史；app_version=0.4.0-w3。业务模型注册集中到 db/registry，迁移与独立备份控制进程共用。

界面使用项目 UI/UX Pro Max：首轮 `wardrobe planning calm mobile --design-system` 输出营销叙事与粉色配色，与现有任务型界面不符，未采用；缩小检索 `confirmation destructive action --domain ux` 命中操作前确认及成功反馈。沿用已确认暖白/深绿和公共 Base UI 面板，不新增依赖、字体或图片资产。

## 分项验证

- 补充计划首轮 PostgreSQL 4 项通过；后续增加两件真实单品完整核销与禁止缩减已完成数量测试。
- W1/W2/W3 定向 20 项通过，随后盘点计划数接入复验 11 项通过。
- W3 新数据完整备份恢复通过，迁移临时 schema 验证只新增表、不改旧数据。
- 修复注册问题后，备份与恢复定向 11 项通过；最终后端完整回归 220 项通过（真实独立 PostgreSQL、Fake Provider），包括进程中断恢复、旧入口退出影响必填和并发写入后拒绝过期确认。
- 前端全套 67 项通过，包括新补充计划的丢失响应/原请求重发、零预算、离开保护，以及实际退出成功但响应丢失、刷新恢复面板、已归档后核对原回执。最后增加影响变化清除旧确认后，相关 7 项复验通过。
- W1/W3 状态同步与真实数据库并发最终定向 13 项通过；已有单品写事务持锁时，退出等待它完成，再拒绝过期依据。
- TypeScript、Ruff、mypy（102 个源文件）、Prettier 及生产镜像构建通过。结构检查通过；单品详情 419 行仍作为页面编排职责保留，审查理由见 D-35，不新增超过 600 行的手写业务文件。
- 最终隔离浏览器 8 项通过（桌面 Chromium、Pixel 7 模拟）：W1 生命周期退出/撤销、W2 配置/子类/实时统计、W3 部分核销/取消剩余/保留/过期影响拒绝/重新确认退出，以及 W3 只读草稿保护与窄屏横屏。生产只读验收 10 项通过，拦截全部写请求，无页面异常。

实际后端命令：`docker compose --profile test run --rm -v "$PWD/backend/app:/app/app:ro" -v "$PWD/backend/tests:/app/tests:ro" -v "$PWD/backend/migrations:/app/migrations:ro" test pytest -q`。测试使用 wardrobe_test，不访问业务数据；pytest cache 因容器只读权限警告，不影响测试结果。

## 验证发现与修复

- 新计划对象过早加入 Session，后续查询触发自动 flush，缺少必填字段；调整到字段准备后加入，不放宽数据库约束。
- 格式化长导入后自动整理清除了仅用于注册模型的导入；同进程测试被 API 导入掩盖，独立恢复进程严格表集合校验发现问题。改为显式统一注册函数，保留严格表集合和子进程故障测试。
- 迁移探针的 JSON 字面量被 SQLAlchemy 当成绑定参数，改为显式绑定 JSON 值；不是修改迁移来迎合测试。
- 浏览器发现 select 的标签匹配受 option 文本影响，补显式可访问标签；选择单品测试修正名称空格匹配。
- 实际处理面板底部按钮由公共 SheetFooter 渲染到表单外，最初点击未提交；增加稳定 form ID 与按钮 form 关联，保留完整浏览器提交测试。
- W1 维修完成或撤销退出后，原 W3 待办可能停留在维修中/已处理；改为观察复核，新增定向断言。维修失败后的重新核对实际读取单品版本；影响令牌变化清除之前的勾选确认。
- 并发审查发现 SHARE ROW EXCLUSIVE 允许已有行锁进入，随后争抢写锁可能死锁；退出改为短暂 EXCLUSIVE 锁，普通读取仍可并行。测试实际等待数据库 Lock 状态，再让现有事务更新并提交，确认退出返回版本冲突。
- 最后浏览器复验发现 W1 可在退出预览加载完成前提前勾选，数据返回又清除旧确认，导致提交按钮保持禁用。改为预览加载中/失败时禁止勾选；真实浏览器复验覆盖此顺序，不用延时或移除断言绕过。

浏览器命令（在 frontend/，Node 24）：`P6_ISOLATED_REGRESSION=1 E2E_BASE_URL=http://localhost:8099 npx playwright test -c playwright.p6.config.ts organization-isolated.scenario.ts organization-ui.spec.ts lifecycle-isolated.scenario.ts inventory-isolated.scenario.ts --timeout=60000`；部署只读：`E2E_BASE_URL=http://localhost:8088 npx playwright test -c playwright.ui.config.ts organization-ui.spec.ts inventory-ui.spec.ts lifecycle-ui.spec.ts`。

截图位于 `data/acceptance/p6-regression/browser-results/` 和 `data/acceptance/ui-refresh/browser-results/` 对应 W3 场景：`w3-plan-form.png`、`w3-board.png`、`w3-confirmation.png`、`w3-supply.png`、`w3-exit-preview.png`。已检查长名称、实际完成进度与跨季确认面板；截图等待数据与面板关闭，不将过渡帧当作最终界面。

## 部署与数据保护

旧版 API 完整备份 `5fbe21de-2493-4bbc-ab67-2325b0438128` 已下载到 `data/acceptance/w3/`，125,887,556 字节；SHA-256 `6f5826fde5315beb4475b943f52b82bfdd03d3152fc55022ff24cbbaa9e83cf9` 与接口一致，ZIP CRC 通过。活动任务为0；升级前表和媒体摘要保存在同目录 `before.json`，部署前再读 `pre-deploy.json` 与之完全一致。

`docker compose build api worker controller migrate web` 构建通过，最终后端及 Web 修复分别重建；停止 web/api/worker/controller 后执行 `docker compose run --rm migrate`，再 `docker compose up -d --wait api worker controller web`。就绪正常，`alembic current` 为 `0009_organization (head)`，`alembic check` 无额外迁移。部署后 `after.json` 与 before 完全一致：28 张原表、390 个媒体文件未变，未混入验收衣服。四张 W3 新表由迁移新增；完整写入和恢复验证均在隔离库完成。

## 边界

部署只读验收后再次生成 `after-readonly.json`，原表与媒体摘要仍完全一致。隔离 Fake 栈及 test-db 已停止，验收卷和证据保留；业务服务继续运行。文档检查（82 份 Markdown、423 个本地链接）、结构检查（291 个手写文件）和 `git diff --check` 通过。

全部写入验收使用隔离 Fake 栈，不新增真实模型调用；业务只备份、升级及只读验收。手机使用 Chromium 模拟窄屏与横屏，不替代真机。退出影响使用短事务表锁；单人本地规模适用，多用户规模需重新评估锁粒度。W4 和原 P7 未展开。

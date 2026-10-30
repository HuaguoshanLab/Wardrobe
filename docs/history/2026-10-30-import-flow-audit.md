# 2026-10-30 导入全流程检查

用户要求检查表格导入、照片识别到确认入库，发现一个问题修复一个并逐项验证。本轮修复四项问题，均先补测试复现，再修复验证；已更新本地服务。字段行为同步到 [导入契约](../IMPORT-DETAILS.md)。

## 逐项修复

| 问题 | 修复 | 验证 |
|---|---|---|
| 修改品类仍残留原子类，例如上装改鞋后带入旧上装子类 | 后端自动清空旧子类并标记人工修改；显式同时填写新子类可保留；界面同步清空并提示 | 后端首次 1 失败/1 通过，修复后相关 10 项通过；前端相关 3 项通过 |
| Excel 合法金额 `19.9000`、`1e2` 返回额外小数或科学计数法，前端拒绝解析整批 | 通过原精度校验后，统一输出两位小数；超限输入仍拒绝，未知和零仍区分 | 两项新测试先失败，修复后金额与档案相关 11 项通过 |
| 非法 Excel 字段显示成空值/未知，但不改值就不能清除原字段错误 | 审核面板列出错误并提供明确重置；结构性错误引导修正源文件，不能靠属性修改消除 | 新增交互测试先失败，修复后相关 5 项通过 |
| 子类和 AI 不确定性藏在编辑/详情里，最终确认也未展示子类 | 审核行及确认列表直接展示子类；未入库行直接显示识别疑点 | 新增可见性测试先失败，修复后相关 2 项通过 |

未改变模型提示词或调用条件；Excel 不自动识别，照片识别仍需明确上传操作。人工清空、已有属性优先、晚到结果保护、逐行事务及确认幂等保持。

## 验证范围与证据

工作区存在另一个任务的 P7.1/P7.2 改动，本轮未混入其未发布文件。先以 `d4378c2` 加本轮补丁冻结到忽略目录 `data/acceptance/import-audit/snapshot` 验证：

- 后端完整 **258 项通过**（316.10 秒）；Ruff 和 mypy（112 个源文件）通过。
- 前端完整 **78 项通过**；类型检查、格式检查和构建通过。
- Docker 隔离项目 `wardrobe-import-regression`，仅 Fake Provider、内部网络、独立数据库及媒体卷；真实去背景处理保留。
- 新增三组浏览器场景，连同原导入资料流程，桌面和 320×568 模拟手机共 **8 项通过**。覆盖实际照片上传、分类调整、子类确认、提交已成功但响应丢失后的同键恢复；实际 Excel 上传、金额展示、错误重置、公式结构错误阻塞；生命周期与盘点衔接。
- 运行中的 P7.2 在本轮期间完成发布，因此改以其冻结发布源叠加本轮六个业务文件。后端只差本轮两个文件；前端只差本轮三个修改文件及一个新文件，发布清单摘要比对通过。
- 最终 P7.2 合并候选后端导入/识别/恢复/轮换相关 **78 项通过**（59.74 秒），前端镜像类型检查与构建通过；完整浏览器流程再次 **8 项通过**（47.0 秒）。这 78 项是发布候选定向回归，不冒充该候选的后端全套。
- 部署后只读 UI **8 项通过**（13.8 秒），所有 API 写入被拦截或在浏览器中模拟；未向正式衣橱导入测试数据。
- 最后文档检查通过（101 份 Markdown、534 个本地链接），结构检查通过（370 个手写文件），`git diff --check` 通过；计数包含工作区并行任务的文件。

主要实际命令（仓库根运行 Docker；前端命令在对应冻结源的 frontend 目录运行）：

```sh
docker compose -f scripts/compose.import-regression.json -f data/acceptance/import-audit/test.json run --rm test pytest -q
npm test
npm run typecheck
npm run format:check
npm run build
IMPORT_ISOLATED_REGRESSION=1 E2E_BASE_URL=http://localhost:8100 npx playwright test -c playwright.import.config.ts
```

最终合并候选使用 `release-test.json`，执行以下定向测试：

```sh
docker compose -f scripts/compose.import-regression.json -f data/acceptance/import-audit/release-test.json run --rm test pytest -q tests/test_imports.py tests/test_import_details.py tests/test_import_excel_details.py tests/test_import_recovery.py tests/test_import_review_audit.py tests/test_import_money_audit.py tests/test_recognition_provider.py tests/test_recognition_subtypes.py tests/test_recognition_calls.py tests/test_recognition_recovery.py tests/test_rotation.py tests/test_rotation_domain.py
```

日志在忽略目录 `data/acceptance/import-audit/`：`01`～`04` 的 before/after 日志、`backend-final.log`、`frontend-all.log`、`release-tests.log`、`browser-release.log`、`deployed-ui.log`。截图保存在冻结源的 `data/acceptance/import-organization/browser-results/`；已检查手机截图，窄屏无横向溢出断言通过。

## 验证中发现的环境与用例问题

- 初轮全套及浏览器运行受并行去背景进程线程争用影响中断/超时，不记为通过。只停止本轮自己的进程，在导入隔离 Compose 为测试及 worker 设置 `OMP_NUM_THREADS=1`，保留真实去背景步骤并完整重跑。浏览器等待实际任务终态的上限调整为 120 秒，场景上限为 240 秒。
- 新增测试衣服原先属于上装，影响原盘点场景“待核对为零”的前置假设。改用鞋类合成数据，并新建隔离测试数据库重跑；未放松原断言，未清空正式或原测试数据库。
- 无真实千问调用；本轮验证的是系统流程与恢复，上一轮真实模型质量证据仍见 [子类验收](2026-10-30-recognition-subtypes.md)。浏览器模拟不能代表真机 HEIC、系统文件选择器或所有 Excel 软件导出的兼容性。

## 部署与数据保持

以已发布 P7.2 源码叠加本轮补丁，构建 `wardrobe-import-audit-backend:local` 和 `wardrobe-import-audit-release-web:local`；仅更新 API、worker、controller、web，未重建数据库或执行数据迁移。数据库版本仍为 `0011_manual_outfits`，备份兼容版本保持 P7.2 的 `0.7.2-rotation`。

更新前确认无活动任务，并只读导出表及媒体摘要。更新前后 **35 张业务表和 429 个媒体文件摘要完全一致**。部署四项服务正常，实际运行补丁文件摘要与候选一致，原 P7.2 功能保持；未提交 Git。本轮隔离验收栈已停止，数据卷保留。

本轮没有遗留阻断项。后续按真实使用反馈继续补样本；不把未执行的真机及外部服务场景写成通过。

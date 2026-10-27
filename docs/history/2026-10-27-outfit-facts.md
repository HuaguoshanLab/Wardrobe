# 搭配事实说明修复

日期：2026-10-27。依据用户明确要求，修复 v3 仍将空场合鞋描述为日常的问题。

- 模型负责组合与审美方向，后端从最终 ItemSnapshot 渲染记录事实与未知值；名称不能推导属性。审美方向仅三个枚举，固定措辞明确为主观尝试。
- 模型 reason/message/unmet_requirements 不直接展示；未满足条件由领域规则重新计算，总结/澄清/无结果由后端模板生成。未拥有建议只展示品类和属性待确认。
- 提示版本 outfits-v4，新增快照 request_snapshot.explanation_version=facts-v1；公开 API 结构与数据库无变化，无迁移。原始账本保留，旧历史不回填。未提交的旧响应可复用并经新规则展示。
- 自由文本需求、版型、舒适性、精确适温及批次归属无法自动证明满足；未拥有建议的精细自由文本信息有所收敛。保留的旧非目标建议随原快照保持不变。

验证：

- `docker compose --profile test run --build --rm test`：115 passed，30.63 秒，独立 wardrobe_test/Fake，无真实服务调用。覆盖错误事实不进入新快照/消息/条件、原始回执不改写、受限审美、逐单品未知，以及既有替换保持/历史图片/幂等/检查点恢复回归。
- backend 目录 Ruff check、format、mypy app 通过（75 个源文件）；OpenAPI 重新导出无差异。
- `scripts/check_structure.py`：153 手写文件通过；`scripts/check_docs.py`：38 Markdown、219 本地链接通过；`git diff --check` 通过。
- 本轮最初从根目录执行 mypy 未读取 backend 配置，另发现 Sequence 类型问题；修正类型后从 backend 目录执行通过。没有关闭类型检查。

未新增真实千问调用；下一步可在明确真实调用预算后复验。

部署：`docker compose build api` 与 `docker compose up -d --no-deps --wait api worker controller` 成功，运行版本 outfits-v4/facts-v1。部署前活动任务为0；部署后77个历史快照、111条媒体元数据摘要及12条识别/50条搭配调用记录、迁移记录与部署前完全一致。没有真实调用或新业务快照。隔离 test-db 已停止。本轮改动尚未提交 Git。

后续：[v4真实复验](2026-10-27-outfit-v4-acceptance.md)通过，修复与验收记录一并纳入本次提交。

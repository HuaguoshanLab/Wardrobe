# 2026-10-29 · Langfuse 正文采集启用

用户要求开启输入输出采集并再执行一次查看效果。

## 已完成

- 修改本地忽略文件 `.env.langfuse-worker`：`WARDROBE_LANGFUSE_CAPTURE_TEXT=true`，保持文件权限 0600，凭据不改动、不进入 Git。
- 检查 worker 采集原值为 false、活跃 queued/running 任务为 0 后，执行 `docker compose up -d --no-deps worker` 加载配置。
- 在 worker 内执行一次真实 `qwen.outfits` 调用，无自动重试；使用已有成功任务候选上下文的只读快照及明确的示例输入。未创建 Job、搭配版本或调用账本记录，不作为完整业务链验收。
- 新进程确认采集开关为 true；模型结果通过 `ModelOutfits` schema 校验。Langfuse observations API 回读确认唯一 Generation 的 input 与 output 均非空。

## 运行证据

- Trace：`749ec89b842a6b77b23e200e1c709a0c`，名称 `acceptance.text-capture`。
- Generation：`79ce7c94bac4850e`，模型调用数 1，环境 acceptance。
- 输入：“请从提供的衣橱候选中选出一套搭配，优先尝试简洁配色；未知属性保持未知。”
- 回复 347 字符；输入 Token 10,114，输出 167，缓存 0，总计 10,281。
- 人民币标价估算 ¥0.011784，非实际账单。
- 验证命令：`docker compose exec -T -e WARDROBE_LANGFUSE_ENVIRONMENT=acceptance worker python - < /tmp/wardrobe-langfuse-capture.py`；临时验收脚本不作为项目运行入口。

## 限制与下一步

首次启用阶段只修改配置，未修改业务源代码，未重复运行后端全套回归。当时搭配无 message 时 Input 为空，后续修复见下节；照片识别仍不记录图片 Input。正文过滤和 8,000 字符上限保持，图片、完整请求及系统提示词仍不采集；旧记录不会补齐。关闭步骤见 [运行指南](../LANGFUSE.md)。

## 同日补充：按钮生成 Input 修复与应用内验收

用户反馈从应用点击“重新搭配”后 `qwen.outfits` Input 仍为 undefined，要求从应用实际生成并展示完整链。

原因：适配器只采集 `message`，按钮生成没有聊天文字；采集已开启但该字段为空。改为明确标记 `capture_scope=input_summary` 的白名单 JSON 摘要，包含步骤、用户文字、纠错说明、搭配条件、无位置的天气、候选/锁定/基础单品数量和调整意图。它不是完整模型输入，不包含候选详情、完整偏好、图片、精确位置、系统提示词或任意请求字段。采集关闭仍不记录正文；摘要序列化失败也不影响模型请求。

修改 `observability/privacy.py`、`observability/runtime.py` 和 `providers/qwen.py`；补充按钮/聊天、开关开/关、敏感字段排除、请求保持及采集失败隔离测试。

实际验证：

- `backend/.venv/bin/python -m pytest -q tests/test_observability.py tests/test_observability_pricing.py tests/test_observability_providers.py`（在 backend 下使用 `.venv/bin/python`）：26 passed。
- Ruff 检查与格式通过；`mypy app` 80 个源文件通过；结构检查 225 个手写文件通过；文档检查与 `git diff --check` 通过。未重跑全套数据库测试。
- `docker compose build api` 成功；确认无 queued/running 任务后，仅重建 worker 加载新镜像。
- 在浏览器实际打开应用，点击“重新搭配 → 生成搭配”，保持原日常/通勤、秋季等条件且不填写聊天文字。真实 Job `9144d849-df7b-4501-9b5f-09b0ce620e9b` 成功，保存 3 个新 revision；结果为 partial，保留单品属性未知等提醒，不能将任务成功等同所有软条件已满足。刷新后仍展示 3 套方案。
- 业务调用账本仅 1 次 outfits 请求，attempt=0、state=received；无纠错重试。
- Trace `58876a7b6551b73b1169741448fea8ab`，环境 local，8 个 observation：wardrobe.job → worker.execute → prepare / generate（model.attempt → qwen.outfits、validate）/ commit。
- 总耗时 12.958 秒，模型耗时 12.759 秒；输入 10,066 Token，输出 451，缓存 0，总计 10,517；人民币标价估算 ¥0.014576。
- Langfuse API 回读及浏览器确认 `qwen.outfits` Input 非空（22 件候选、0 件锁定、27.05℃等），Output 为模型回复；已展示完整调用树并保存截图。

本次按用户要求实际生成，因此新增业务搭配版本；与前面的“不写业务数据”适配器验收不同。历史 Trace 不回填；未对图片识别、备份或其他进阶功能扩展采集。

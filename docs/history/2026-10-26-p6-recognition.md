# 2026-10-26 · P6 真实照片识别实现

## 变更

- 新增百炼视觉适配、严格识别输出 schema、标准缩略图、不确定性提示与独立识别开关。
- 按任务/行持久化调用，复用响应，未知请求不自动重发；部分行中断仍可审核，显式重试可能再次计费。
- 追加 0006_recognition，更新备份精确兼容版本、能力接口、生成类型及审核页面。原迁移和 outfit_model_calls 保留。
- 运行边界及配置见 [P6 识别](../P6-recognition.md)，决策见 [D-31](../adr/D-31-photo-recognition.md)。

## 验证记录（持续补充）

- 首轮全部后端测试：102 passed，27.60 秒；使用 Docker 独立 wardrobe_test 数据库、当前 app/migrations/tests 只读挂载，无真实服务调用。
- 新增完整模拟 HTTP → 审核与识别账本备份恢复后，识别/备份定向回归 30 passed，9.27 秒。
- 视觉适配单独运行 13 passed，包含缩略图、非法属性、鉴权/限流/超时、无自动重试。
- 首轮前端原 14 项通过；新增配置展示测试首轮 2 项失败，原因是测试响应缺少契约必需的 request_id，已补测试响应，不降低运行校验。
- Ruff/mypy 已执行；最终静态与浏览器结果在下方补充。不将阶段结果当最终完成证据。

## 未验证

真实百炼/和风账号、真机、真实照片及 Excel 客户端、容量上限和磁盘不足仍待验。当前任务补识别实现，不代表 P6 全部完成。

## 最终验证

环境：macOS arm64、Node 24.19.0、Python 3.13、Docker Linux arm64 / PostgreSQL 18.4。无真实账号调用。

| 实际命令 / 检查 | 结果 |
|---|---|
| 根目录 `docker compose --profile test run --rm -v "$PWD/backend/app:/app/app:ro" -v "$PWD/backend/migrations:/app/migrations:ro" -v "$PWD/backend/tests:/app/tests:ro" -e WARDROBE_RECOGNITION_MODE=fake test pytest -q -p no:cacheprovider` | 最终 106 passed，27.90 秒；包括 P1–P5 回归 |
| backend 中 `.venv/bin/ruff check app migrations tests`、`.venv/bin/ruff format --check app migrations tests`、`.venv/bin/mypy app` | 通过；96 个格式文件、73 个类型检查源文件 |
| backend 中 `.venv/bin/python -m app.export_openapi`；frontend 中 `npm run api:generate` | 导出及生成成功，生成文件已更新 |
| frontend 中 `npm test` | 最终 8 文件、17 项通过；三种识别模式展示且不自动上传 |
| frontend 中 `npm run typecheck`、`npm run format:check`、`npm run build` | 全部通过；Docker 亦完成生产构建 |
| `WEB_PORT=8100 DB_PORT=55440 PROVIDER_MODE=fake RECOGNITION_MODE=fake docker compose -p wardrobe-p6-recognition up -d --build --wait` | 独立命名卷栈启动成功 |
| frontend 中 `E2E_BASE_URL=http://localhost:8100 npm run test:e2e` | 14 passed，1.2 分钟；桌面/Pixel 7 Chromium，非手机真机 |
| 独立栈及原应用各自 `docker compose ... exec -T api alembic check` | 均无模型/迁移差异 |
| 结构、文档及 `git diff --check` | 最终结果见交接末尾 |

新增后端证据包含：完整模拟视觉 HTTP 到审核来源；20 行各一次；非法输出拒绝；晚到人工修改/已确认不覆盖；取消保留响应但不改草稿；sent 无响应不重发；真实子进程在调用发送标记持久化后 os._exit(77)，父进程验证租约回收且队列不重新领取；显式同键重试只建一个新 Job；配置漂移拒绝；识别账本/不确定性提示完整备份往返；P5 兼容标识包明确拒绝。HTTP 请求是模拟，子进程退出是真实执行。

已查看手机审核页截图，来源和人工审核提示可见、无布局溢出。最终原应用手机视口仅访问设置页，验证 Fake 识别配置；页面检查未发送 POST/PATCH/DELETE。首次独立脚本未指定项目的 chromium 通道，因未安装 headless-shell 无法启动；改用与项目相同的 channel=chromium 后执行，未安装或更换浏览器版本。

## 原应用升级与数据保护

- 原应用升级前无 queued/running/cancel_requested 任务。在原维护屏障内创建完整 P5 格式备份及原表/全部媒体摘要，持久目录为控制卷内 `/data/control/pre-p6-20261026-recognition/`，包含 backup.zip、database.json、summary.json。
- 停止旧 web/api/worker/controller 后执行 `docker compose up -d --build --wait`，保留数据库及全部命名卷；迁移从 0005_collections 追加至 0006_recognition。没有降级或重写旧迁移，没有执行覆盖恢复。
- 升级后在维护屏障内导出并逐表比较：23 张原表内容摘要一致（包含业务表及检查点表，不含 alembic_version；import_rows 比较时排除新增 analysis_notes）。317 个媒体文件路径/内容摘要完全一致。新账本为空，全部旧行 analysis_notes 为空数组。comparison.json、after-database.json 与升级前证据保存在同一控制目录。
- 原应用健康检查 ready；能力为搭配 fake、识别 fake、天气 unconfigured、本地去背景启用；data_epoch 保留。
- 新建可下载的 P6 格式完整备份，控制任务 `77d494e0-57b7-4bca-bf55-4eec399d20b2` 已 succeeded；下载接口 `/api/v1/backups/77d494e0-57b7-4bca-bf55-4eec399d20b2/download`，有效期沿用七天。
- 浏览器写入测试全部在 8100 隔离栈执行，原 8088 仅只读页面检查及创建备份。新备份/控制记录属于预期新增，不将它们说成控制卷完全未变。

## 交接

原应用继续运行于 8088，默认 Fake。真实识别需显式设置 RECOGNITION_MODE=qwen，并配置后端账户地域地址和凭据；没有调用真实模型或开启自动识别。P5 旧备份保留，但不直接跨版本覆盖新版，具体限制见运行文档。

下一步仍是 P6 外部验收：真实账号及样例、手机、Excel、容量和磁盘不足。本轮源码和文档未提交 Git，也未推送远程。

最终结构检查覆盖 147 个手写文件，最长 330 行；文档检查覆盖 30 份 Markdown、194 个本地链接；git diff --check 通过。P6 独立栈及 test-db 已停止，P6 命名卷保留；原 8088 应用继续运行。

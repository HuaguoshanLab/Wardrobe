# 后端

已有 P1 任务账本/独立 worker/诊断图/Checkpointer，以及 P2 衣橱、媒体、标签、两种导入、逐行确认和步骤重试。P3 天气/偏好与 P4 搭配闭环已实现；真实搭配已有小样本验收，和风账号已有城市/实况/预报小样本验收，详见 [P4](../docs/P4.md)。工作规则见 [AGENTS](AGENTS.md)，实现边界见 [P2](../docs/P2.md)。

## 运行环境

Python 3.13.14、uv 0.12.7、PostgreSQL 18.4；精确依赖以 uv.lock 为准。默认使用 Compose 的独立数据库，监听本机 55438，数据库名 wardrobe。

先在项目根目录启动数据库：

```sh
docker compose up -d db
```

然后在 backend 目录：

```sh
uv sync --locked
uv run python -m app.initialize
WARDROBE_PROVIDER_MODE=fake WARDROBE_RECOGNITION_MODE=fake uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

另一终端同样在 backend 目录启动 worker：

```sh
WARDROBE_PROVIDER_MODE=fake WARDROBE_RECOGNITION_MODE=fake uv run python -m app.jobs.worker
```

开发期间若已运行 Compose worker，先执行 docker compose stop worker，避免两个 worker 共享测试观察结果；队列仍支持安全的多消费者领取。修改数据库端口/凭据后用 WARDROBE_DATABASE_URL 显式传入 SQLAlchemy psycopg URL，不把真实值写入版本库。

图片端到端优先使用 Compose。纯本机开发的 API、worker、initialize 必须使用同一个 WARDROBE_MEDIA_ROOT（默认项目 data/media）和对应的开发数据库；不能连接已有 Docker 数据库，却把媒体指向另一个空目录。Docker 命名媒体卷不会自动映射到宿主机 data/media。若混合调试，须先统一共享媒体路径或使用独立数据库，不能以丢图为代价混用两套存储。

## 迁移与检查点

```sh
uv run python -m app.initialize
uv run alembic current
uv run alembic check
```

initialize 顺序执行 Alembic upgrade head、Checkpointer setup 和一次性示例播种，可重复执行。业务迁移位于 migrations/，检查点使用独立 checkpoints schema。不要在 API/worker 普通启动时执行 setup 或 create_all。

新增业务迁移时同步就绪检查的 revision 判定；已执行迁移不能直接改写。当前 head 为 0013_condition_templates；模板及当前备份兼容约定见 [P7.7](../docs/P7-7.md)；穿后反馈及备份约定见 [P7.3](../docs/P7-3.md)；手动来源及原子穿着提交、旧版本兼容和恢复限制见 [P7.1](../docs/P7-1.md)；W4 追加整理会话、核对与动作回执，恢复和总结约定见 [W4](../docs/W4.md)；W3 追加补充计划、来源、核销关联和整理决定，跨季退出确认及备份约定见 [W3](../docs/W3.md)；W2 追加季节目标、需求行与子类启用状态，统计/影响/备份约定见 [W2](../docs/W2.md)；W1 生命周期见 [W1](../docs/W1.md)；P6 识别账本和不确定性提示保留；既有迁移、快照和调用记录保留。

## 验证

```sh
uv run ruff check app migrations tests
uv run ruff format --check app migrations tests
uv run mypy app
uv run pytest -q -m 'not integration'
uv run python -m app.export_openapi
```

数据库集成测试从项目根目录执行：

```sh
docker compose --profile test run --build --rm test
```

使用独立测试服务和 wardrobe_test 数据库。测试夹具同时要求 WARDROBE_TEST_DATABASE=1 与数据库名以 _test 结尾才允许初始化/清理；不会清理正常 wardrobe 数据库。没有该显式配置时集成测试跳过，不可称为集成通过。

结构及文档检查、HTTP 冒烟验证（从项目根目录）：

```sh
backend/.venv/bin/python scripts/check_structure.py
backend/.venv/bin/python scripts/check_docs.py
backend/.venv/bin/python scripts/smoke.py
```

故障注入使用 scripts/smoke.py --faults，会强制终止本项目 worker 并重启本项目 db/api/worker；仅在没有真实业务工作的开发环境运行。HTTP 脚本显式绕过系统代理以访问本地服务。

## 模块与配置

- app/api：HTTP/SSE；app/schemas：跨端协议。
- app/services/jobs：幂等与用户任务操作；app/jobs：领取、租约、终态、worker。
- app/agent：诊断图和检查点连接；app/providers/fake：明确的模拟响应。
- app/db：SQLAlchemy 模型和连接；app/core：配置、公共错误。
- app/media：存储、解码/去背景、Excel；app/domain/taxonomy：词表；app/services：衣橱/审核业务；app/jobs/imports：后台步骤。路由不承担衣橱查询与标签维护事务。
- WARDROBE_MEDIA_ROOT：媒体根；WARDROBE_CUTOUT_ENABLED 默认 true。Compose 挂载 /data/media；构建内置 u2netp，纯本机首次调用可能下载模型。图片并发默认 1。
- WARDROBE_PROVIDER_MODE 缺省 disabled；Compose 明确传 fake，只有该模式才接收诊断任务。
- WARDROBE_LEASE_SECONDS 默认 30；WARDROBE_POLL_SECONDS 默认 0.5；WARDROBE_EVENT_RETENTION_DAYS 默认 7。需按上下文调整并保持测试。
- Docker 开启 LANGGRAPH_STRICT_MSGPACK=true；检查点只保存基础类型和 ID，不保存秘密或运行对象。

P3 服务为 app/services/profile.py、weather.py；适配器 app/providers/qweather.py。配置 WARDROBE_QWEATHER_HOST、WARDROBE_QWEATHER_API_KEY 或 WARDROBE_QWEATHER_TOKEN，详见 [P3](../docs/P3.md)。无凭据只提供手动流程，不自动 Fake 天气。

真实百炼搭配适配已实现，outfits-v4 使用后端事实说明与受限审美建议，保留旧任务提示版本检查；配置、验证限制与重试边界见 P4。真实照片识别已完成 PNG 小样本账号验收，质量问题与剩余验收见开发记录；独立配置 WARDROBE_RECOGNITION_MODE，默认 disabled。模型输出词表代码约束和验收证据见 [P6 识别](../docs/P6-recognition.md)。P5 维护态及独立 controller 已实现。去背景已为本地真实处理；Fake 仅用于诊断/属性识别。队列说明见 [P1](../docs/P1.md)，P2 锁定的媒体依赖与失败边界见 [P2](../docs/P2.md)。P5 历史、收藏、穿着记录及备份恢复已实现，格式和运行限制见 [P5](../docs/P5.md)。

## Langfuse 观测

可选 SDK 与 worker 埋点已加入，搭配/识别请求直接通过 HTTPX，模型观测由适配器显式记录。关闭时保持原业务流程；配置、独立部署和费用口径见 [LANGFUSE](../docs/LANGFUSE.md)，部署和验证证据见 [本轮记录](../docs/history/2026-10-28-langfuse.md)。

2026-10-29：开启文本采集后的搭配 Input 使用白名单摘要，覆盖没有聊天文字的按钮生成；观测测试及应用内完整生成验证见 [正文采集记录](../docs/history/2026-10-29-langfuse-capture.md)。

## P5 控制器

本机开发另开终端运行 `uv run python -m app.backup.worker`。API、worker、controller 必须共享 WARDROBE_CONTROL_ROOT、媒体根和数据库；Compose 已挂载 control_data。备份控制记录独立于业务库，验证需要 CREATEDB 权限。不可把生产库当恢复测试目标；隔离命令及证据见 [P5 记录](../docs/history/2026-10-26-p5.md)。

2026-10-27：修复和风分区子域Host校验，实际验收与缓存/失败降级边界见[和风验收](../docs/history/2026-10-27-qweather.md)。

P6 当前版本逐项回归使用 [独立回归 Compose](../scripts/compose.regression.json) 的 `regression_suite_test` 数据库；与浏览器使用的 `regression_test` 和业务库均隔离。新增精确场景见 `tests/test_p6_acceptance.py`，运行命令及证据见[回归记录](../docs/history/2026-10-27-p6-regression.md)。Fake/模拟 HTTP 通过不代表外部服务与真机通过。

2026-10-30：真实千问子类识别已逐项修复并部署 garment-vision-v5；8 张最终版复验、44 项定向测试与数据保留证据见 [子类真实验收](../docs/history/2026-10-30-recognition-subtypes.md)。

2026-10-30：导入全流程检查修复改品类残留子类和金额响应格式，补充审核纠错与完整浏览器流程。冻结导入基线后端 258 项、叠加 P7.2 的发布候选相关 78 项通过；实际隔离命令、前端验证和部署数据保留证据见 [流程检查记录](../docs/history/2026-10-30-import-flow-audit.md)。

P7.2 穿搭轮换已实现：模式、实际记录统计、任务冻结、结果依据与兼容规则见 [P7.2](../docs/P7-2.md)，当前验证部署状态见 [开发记录](../docs/history/2026-10-30-p7-2.md)。

P7.3：穿后反馈、父记录锁/幂等、迁移 `0012_wear_feedback` 及备份兼容见 [P7.3](../docs/P7-3.md)。独立验证配置为 `scripts/compose.p7-3.json`（项目 wardrobe-p7-3，8103），测试数据库与浏览器及正式数据库分离；实际证据见 [阶段记录](../docs/history/2026-10-30-p7-3.md)。

P7.4：`GET /wardrobe/usage` 只读完整聚合与分页，W1 共用去重逻辑；指定单品在显式生成时创建初始锁定，旧回执保持兼容。无新增迁移，协议和验证见 [P7.4](../docs/P7-4.md)。独立栈 `scripts/compose.p7-4.json` 使用 8104 与 Fake Provider，业务浏览器和 pytest 数据库相互隔离。

P7.5：`GET /wardrobe/care` 提供洗衣/可穿/全部清单；`POST /wardrobe/care/actions` 组合 W1 和基础属性校验，最多 20 件、逐项结果及整批/单项幂等回执，无新增迁移。契约与保留数据发布证据见 [P7.5](../docs/P7-5.md)。隔离测试使用 `docker compose -f scripts/compose.p7-5.json run --rm test pytest -q`（在根目录运行；先启动独立 db 并建立 `regression_suite_test`）。

P7.6：`GET /wardrobe/locations` 提供完整位置聚合、字面搜索及分页；`GET /garments` 支持位置精确/未填写/全部真实范围。W1 显式保存位置才去首尾空白，无新表或迁移。契约见 [P7.6](../docs/P7-6.md)。独立 Fake 栈 `scripts/compose.p7-6.json` 使用 8106，pytest 使用 `regression_suite_test`；与 P7.5 相同的启动步骤替换 Compose 文件即可。

P7.7：常用条件模板独立持久化，提供版本和幂等增删改、失效引用提示及完整备份恢复。行为见 [P7.7](../docs/P7-7.md)。独立 Fake 栈 `scripts/compose.p7-7.json` 使用 8107，pytest 使用 `regression_suite_test`；沿用 P7.5 启动步骤并替换 Compose 文件。新迁移仅新增模板表，旧版备份须由匹配的旧应用恢复。

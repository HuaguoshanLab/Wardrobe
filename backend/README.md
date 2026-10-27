# 后端

已有 P1 任务账本/独立 worker/诊断图/Checkpointer，以及 P2 衣橱、媒体、标签、两种导入、逐行确认和步骤重试。P3 天气/偏好与 P4 搭配闭环已实现；真实搭配及和风账号未验，详见 [P4](../docs/P4.md)。工作规则见 [AGENTS](AGENTS.md)，实现边界见 [P2](../docs/P2.md)。

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

新增业务迁移时同步就绪检查的 revision 判定；已执行迁移不能直接改写。当前 head 为 0006_recognition，P6 追加识别账本和不确定性提示；既有迁移、快照和调用记录保留。

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

真实百炼搭配适配已实现；配置与重试边界见 P4。真实照片识别已完成 PNG 小样本账号验收，质量问题与剩余验收见开发记录；独立配置 WARDROBE_RECOGNITION_MODE，默认 disabled。模型输出词表代码约束和验收证据见 [P6 识别](../docs/P6-recognition.md)。P5 维护态及独立 controller 已实现。去背景已为本地真实处理；Fake 仅用于诊断/属性识别。队列说明见 [P1](../docs/P1.md)，P2 锁定的媒体依赖与失败边界见 [P2](../docs/P2.md)。P5 历史、收藏、穿着记录及备份恢复已实现，格式和运行限制见 [P5](../docs/P5.md)。

## P5 控制器

本机开发另开终端运行 `uv run python -m app.backup.worker`。API、worker、controller 必须共享 WARDROBE_CONTROL_ROOT、媒体根和数据库；Compose 已挂载 control_data。备份控制记录独立于业务库，验证需要 CREATEDB 权限。不可把生产库当恢复测试目标；隔离命令及证据见 [P5 记录](../docs/history/2026-10-26-p5.md)。

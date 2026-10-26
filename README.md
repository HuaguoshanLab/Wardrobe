# Wardrobe · 个人衣橱与 AI 穿搭

记录自己的衣服、鞋和配饰，根据天气、场合及个人偏好生成最多三套搭配，并通过按钮或聊天调整。

> 当前状态：P2 衣橱与两种导入入口已实现。支持图片转换、本地去背景、逐行审核、编辑筛选和删除。属性识别仍为显式 Fake 或人工填写；真实千问、天气、搭配及备份未实现。外部样例验收边界见 [P2](docs/P2.md)。

## 已确定的产品

- 单人使用，Docker 在电脑本地运行；安卓 Chrome、iPhone iOS 18 Safari 访问，暂不适配微信。
- 首页“今日穿搭”，点击才生成，刷新恢复已有结果。衣橱管理有独立入口。
- 两条录入入口：固定模板 Excel（图片和标签同文件）；批量照片经 AI 预填后表格审核。两者都需用户确认才入库。
- 图片和品类必填，其他属性允许未知；默认可穿。预设属性与自定义标签并存。
- 保留原始照片，转换展示格式并生成去背景图，支持切回原图。
- 搭配支持锁定、局部替换、历史、收藏和实际穿着日历，历史保存快照。
- 和风天气：能定位则定位，否则手动选城市；第一版仅中国大陆，HTTPS 后续配置。
- 提供手动备份恢复；一个可删除的示例单品用于初次体验。

完整需求与验收场景以 [PRODUCT](docs/PRODUCT.md) 为准。

## 文档导航

| 文件 | 维护职责 |
|---|---|
| [AGENTS.md](AGENTS.md) | 全项目 AI 工作规则、读取顺序和质量要求 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 技术栈、模块边界、数据模型和工作流 |
| [docs/PRODUCT.md](docs/PRODUCT.md) | 用户已确定的行为、范围及验收标准 |
| [docs/CONTRACTS.md](docs/CONTRACTS.md) | API、SSE、数据字段及 Excel 模板设计约定 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发阶段、完成标准、实际进度与接续入口 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 关键决策、工程默认和待验证项 |
| [docs/REVIEW.md](docs/REVIEW.md) | 文档审查结果、需求覆盖及实现前验证门槛 |
| [docs/P1.md](docs/P1.md) | 基础工程交付、队列决策、运行边界与验证证据 |
| [docs/P2.md](docs/P2.md) | 衣橱/导入实现、媒体存储、重试边界与未验证项 |
| [frontend/README.md](frontend/README.md) | 前端职责、计划结构与运行状态 |
| [backend/README.md](backend/README.md) | 后端职责、计划结构与运行状态 |

## 目录

```text
Wardrobe/
├── AGENTS.md
├── README.md
├── ARCHITECTURE.md
├── docs/
│   ├── PRODUCT.md
│   ├── CONTRACTS.md
│   ├── DEVELOPMENT.md
│   ├── DECISIONS.md
│   ├── REVIEW.md
│   ├── P1.md
│   └── P2.md
├── compose.yaml
├── .env.example
├── scripts/                 # 结构、文档及 HTTP 故障验证
├── frontend/
│   ├── AGENTS.md
│   ├── README.md
│   ├── package.json / package-lock.json
│   ├── src/ / e2e/
│   └── Dockerfile
└── backend/
    ├── AGENTS.md
    ├── README.md
    ├── pyproject.toml / uv.lock
    ├── app/ / migrations/ / tests/
    └── Dockerfile
```

数据库使用 `wardrobe_postgres_data`，图片及导入原件使用 `wardrobe_media_data` Docker 卷。目录树中的并列项用于概览，实际为独立文件/目录。

## 技术与运行

技术栈的唯一完整清单见 [ARCHITECTURE](ARCHITECTURE.md)。前端为 React、Node 24 LTS；后端为 Python、FastAPI、LangGraph；数据库为 PostgreSQL，配套 Alembic 与 PostgreSQL Checkpointer。

在项目根目录执行（需 Docker 已启动，支持 Compose；首次构建需下载图像依赖和去背景权重）：

```sh
docker compose up -d --build --wait
docker compose ps
```

打开 [本地应用](http://localhost:8088)；API 文档在 [Swagger](http://localhost:8088/api/v1/docs)。进入“我的衣橱 → 录入衣服”使用照片或 Excel 导入；“设置 → 运行模拟任务”验证持久化与事件。启动使用显式 `PROVIDER_MODE=fake`，模拟诊断与照片属性预填，不接入真实千问。

默认无需 `.env`。要修改端口或本地配置，首次复制 `.env.example` 为 `.env`（不要覆盖已有文件），再修改；Web 默认 `8088`，PostgreSQL 仅监听本机 `55438`。默认数据库密码只用于本机开发；若改密码，URL 中需使用可安全嵌入的值，已有数据库卷的密码不会随环境变量自动修改。

Compose 自动按数据库健康 → 单次迁移/Checkpointer 初始化 → API/worker → Web 顺序启动。手动重新执行初始化：

```sh
docker compose run --rm migrate
docker compose logs --tail=100 api worker
docker compose stop
```

`stop` 保留数据，重新执行启动命令即可恢复。`docker compose down` 删除容器但保留命名卷；不要加 `-v`，那会删除数据库和图片。完整业务备份恢复属于 P5，目前没有可用备份入口。

验证命令：

```sh
docker compose --profile test run --build --rm test
```

该命令只访问独立的 `wardrobe_test` 数据库，使用临时内存盘，不清理应用数据。前端测试及本地热更新命令见 [前端 README](frontend/README.md)，后端开发命令见 [后端 README](backend/README.md)。

真实服务接入时再配置百炼地域、API Host、模型凭据及和风天气凭据。当前未实现真实适配器，不需要填写密钥。设置 `PROVIDER_MODE=disabled` 后诊断提交返回未配置错误，照片仍可转换并手工审核，不自动切回 Fake。`CUTOUT_ENABLED=false` 可禁用去背景，原图仍可使用。

手机通过电脑局域网 HTTP 访问时可能无法定位；P3 将提供手动城市流程，当前尚无定位/天气操作。电脑 localhost 或未来可信 HTTPS 环境可尝试定位。真实天气与云端 AI 接入后仍需网络，本地部署不代表可以离线使用这些服务。

## AI 接续开发

先读 [AGENTS](AGENTS.md)，再从 [DEVELOPMENT](docs/DEVELOPMENT.md) 的“下一任务”继续。文档中的“已确认需求”“工程默认”“待验证”和“已实现”必须区分。切勿重新引入已经取消的 CSV 导入、默认自动生成或自动偏好学习。

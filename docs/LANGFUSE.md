# Langfuse 观测与运行

本轮范围：本地自托管、搭配/调整/照片识别追踪、Token 与费用估算、故障隔离。用户于 2026-10-28 确认接入；不包含提示词托管、自动评分或模型评测。实际验证结果见 [开发记录](history/2026-10-28-langfuse.md)。

## 部署

固定服务端 4.71.0、Python SDK 5.0.4。`compose.langfuse.yaml` 的六个镜像均固定摘要，已核实 ARM64 清单。独立 Compose 项目 `wardrobe-langfuse`，使用自己的 PostgreSQL 17、ClickHouse、Redis、MinIO、Web 和 worker，不连接衣橱数据库。版本依据见 [官方兼容表](https://langfuse.com/docs/compatibility)。

首次从项目根目录执行（以下脚本拒绝覆盖现有配置）：

```sh
python3 scripts/setup_langfuse.py
docker compose --env-file .env.langfuse -f compose.langfuse.yaml up -d --wait
docker compose build api
docker compose up -d --no-deps worker
```

- 管理入口：`http://localhost:3006`，仅绑定本机。管理员用户名、密码分别是 `.env.langfuse` 中的 `LF_ADMIN_EMAIL`、`LF_ADMIN_PASSWORD`；不输出到日志或提交 Git。
- 初始化项目 ID 为 `wardrobe-local`。关闭公开注册和平台遥测，不给 Langfuse 配置模型密钥或启用自动 AI 评估。
- `.env.langfuse` 仅供观测栈，`.env.langfuse-worker` 仅含应用侧观测配置；均以 0600 创建并被 Git 忽略。已有 `.env`、百炼/天气密钥不改动。
- 普通 `docker compose up` 会让业务 worker 读取可选的 `.env.langfuse-worker`；没有此文件默认不启用观测。其他业务容器不获得 Langfuse 凭据。
- 容器内地址为 `http://host.docker.internal:3006`；纯宿主机开发改为 `http://localhost:3006`。不要使用容器自身的 localhost 指向宿主机。
- Langfuse 容器配置总内存上限约 5.75 GiB，这是保护上限而非最低需求或实际占用保证。日志轮转为每容器 3 × 10 MiB；实际运行占用见开发记录。

日常检查、停止与保留数据：

```sh
docker compose --env-file .env.langfuse -f compose.langfuse.yaml ps
docker compose --env-file .env.langfuse -f compose.langfuse.yaml stop
```

业务容器不依赖观测栈健康。关闭观测：在 `.env.langfuse-worker` 设置 `WARDROBE_LANGFUSE_ENABLED=false`，再执行 `docker compose up -d --no-deps worker`。配置变更需要重建容器环境；仅 `restart` 不会重新读取 env_file。

## 配置

以下配置只存在后端/worker，不能注入前端构建：

| 配置 | 默认与含义 |
|---|---|
| `WARDROBE_LANGFUSE_ENABLED` | false；显式启用 |
| `WARDROBE_LANGFUSE_BASE_URL` | 空；必须明确配置，不自动回退到云端 |
| `WARDROBE_LANGFUSE_PUBLIC_KEY` / `SECRET_KEY` | 项目级凭据 |
| `WARDROBE_LANGFUSE_ENVIRONMENT` | local；验收使用 acceptance，自动化使用 test |
| `WARDROBE_LANGFUSE_CAPTURE_TEXT` | false；开启后仅采集有界、过滤后的用户调整文本和模型回复文本 |
| `WARDROBE_LANGFUSE_PRICE_PROFILE` | disabled；初始化本地配置选择 `bailian_beijing_20261028` |
| `WARDROBE_LANGFUSE_CNY_PER_USD` | 未配置；明确提供换算率后才写原生美元 cost_details |

关闭输入输出全文采集时仍记录 Token、耗时、提示词版本、错误码和允许的结构化摘要。不序列化整个函数参数、图状态、HTTP 请求体或异常堆栈。原图、Base64、精确定位、租约令牌、密钥不进入观测载荷。调试文本并非匿名化保证；开启前需确认允许记录用户自由文本，不应将任意敏感文本当安全数据。

## 链路与恢复

- 从 `job_id` 确定性派生 Trace ID；Job 的 `run_id` 语义不变。每次 worker 执行有独立子步骤。同一搭配 `session_id` 用于会话聚合，导入通过 `batch_id`、`row_id` 关联。
- 搭配记录 prepare、generate、intent/模型请求、validate、commit；无效结果和有限纠错分别可见。照片识别记录对应导入行、模型请求和人工字段保护合并数量。
- Generation 只用于真实模型请求；Fake 是明确标注的普通步骤。账本复用记录 `response_reused`，不增加 Generation 和 Token。
- 根任务状态读取业务 Job 最终状态；导入部分失败显示警告，中断/失败显示错误。模型 HTTP 成功不等于结构校验或业务任务成功。
- 图节点及 provider 采用显式埋点，不依赖 LangChain 自动参数捕获。观测模块不反向依赖业务数据库。
- SDK 后台批量上报，异常不改变业务结果、不触发模型重试；正常停止时限时等待 SDK 退出。进程强杀、网络故障和队列溢出都可能丢观测数据。业务账本仍是恢复、预算和调用状态依据，不承诺观测恰好一次或强杀后补齐。
- 观测开关关闭时，不增加任务元信息数据库读取。

## 用量与费用

实际 API `usage` 为来源，缺失保持未知；非法 JSON 正文仍保留已经收到的用量。缓存命中数从输入 Token 中拆出，避免双计。超时结果未知时，不能据“无 Token 记录”断言未计费。

`bailian_beijing_20261028` 仅适用于核验的北京服务端地址和 `qwen3-vl-plus` 同步调用，按输入总量分档（含缓存）：

| 输入量 | 输入人民币/百万 Token | 输出人民币/百万 Token |
|---|---|---|
| ≤32K | 1 | 10 |
| ≤128K | 1.5 | 15 |
| ≤256K | 3 | 30 |

隐式缓存命中部分按对应输入单价的 20% 估算。来源：[百炼价格](https://help.aliyun.com/zh/model-studio/model-pricing)、[缓存计费](https://help.aliyun.com/zh/model-studio/context-cache)，核验日 2026-10-28。价格变化需增加明确的新价格版本；不假设账户免费额度、优惠或实际账单。

- 人民币估算在 observation metadata 的 `estimated_cost_cny`，并记录 `price_profile` 和 `cost_status`。
- Langfuse 原生 Cost 是 USD。未设明确汇率时不写美元成本；平台可能按内置模型表推断美元数值，该值不作为本项目费用依据。需用原生美元统计时先设 `WARDROBE_LANGFUSE_CNY_PER_USD`，每条记录同时保留换算率。
- 未知地域、未配置价格或缺失输入/输出用量时不生成人民币估算；零值与未知区分。

## 数据保留与备份

初始化请求项目保留 30 天观测数据；平台保留机制的实际执行情况需在运行中检查，不能据配置承诺硬磁盘限额。ClickHouse、MinIO、Redis 和 PostgreSQL 独立占用磁盘，需要监控。

现有衣橱备份不包含 Langfuse 数据、管理员密码、加密密钥或项目密钥。Langfuse 历史不承担业务恢复职责。本轮没有实现它的自动备份；如需保留历史，停止整个独立栈后成组保存其命名卷和秘密配置，再按相同版本恢复，不能只备份 PostgreSQL。不要执行 `down -v` 清空观测卷，更不要操作衣橱业务卷。

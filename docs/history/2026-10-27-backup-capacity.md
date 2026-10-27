# 2026-10-27 · P6 隔离容量与备份恢复验收

## 环境与隔离

基线提交 `ae5fee34e877cada5560529053cff0f25037b5e9`，开始时 `git status --short` 无输出。本轮新增验收脚本、存储故障测试及文档，不修改应用实现、不部署业务服务。

- 业务项目 `wardrobe` 保持运行，Web 8088、PostgreSQL 55438；实际挂载为 `wardrobe_postgres_data`、`wardrobe_media_data`、`wardrobe_control_data`。
- 全新项目 `wardrobe-p6-capacity`，数据库 `capacity_test`、仅本机端口 55440；实际挂载三个 `wardrobe-p6-capacity_*_data` 卷，逐个检查 Docker Mounts，无业务卷或旧 P5/P6 验收卷复用。
- 独立配置不继承主 Compose 或 `.env`。Fake 识别/搭配，无云端凭据；本轮没有真实模型或天气调用。仅运行数据库和验收 runner，HTTP 探针在 runner 内临时启动 127.0.0.1:18000 API，无业务 worker/controller 参与。
- Docker Linux arm64、PostgreSQL 18.4、迁移 `0006_recognition`；复用已有 `wardrobe-test:latest` 依赖镜像，挂载当前 app/tests 只读。Docker 总内存约 7.82 GiB，runner 上限 3 GiB；宿主开始可用约 46 GiB，容器文件系统过程中仍有 28 GiB 以上余量。未填满任何真实磁盘。
- 原始证据保存在忽略目录 `data/acceptance/p6-capacity/`：配置、运行日志、业务前后摘要及每档结果 JSON。控制令牌和原始业务内容不进入版本库。

## 合成负载结果

固定随机种子 `20261027`，生成 512×512 RGB 随机噪声 PNG，均由 Pillow 编码为有效图片。每件一张独立文件，原件/展示引用同一文件；这不是用户真实照片或三份衍生图的规模代表。UUID 随机、像素内容按种子生成，各档额外保留一件内置示例。

| 衣服数 | ZIP 字节数 | 导出秒 | 隔离验证秒 | 确认恢复秒 | 主验收进程峰值 RSS |
|---|---:|---:|---:|---:|---:|
| 20 | 15,008,560 | 0.205 | 0.886 | 0.704 | 88.4 MiB |
| 500 | 393,921,073 | 1.872 | 1.984 | 4.634 | 93.0 MiB |
| 2,700 | 2,130,604,946 | 17.740 | 41.412 | 80.220 | 111.7 MiB |

三档通过真实数据库导出、ZIP 清单/逐文件 SHA-256、临时 PostgreSQL 建库/迁移/试导入、确认令牌与同键幂等、恢复点、数据库切换、新世代及维护态解除。恢复前后逐表规范化摘要一致（系统世代表单独验证世代改变），所有引用媒体逐个与清单哈希相符。容量数据没有历史/收藏/调用记录；这些业务关系由下述备份回归另外覆盖，不能把空表哈希当作大规模历史证据。

前三档上传阶段是磁盘复制，分别 0.022 / 0.196 / 33.340 秒，不作为 HTTP 上传性能。随后独立执行 **2,130,604,946 字节真实 HTTP multipart 流式上传**：16.071 秒（包含临时 API 启动），返回 202；后续隔离验证 12.498 秒，状态 ready、2,700 件和 2,701 个媒体文件。探针不经过 Nginx、手机或局域网；冷热缓存使重复测量存在明显差异，不能推导稳定吞吐或性能 SLA。

近上限导出和 apply 的维护窗口分别不超过对应调用耗时 17.740 / 80.220 秒。`ru_maxrss` 只统计主 Python 进程，不是全容器或 PostgreSQL 的精确峰值。容器文件系统占用采样从小样本结束约 22.98 GiB 到近上限结束约 36.92 GiB；这包含媒体、备份、两次验证解包和恢复点，且是共享文件系统采样，并非精确卷峰值。本轮脚本在摘要通过后清理自己生成的包/解包副本，保留结果 JSON 和控制状态；应用本身仍没有自动清理功能。

## 执行入口

可复用隔离配置：[compose.capacity.json](../../scripts/compose.capacity.json)。运行前仍须核对项目、端口、实际 Mounts、可用磁盘和镜像，不得把环境变量保护当作挂载隔离的替代物。首次需已有与锁文件匹配的 `wardrobe-test:latest`；也可从 backend Dockerfile 的 test target 构建该验收依赖镜像，但不得替换正在使用的业务镜像。

实际启动使用忽略目录内的等价配置（绝对挂载路径），随后将可复用相对路径版本保存到 scripts。命令均在仓库根目录执行：

```sh
docker compose --env-file /dev/null -f data/acceptance/p6-capacity/compose.json up -d --wait
docker inspect wardrobe-p6-capacity-db-1 wardrobe-p6-capacity-runner-1
docker exec wardrobe-p6-capacity-runner-1 python -m app.initialize
docker exec -e PYTHONPATH=/app wardrobe-p6-capacity-runner-1 python /acceptance/backup_capacity.py small 19
docker exec -e PYTHONPATH=/app wardrobe-p6-capacity-runner-1 python /acceptance/backup_capacity.py typical 480
docker exec -e PYTHONPATH=/app wardrobe-p6-capacity-runner-1 python /acceptance/backup_capacity.py near-limit 2200
docker exec -e PYTHONPATH=/app wardrobe-p6-capacity-runner-1 python /acceptance/backup_http_probe.py
docker exec -e PYTHONPATH=/app wardrobe-p6-capacity-runner-1 python /acceptance/backup_limits.py size
docker exec wardrobe-p6-capacity-runner-1 pytest -q -p no:cacheprovider tests/test_backups.py tests/test_backup_storage_faults.py
```

脚本初版前三档使用本地复制，最终保存版本将上传改为真实 HTTP，并补系统世代表除 data_epoch 外的字段比较；最终版本复验结果见下文。文件/JSON 上限与故障阶段在容量三档完成后执行，允许测试夹具清理 **capacity_test**，禁止对业务库执行这些命令。

## 独立上限与故障结果

最终脚本执行 `backup_limits.py json`、`files`、`entries`；JSON/文件档使用真实 HTTP 上传，并比较系统状态除 data_epoch 外的全部字段。

| 维度 | 实际输入 / 操作 | 结果 |
|---|---|---|
| 数据库 JSON 接近上限 | 在隔离 operation_receipts 放入 127 MiB 合成字符串，实际 JSON 133,291,259 字节 | 完整往返通过；导出 1.199 秒、HTTP 1.042 秒、验证 2.224 秒、恢复 4.454 秒 |
| JSON 超限 | 128 MiB 字符串加表结构；另构造 128 MiB + 1 字节上传条目 | 导出及上传包校验均 BACKUP_LIMIT |
| 文件数量 | 9,999 媒体文件 + database.json；1×1 有效 PNG 隔离文件数维度 | ZIP 7,801,278 字节；完整往返通过，导出 0.555 秒、HTTP 0.769 秒、验证 1.221 秒、恢复 1.988 秒 |
| 文件超限 | 10,000 媒体 + database.json；另构造 10,002 ZIP 条目 | 导出 BACKUP_LIMIT；校验 INVALID_BACKUP |
| 总大小 | 合成媒体使导出总量超过 2 GiB；稀疏包 2 GiB + 1 字节 | 均 BACKUP_LIMIT，不发布成功包 |
| 解压大小 | ZIP_DEFLATED 的 2,049 MiB 内容 | 解压前 BACKUP_LIMIT；此高压缩率输入仅用于拒绝验证，不作为容量数据 |
| 清单大小 | manifest.json 为 4 MiB + 1 字节 | BACKUP_LIMIT |
| 坏包 / 缺图 | 修改数据库条目、不匹配外键、上传包漏掉图片、原库引用文件缺失 | 拒绝验证/发布；原目标摘要不变，无确认令牌或可下载成功包 |
| 磁盘不足 | 对导出写入、解包 copyfileobj、恢复点阶段、媒体预写注入 ENOSPC | failed/invalid；原库及引用图片摘要不变、维护态解除；故障解除后显式新恢复成功 |
| 数据库存储不足 | 实际事务 TRUNCATE/INSERT 后抛 PostgreSQL DiskFull / SQLSTATE 53100 | 事务回滚，原库/图片摘要不变；解除注入后显式新恢复成功 |
| 控制记录写失败 | 新建控制记录时 ENOSPC；切换前/已提交后状态持久化持续 ENOSPC | 不产生假成功；存储恢复后按持久 switching/new_epoch 与实际库世代审计，分别 interrupted/succeeded；媒体与其他表一致 |
| 中断 | 数据库切换前/后真实子进程 os._exit(77) | 持久维护标记保留；恢复审计分别 interrupted/succeeded，未重复覆盖 |
| 旧任务 | 备份包含活动任务，恢复后查询及检查租约 | 转 interrupted、租约失效，不自动重放 |

数据库 JSON 档主进程峰值 `1,002,824 KiB`（约 979.3 MiB），文件数档 `148,072 KiB`（约 144.6 MiB）。JSON 内存开销显著，但该主进程也保留了验收对照数据；不能直接当作生产 controller 的精确峰值。JSON 单个大字符串是字节边界负载，不等于大量真实历史行的复杂度测试。

18 项最终定向测试全部通过，耗时 21.16 秒（`faults-final.log`）；首轮 17 项通过后增加上传包缺图与加强切换后摘要检查，再复跑 18 项。包含原 9 项备份测试和新增 9 项存储故障/缺图场景。未复跑无关的前端或全后端套件，没有新增应用代码变更。

## 业务环境保护与收尾

只读采样使用 PostgreSQL REPEATABLE READ / READ ONLY 事务，逐表行规范化排序后 SHA-256；遍历媒体文件计算每文件 SHA-256，再对路径、大小和摘要集合计算汇总哈希。未在业务库创建测试数据、上传包、apply、重启服务或运行 Fake E2E。

前后 **25 张表全部行数和摘要一致**，包含系统世代、偏好、天气缓存及 checkpoints；媒体 **373 个文件、96,015,421 字节**完全一致，汇总 SHA-256：`dc70f9e881dc9da24c34fe152cff222d3d5f468ee2bba25130cbf944736ef753`。其中：

- garments 共 117 条（包含已软删除记录，不能误称现有衣橱 117 件）；media_assets 119 条。
- outfit_revisions 80 条；recognition_calls 12 条；outfit_model_calls 51 条。
- 没有新增真实千问调用，没有改动现有快照或媒体内容。

使用隔离 Compose `stop` 停止 runner/db，**没有使用 down -v**；三个隔离卷和本地原始证据保留。业务 api/db/web 健康、worker/controller 继续运行。可复用 `scripts/compose.capacity.json` 的 `config --quiet` 通过。

静态检查：新增四个 Python 文件 Ruff / format 通过；`scripts/check_structure.py`、`scripts/check_docs.py`、`git diff --check` 通过。文档同步修正 README/ARCHITECTURE/P6 计划里过时的“和风待验”描述，历史当时的记录不改写。

## 验收结论与边界

本轮 **P6 隔离合成容量、备份恢复及受控存储/进程故障验收通过**，覆盖 A-18/A-30 对应服务器数据保护路径。测试没有复用业务卷，业务数据前后完全一致。

以下仍不作通过声明：真实用户大规模照片/历史负载、恰好 2 GiB 的端到端 HTTP 上界、Nginx/手机/局域网大文件上传、真实文件系统满盘及 PostgreSQL 物理磁盘耗尽、宿主断电/文件系统损坏。ENOSPC 和 SQLSTATE 53100 是明确的故障注入；进程退出是实际子进程实验。历史 P5 浏览器恢复和用户手机反馈另有证据，本轮未重新验浏览器缓存世代清除。

运行限制仍成立：导出 JSON 在内存组织，备份/验证/恢复点多份占用磁盘，无自动清理。接近容量上限时须预留多份副本空间和维护窗口，不能只留下一个 ZIP 大小的空间。下一步补 HEIC 原片、Excel 客户端保存证据，以及具备真实规模数据后的复验；不把本轮通过等同于 P6 全部 A-01 至 A-34 完整验收。

## 提交前复核

修正两处验收工具保护：拒绝 `python -O`，防止保护和验收断言失效；HTTP 探针由固定端口改为父进程独占绑定的随机回环端口，并将监听 socket 传给 Uvicorn，避免端口冲突误连已有服务。另补控制目录校验、证据文件标签限制、文件数探针前置条件，关闭 ZIP 读取句柄并移除冗余读取。未修改应用实现。

使用 `scripts/compose.capacity.json` 重新启动隔离栈，检查实际挂载后复跑：

- 备份与存储故障 **18 passed，24.08 秒**。
- `backup_capacity.py review-smoke 0`：399,231 字节小包，真实 HTTP 上传、隔离验证、完整恢复、全表/媒体和系统世代对照通过；覆盖改后的动态监听端口。没有重复执行 2 GiB 压测。
- `python -O`、错误控制目录、缺少隔离标识三个保护探针均在变更数据前拒绝。
- 业务 25 张表及媒体再次与上轮结束摘要一致；复验后停止隔离栈，保留卷。
- Ruff、格式、结构、文档链接及 Git diff 检查通过；只按文件清单暂存脚本、测试、隔离配置和文档。本地 `.env`、数据、原始日志、备份与控制令牌均不提交。Compose 中固定密码仅为独立测试库的公开占位配置，不是真实服务凭据。

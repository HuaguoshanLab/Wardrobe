# 跨端契约设计

版本：0.7。P1 通用协议、P2 衣橱/导入、P3 偏好/天气及 P4 搭配接口已实现，实际字段见 [OpenAPI](../backend/openapi.json)，操作边界见 [P2](P2.md)。P3 实际语义见 [P3](P3.md)；P4 落地细节见 [P4](P4.md)，历史管理/收藏/日历/备份已落地，接口及格式见 [P5](P5.md)。2026-10-26 审查修正见 [REVIEW](REVIEW.md)。

相关文档：[产品](PRODUCT.md)、[架构](../ARCHITECTURE.md)、[决策](DECISIONS.md)。

## 1. 公共约定

- API 前缀 `/api/v1`；JSON 字段使用 `snake_case`，前端读取相同命名，不私建一套字段映射。
- 稳定资源 ID 使用 UUID 字符串，不依赖名称或列表顺序。可增长集合使用游标分页，`limit` 默认 20、最大 100，默认按 `created_at DESC, id DESC` 稳定排序；词表这类有界集合可一次返回。特殊排序/过滤的参数必须写入 OpenAPI。
- 普通时间使用 ISO 8601 UTC，带时区；实际穿着日期使用 `YYYY-MM-DD` 并记录归属时区，默认 `Asia/Shanghai`，不能从 UTC 午夜机械截取。
- 可选标量未知用 `null`；多选属性为空数组代表未标注，不能推断成“不适用”。
- PATCH 中未出现字段表示不变，显式 `null` 清空可选标量；正式衣服的图片、品类不可清空，导入草稿可暂时清空品类，补齐后才能确认。
- PATCH 可变实体携带 `expected_version`；DELETE 使用 `If-Match` 携带该资源版本。成功响应返回新 `version`/ETag；版本过期返回 409 `VERSION_CONFLICT`，不覆盖另一页面的修改。重复提交必须先查幂等记录，再检查版本。
- 金额、令牌用量、模型名仅作为来源/用量元信息，不把估算费用展示成服务商实际账单。

### 响应与错误

除 204 无内容、SSE、图片和文件下载外，JSON 成功响应统一为：

```json
{
  "data": {},
  "request_id": "00000000-0000-4000-8000-000000000001"
}
```

列表的 `data` 包含 `items` 和 `next_cursor`。错误为：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请为第 3 行选择品类",
    "details": [{"row_number": 3, "field": "category", "reason": "required"}],
    "retryable": false
  },
  "request_id": "00000000-0000-4000-8000-000000000001"
}
```

HTTP 状态必须反映结果：422 校验错误、404 不存在、409 版本/幂等/条件冲突、413 大小超限、429 限流、503 服务未配置或不可用。前端按稳定 `code` 分支，不能解析中文消息猜测状态。

异步受理返回 202，`data` 至少包含 `job_id`、`status`，若已创建批次/会话也返回其 ID；恢复验证是独立控制流程，改用 `restore_id` 和验证状态。同步创建返回 201，读取/修改返回 200。任务已受理后的执行失败通过 Job 状态表达，不把原来的 202 改称成功完成。部分行失败的导入返回逐行结果，不能用一个总 `success` 掩盖。

二进制响应使用真实 `Content-Type`，下载带 `Content-Disposition`，不套 JSON。`/health/ready` 只以核心运行依赖判定就绪；外部凭据未配以能力状态返回，不让手动衣橱操作一直被标为不可用。

## 2. 主要 schema 语义

### Garment

| 字段 | 类型 | 规则 |
|---|---|---|
| id / owner_id | UUID | 后端生成，owner 从默认用户上下文解析 |
| category | 受控代码 | 必填，词表由 `/taxonomies` 提供 |
| name | string 或 null | 非必填，空时 UI 可用“品类＋颜色”作为展示名称 |
| image_asset_id | UUID | 必填，引用已验证且有可用展示图的资产 |
| display_variant | `original` / `cutout` | 原图视图可使用保留原貌的转换图，不能直接假设浏览器支持 HEIC |
| color_codes / seasons / occasion_codes / style_codes | string 数组 | 可为空；使用统一词表，季节可多选 |
| material / thickness / warmth | 可空字段 | 未知不推断；精确词表在 schema 阶段固化 |
| custom_tag_ids | UUID 数组 | 自定义标签可筛选，可作为软匹配依据 |
| availability | `available` / `unavailable` | 默认 available；与标签无关 |
| is_demo | boolean | 明确区分示例数据 |
| version | integer | 每次可变更新递增 |
| deleted_at | 时间或 null | 删除后不出现在正常候选集合 |

初始品类工程默认：`top`、`bottom`、`dress`、`outerwear`、`shoes`、`bag`、`hat`、`scarf`、`belt`、`jewelry`、`other_accessory`。对应中文显示名集中维护；以后扩展词表不修改历史快照。

季节代码固定 `spring`、`summer`、`autumn`、`winter`；界面“四季”映射为四个值，不建立第五种互相重叠的季节。

### ImportRow

P2 Garment 响应不暴露 owner_id/deleted_at，补充 image_url、has_cutout、created_at；PATCH 使用 `{expected_version, changes}`。标签响应为数组，分页用于衣橱列表。

每行保存 `id`、`row_number`、`image_asset_id`、`draft`、`version`、`validation_errors`、`confirmed_garment_id`、`touched_fields`（人工改过的字段）。另有 `conversion_status`、`analysis_status`、`cutout_status`，各取 `not_requested` / `queued` / `running` / `succeeded` / `failed` / `interrupted` / `cancelled`，不能把“去背景失败”和“行无法入库”合成一个状态。

`row_status` 为 `invalid`、`ready`、`confirmed`、`skipped`。AI 不确定时保留空字段并提供不确定性提示，不伪造置信度数字。Excel 行不默认进入 AI 识别队列。

- 行是否 ready 只取决于有效展示图、品类和已填字段合法性；识别或去背景未成功不强制阻塞手工确认。
- 识别开始记录行版本。结果到达时只能合并未被人工修改且仍为空的字段；用户手动清空也算修改。重新识别不默认覆盖已有值。确认后不得再自动改衣服属性。
- 两条入口均安排转换及去背景；只有照片入口安排识别。未配置模型时，照片仍能进入人工审核，行级显示 `PROVIDER_NOT_CONFIGURED`，不能偷偷切成 Fake Provider。
- 去背景结果仅增加衍生资产。默认优先展示成功的去背景图；用户已明确选择原图后，晚到结果不得切换该选择。转换失败没有有效展示图的行不能入库。
- PATCH 草稿可标记 skipped；处理未完成时移除行需忽略该行晚到结果。不能通过把整批标成功来隐藏某行失败。
- 批次保存 `parent_job_id`，行保存各处理步骤的最新 Job 引用；重试创建新步骤 Job，不把旧终态改回运行中。批次 GET 聚合最新行状态；旧 Job 的完成摘要保持当时结果。

### OutfitRevision

包含 `id`、`session_id`、`parent_revision_id`、`run_id`、`items`、`reason`、`unmet_requirements`、`weather_snapshot`、`request_snapshot`、`created_at`、`provider_mode`。首版 `run_id` 等于本次搭配 Job 的 ID，不再新增一套含义重叠的运行 ID；LangGraph `thread_id` 独立映射会话。

- 每个 item 有稳定的 `item_id` 和服装位置 `slot`；衣橱单品使用 `source: wardrobe`、有效 `garment_id`、当时属性和当时实际展示的不可变 `display_asset_id` 快照。不能只存衣服当前会变化的图片选择。
- 衣橱外建议使用 `source: suggestion`、`garment_id: null`、文字说明及品类；展示“未拥有”，不伪造单品照片或购物链接。
- 锁定集合使用真实单品 ID；调整需传 `base_revision_id`、`locked_garment_ids`、目标范围及用户文本。
- 原结果不修改，新结果保存父版本引用。单个 run 的 `revision_ids` 长度为 0–3；0 套时必须返回明确原因，不能空白成功。
- 同组合仅更换理由不算不同方案；锁定导致可选组合有限时可返回较少方案。

### OutfitSession 与操作语义

- 会话保存 `version`、`requirements`、`selected_revision_id`、`locked_garment_ids`、`current_job_id`、`latest_revision_ids`；Profile 保存 `current_session_id`。首次无会话时返回 `data: null`，不自动创建或生成。
- `POST /outfit-sessions` 只建会话并设为当前，可携带 `base_revision_id` 复用历史；复用只预填草稿并返回失效单品，不调用模型、不恢复已删除单品、不隐式锁定。锁定缺省为空集合。
- 选择某套或改锁定先 PATCH 会话，带 `expected_version`。锁定必须属于所选版本的真实衣服；切换版本时仅保留两者共有且仍有效的锁定 ID，并明确返回移除项。新请求始终校验当前状态。
- `generate` 创建最多三套候选；有锁定时保持锁定。`adjust` 必须指定 `base_revision_id`、`scope` 和 `expected_version`；默认更新选中方案的一套新版本，其余候选保留，这属于可调整工程默认。
- `scope=replace_items` 携带非空 `target_item_ids`，非目标项全部保持，哪怕未手动锁定；目标与锁定冲突时拒绝。`scope=rebuild_unlocked` 才允许重新选择全部未锁定项。不能把“只换裤子”解释成全套重生成。
- 首次生成前的聊天文本作为需求补充保存，点击生成才提交生成 Job；已有选中方案时发送调整消息属于显式调整。模型解析操作必须落入同一 schema，不能自己扩大目标范围。指代歧义只返回澄清消息、不修改搭配；不对已明确的软条件冲突重复追问。
- 成功生成后更新候选列表；成功调整后将选中项替换为新 revision 并更新 `selected_revision_id`。失败保持原结果。刷新只 GET 当前会话和已有 Job。
- 成功生成默认选中新批次第一套，返回明确选择状态；0 套或澄清时不清空此前有效结果。generate/adjust 均带会话 `expected_version`；若请求重复携带锁定或条件，必须与该版本一致，不能出现两份互相冲突的权威状态。
- 会话持久保存用户已发送消息与助手最终回复（含澄清），关联 Job 和 revision；未发送草稿由前端保留，不把流式片段逐条保存为消息。会话 GET 返回有界最近消息，较早记录通过消息接口分页读取。澄清结果使用 `outcome=needs_clarification` 和明确问题，不生成新 revision。
- 历史列表删除采用 `hidden_from_history_at`，不修改内容快照，也不删除收藏/日历引用。隐藏记录不重新被首页/历史自动选中；显式从收藏或日历查看仍可读。
- 隐藏当前选中版本时清空选择及相关锁定，从候选列表移除该版本，保留其他候选但不自动改选或生成；受影响会话有活动任务时返回冲突，等待任务终态再操作。
- 日历日期以本地时区计算，首版允许同日多条，拒绝未来日期的“实际穿着”记录。相同日期与 revision 的重复记录返回已有记录；不同搭配可分别保存。此为工程默认，不增加计划日历功能。

### WeatherContext

包含 `source`（`qweather` / `manual`）、城市标识及名称、坐标（可空）、`observed_at`、`fetched_at`、`valid_for`、温度、体感（可空）、日最高/最低（可空）、天气现象、降水信息、`stale`、归因信息。

请求中的手动覆盖与原服务返回分开记录。不能用模型猜测补齐缺失实测字段。坐标顺序和天气字段单位在后端适配器统一。

手动天气随生成请求的 `weather_override` 提交（温度摄氏数值、天气现象必填，其余可空），后端形成快照，不用调用写天气接口。温度 0℃是合法输入；请求缺少可用天气且未提供手动输入时，返回可操作的错误并保留需求，不凭空推断当前天气。城市可缺省于手动天气，但有城市时仍限大陆。

实时数据和日预报分字段及有效日期保存，城市搜索和缓存不能等同最终搭配天气。缓存初始实况 15 分钟、当日预报 60 分钟；服务失败不静默采用过期值，提示手动输入并展示缓存及其时间供参考。城市变化重新取对应天气，不把旧城市结果串入。

### 请求、能力与词表

- `requirements` 包含可选的 `occasion_codes`、`style_codes`、`season_codes`、`custom_tag_ids`、`notes` 和 `weather_override`；按钮和聊天最终都归一化到经过校验的结构。请求明确条件优先于长期偏好，未知值不能偷偷变成确定条件。
- 基础品类、季节、场合、风格及属性取值使用同一份带版本的词表生成 API 和模板；P2 词表由 backend/app/domain/taxonomy.py 维护。无法识别的受控值报行级错误，不能静默丢弃或降级成自定义标签；自定义标签规范化去重。
- 偏好以明确类型维护风格、版型、冷热倾向、颜色偏好及补充说明，P3 已固定字段和取值，见第 8 节；不能用任意 JSON 直接塞进提示词替代协议。
- `GET /capabilities` 返回模型/天气/去背景的配置与可用状态（允许 unknown）、维护状态和 `data_epoch`；查询不触发模型，不暴露凭据。Fake 模式必须显式配置且对用户可见，不能因真实服务失败自动切换。

## 3. HTTP 接口清单

以下为完整接口规划，P1–P5 已落地部分以 OpenAPI 和第 8 节为准；P5 实际接口见 [P5](P5.md)。允许在实现前合理调整并同步两端，不允许前后端分别私改。

| 方法与路径 | 含义 | 主要规则 |
|---|---|---|
| `GET /health/live` | 进程存活 | 不触发外部付费服务 |
| `GET /health/ready` | 依赖就绪 | 数据库/迁移检查，外部配置状态可查询，不每次调用模型 |
| `GET /capabilities` | 能力及数据代际 | 配置/Fake/维护状态；data_epoch 用于恢复后清理客户端旧状态 |
| `GET /taxonomies` | 基础词表 | 提供词表版本与显示名称 |
| `GET/POST /tags` | 标签列表/新增 | 同名规范化去重 |
| `PATCH/DELETE /tags/{id}` | 修改/删除自定义标签 | 不改基础词表代码；历史快照不变 |
| `GET /garments` | 衣橱列表与筛选 | 默认排除已删除，分页 |
| `GET/PATCH/DELETE /garments/{id}` | 详情/编辑/删除 | 更新版本检查；删除不清理历史图片 |
| `GET /media/{id}` | 应用内媒体访问 | 返回正确内容类型；不泄露磁盘路径 |
| `GET /imports/template` | 下载固定 Excel 模板 | 明确模板版本和图片插入说明 |
| `POST /imports/excel` | 上传 `.xlsx` | multipart；返回导入批次和解析 job_id |
| `POST /imports/photos` | 批量照片 | multipart；返回批次和处理 job_id |
| `GET /imports/{id}` | 导入预览与逐行状态 | 可刷新恢复 |
| `PATCH /imports/{id}/rows/{row_id}` | 修改草稿/跳过行 | 未确认行编辑，expected_version；记录人工触碰字段 |
| `POST /imports/{id}/rows/{row_id}/retry` | 重试识别/图片步骤 | 明确指定步骤；Excel 不自动变照片识别流程 |
| `POST /imports/{id}/confirm` | 确认选中行入库 | 行级幂等，返回每行结果；错误行不阻塞有效行 |
| `GET/PATCH /profile/preferences` | 长期偏好 | 显式编辑，不自动行为学习 |
| `GET/PATCH /profile/location` | 默认城市 | 只在用户选择或同意使用定位后更新 |
| `GET /weather/cities` | 名称/坐标查询城市 | 限大陆，处理重名与无结果 |
| `GET /weather` | 查询天气 | 明确城市或坐标；缓存；不触发搭配 |
| `POST /outfit-sessions` | 创建/从历史预填新会话 | 幂等；设为当前；不调用模型 |
| `GET /outfit-sessions/current` | 首页恢复 | 无会话返回 data:null；定义在动态 ID 路由之前 |
| `GET/PATCH /outfit-sessions/{id}` | 恢复/修改会话 | 读取任务与结果；更新条件、选中项和锁定，expected_version |
| `GET /outfit-sessions/{id}/messages` | 读取会话消息 | 游标分页；关联任务，刷新不重复发送 |
| `POST /outfit-sessions/{id}/generate` | 显式生成 | 幂等、最多三套，返回 job_id |
| `POST /outfit-sessions/{id}/adjust` | 显式调整 | 指定 base_revision 与锁定集合，返回 job_id |
| `GET /outfit-revisions` | 历史列表 | 固定版本、分页 |
| `GET/DELETE /outfit-revisions/{id}` | 详情/删除历史入口 | 收藏或日历仍引用时保留底层快照并告知用户 |
| `GET/POST /favorites` | 收藏列表/收藏版本 | 收藏 revision_id；重复收藏去重 |
| `PATCH/DELETE /favorites/{id}` | 命名/取消收藏 | 不改对应搭配快照 |
| `GET/POST /wear-records` | 按日期查询/记录穿着 | 默认今天；日期可补记；显式操作 |
| `PATCH/DELETE /wear-records/{id}` | 修改/删除穿着记录 | 不修改原搭配版本 |
| `GET /jobs/{id}` | 查询任务和结果引用 | GET 永不重跑任务 |
| `GET /jobs/{id}/events` | SSE 订阅/恢复 | 事件序号游标；只读 |
| `POST /jobs/{id}/cancel` | 请求取消 | 幂等；完成后不假装撤销既成结果 |
| `POST /jobs/{id}/retry` | 显式重试失败/中断任务 | 仅受支持类型，创建新 Job，重新校验前置条件 |
| `POST /backups` | 创建备份 | 维护写入边界，返回任务 |
| `GET /backups/{id}/download` | 下载生成的备份 | 有限有效期，不接受任意文件路径 |
| `POST /restores/validate` | 上传并验证备份 | 202 返回 restore_id 和验证状态；完成后 GET 读取摘要及确认令牌，不覆盖数据 |
| `GET /restores/{id}` | 查询验证/恢复进度及结果 | 从独立持久化控制状态读取，覆盖业务库时仍可查询 |
| `POST /restores/{id}/apply` | 确认恢复 | 令牌绑定已验证文件；先恢复点，再覆盖 |

以上路径全部相对 `/api/v1`，含健康检查及媒体路径；文件响应仅编码方式特殊。P1 落实本阶段通用 schema 和 OpenAPI 生成链路，业务 schema 在各功能阶段实现之前完成，不能要求尚未开发的全部业务 API 在 P1 一次建完。

## 4. 幂等与并发

- 生成、调整、照片/Excel 上传、会话创建、确认导入、记录穿着、重试、创建备份和恢复应用等创建操作携带 `Idempotency-Key`。单一用户动作生成一次键，重发同请求复用该键。
- 服务端按 owner、操作域、键建立唯一约束，存规范化请求哈希。相同键/相同内容返回原结果；相同键/不同内容返回 409。
- 用户主动点击“重新生成”是新动作，使用新键。查询、页面恢复不能偷偷产生新键并提交生成。
- 客户端先持久保存操作键和草稿摘要再发送，响应返回后记下资源 ID；传输失败重发时复用，不因页面卸载丢失。服务端首版不自动清理创建类幂等记录；上传哈希含文件内容及规范化字段，失败临时文件要能清理。相同内容用新键主动上传仍是新的批次，不擅自去重用户确有两件相同衣物的情况。
- 行确认请求含每行 `row_id` 和 `expected_version`，每行独立事务（或等价 savepoint）。返回 `confirmed` / `already_confirmed` / `invalid` / `version_conflict` 及 garment_id/错误；对 `(import_batch_id, row_id)` 唯一约束，已确认行不再创建。重发原键原请求回放原响应；修正错误行后使用新操作键，仅提交需要确认的行。
- 一个会话同时只允许一个 `queued`/`running`/`cancel_requested` 生成/调整任务；新操作返回 409 并给出现有 job_id。须等旧任务确认进入终态后才能另起；发送取消请求本身不会立即释放会话。活动任务期间拒绝修改会话条件/锁定，前端保留未提交草稿。
- 任务启动时读取上下文，提交结果时重新校验相关衣服版本及状态。中途已失效的单品不得混入“新可用结果”。

- API 在同一事务写 Job 和待投递记录；实际队列通过 outbox 投递或直接可靠领取 Job。Worker 使用租约/领取标识，唯一业务提交以 Job ID 约束；同一 Job 重复投递不会创建第二套结果。事务提交前短暂锁定并验证相关衣服版本，模型请求期间不持有这些锁。
- 普通 Job 终态、业务结果与最终 result/error/status 事件在同一数据库事务提交；恢复控制任务采用下文的独立记录。Checkpointer 通常不参与该事务，所以节点恢复必须先查询 Job/业务提交记录，已成功的步骤不再次生成或重复持久化。失败的图状态不能覆盖已完成业务事实。
- 外部调用按 `(job_id, step_id, attempt)` 记录发送状态和经校验的响应引用，模型响应需先持久化再进入后续节点。重放复用已保存响应；已发送但没有可靠响应记录时按结果未知中断，不能只检查整个 Job 尚未完成就重发模型请求。

## 5. 任务状态与 SSE

任务状态：`queued` → `running` → `succeeded` / `failed` / `interrupted`。请求取消可进入 `cancel_requested`，在安全边界进入 `cancelled`；尚未执行的任务可直接取消。

- `succeeded` 可以包含不足三套或未满足软条件，但不能违反硬约束。
- 锁定单品失效等硬约束失败使用 `CONSTRAINT_CONFLICT`，在提交前检测到可直接返回 409；执行中检测到则任务失败并带可解释错误。
- `interrupted` 表示进程故障或外部调用结果不明。必须显示可恢复/重试范围，不能简单重置为 queued。
- 终态不回到 running；用户显式重试创建关联旧任务的新任务，新调用可能产生费用。

### 重试、取消和恢复边界

- Job 保存 `kind`、`input_snapshot`、`retry_of_job_id`、`attempt`、`lease_token`、`heartbeat_at`、`result` 和结构化 `error`。租约过期 worker 不得继续提交；故障 worker 的迟到返回不能覆盖新状态。
- 可重试类型为识别/转换/去背景及后续搭配生成/调整；P2 导入解析失败需修正文件重新上传，有审核行时按步骤重试；已确认行不重复执行。请求重新检查素材和配置；搭配任务还需检查版本及锁定。备份/恢复不走通用自动重试，重新进行各自准备与确认。
- 队列重复投递与图恢复允许重放无副作用的读取和已完成步骤结果；外部模型请求已发出但结果未知时标记 interrupted，提示用户新尝试可能再次计费。禁止由图重放或 HTTPX 通用 retry 悄悄重发。
- 取消和成功提交竞争时以数据库事务先后为准：成功先提交则取消返回当前成功状态；取消先提交则禁止新结果提交，迟到响应可记录诊断但不改变衣橱/搭配。终态取消调用是幂等查询，不承诺撤回模型已发生的费用。
- 搭配默认最多 12 个图节点执行步、每次运行累计最多 4 次模型 HTTP 尝试、其中校验修正最多 1 次；每次模型请求总时限 120 秒、搭配任务总时限 300 秒。终止条件取最先达到者；工程配置可调整，不能靠“解析重试”绕过总预算。

### Job 结果类型

| kind | result 内容 |
|---|---|
| `import_photos` / `import_excel` | import_batch_id、ready/invalid/confirmed/skipped 行数、失败步骤摘要 |
| `media_convert` / `media_cutout` / `garment_recognize` | import_row_id、image_asset_id、步骤状态或识别草稿引用 |
| `outfit_generate` / `outfit_adjust` | session_id、revision_ids、outcome（complete/partial/no_match/needs_clarification）、unmet_requirements、可选澄清问题 |
| `backup_export` | backup_id、格式版本、清单摘要及下载接口 |
| `backup_restore` | restore_id、恢复后数据摘要及客户端刷新要求 |

批次任务成功代表已完成各行处理，不代表各行都能入库；整文件无效或基础解析失败才整体 failed。空衣橱（排除示例后）返回 `no_match` 和上传提示，不用外部建议拼出全套充数；该检查不需要调用模型。

恢复控制状态不参与被覆盖业务库的事务。backup_restore 的状态和事件由独立控制记录原子推进，恢复完成校验后才标成功；其查询/SSE 语义与普通 Job 相同，但不能依赖目标 Job 表或伪称与目标数据切换处于同一 PostgreSQL 事务。

恢复验证状态为 validating/ready/invalid/expired，只有 ready 且令牌有效时才可 apply；apply 生成稳定的控制 Job ID，通过同一记录推进 queued/running/终态。验证失败不产生覆盖任务，恢复切换期间不支持通用 cancel/retry，返回明确不支持及当前状态，避免取消一半的数据切换。

事件类型：`status`、`progress`、`result`、`error`。可增加可选的 `message_delta` 用于解释性文字，不把它当可执行工具指令或最终搭配。

事件负载示例：

```json
{
  "schema_version": 1,
  "job_id": "00000000-0000-4000-8000-000000000002",
  "seq": 3,
  "type": "progress",
  "occurred_at": "2026-10-26T02:00:00Z",
  "payload": {"stage": "validating_outfits", "message": "正在检查搭配约束"}
}
```

SSE 格式：

```text
id: 3
event: progress
data: {"schema_version":1,"job_id":"00000000-0000-4000-8000-000000000002","seq":3,"type":"progress","occurred_at":"2026-10-26T02:00:00Z","payload":{"stage":"validating_outfits","message":"正在检查搭配约束"}}

```

- `seq` 在一个 Job 内单调递增，普通任务在数据库约束唯一，恢复控制任务在其持久记录中保证唯一；恢复传 `Last-Event-ID` 或 `after_seq`，两者不一致报错。只返回大于游标的事件。
- 浏览器按 `(job_id, seq)` 去重。若游标超出保留范围，返回明确的 `EVENT_CURSOR_EXPIRED`，前端 GET 任务及结果恢复。
- 用 SSE 注释发送心跳。读取端取消订阅不调用 `/cancel`。
- `result` 事件的 payload 使用上述按 kind 区分的结果 schema，只有搭配任务包含 revision_ids；完整结果也可用 GET Job 读取。所有 `status` 事件含当前状态；失败发 error 后发 failed/interrupted 状态，成功发 result 后发 succeeded 状态；普通任务在同一事务中确定顺序，恢复控制任务由独立记录原子确定。
- 终态任务重连先补发游标之后的已存事件，再关闭 SSE；已读到末尾则不等待新的业务事件。客户端已知终态后不自动重连。业务事件默认保留 7 天，Job 最终摘要及结果引用首版不自动删除。
- SSE 打开前的错误使用普通 HTTP/JSON（过期游标用 410）；连接打开后的错误用事件表达。浏览器进入后台后恢复先 GET Job，再决定是否订阅，不因连接正常关闭重跑任务。
- 网络分片、UTF-8 字符分片、多行 data 和 JSON 完整性需要测试。代理不得缓冲整个流后一次性输出。

## 6. Excel 模板 v1（P2 已实现，真实客户端样例待验）

- 文件类型仅 `.xlsx`；数据工作表名 `garments`；元信息工作表 `meta` 保存 `template_version=1`。
- 数据表第 1 行固定列名：`图片`、`品类`、`名称`、`颜色`、`季节`、`场合`、`风格`、`材质`、`厚度`、`保暖程度`、`自定义标签`、`状态`。
- 图片和品类必填；状态空白为“可穿”，其他空白为未知。多选字段使用英文分号分隔，模板给出示例与词表说明。
- 图片用嵌入绘图对象，左上锚点落在对应数据行的“图片”列。每行一张，鞋的一双可以在同一张图片中。不按压缩包资源顺序匹配。
- 不支持 URL、IMAGE 公式、宏、链接工作簿求值及任意排版。新版 Excel 的单元格图片结构在验证支持前必须明确拒绝/说明，不能默默丢图。
- 模板由程序生成，并使用同一导入器验证可往返。模板的嵌入图片建议 JPEG/PNG；HEIC/HEIF 支持承诺主要在照片上传入口，Excel 内已转换的嵌入图按真实格式解析。
- 对多图片、跨行歧义、未识别品类、损坏图和缺图给出逐行错误。空白尾行忽略，非空问题行不能静默跳过。
- 在真实 Excel 保存后的文件上验证；其他编辑器导出的文件只在通过同一模板验证后接受，不承诺所有办公软件图片对象都兼容。

## 7. 上传与任务资源默认值

以下是可调整工程默认，不是用户另外承诺的产品限制，见 D-06：

| 参数 | 初始默认 |
|---|---|
| 一次照片选择 | 最多 20 张 |
| 单图原件大小 | 最多 20 MiB |
| 单图解码像素 | 最多 64 MP，处理衍生图前控制内存 |
| 一批照片总大小 | 最多 200 MiB |
| Excel 原文件 | 最多 50 MiB，100 条数据行 |
| Excel 解压总大小 | 最多 250 MiB，并限制条目数/压缩比 |
| 图片处理并发 | 默认 1，根据机器验证调整 |
| 云模型并发 | 默认 2，并服从账号限制 |

超限在上传前尽可能提示，后端独立校验；不自动截断丢行。不支持的动画、多帧或文件内容需返回明确说明。模型预算与缓存先采用本文默认值，真实适配验证后可调整配置并记录依据，不能无限制。

## 8. 契约落地与变更

P1 落实通用 Pydantic schema、OpenAPI 与最小前端类型生成链路；各业务阶段在实现功能前补齐对应请求/响应 schema。后续以可执行 schema 验证字段，本文维护业务语义和示例。生成类型不得手改。

P2：照片 multipart 字段 files（可重复），Excel 字段 file；上传返回 import_batch_id/job_id/status。确认体为 rows 数组（row_id、expected_version），逐行返回 confirmed/already_confirmed/invalid/version_conflict。草稿 PATCH 可携带 skip=true；重试体 step=conversion/analysis/cutout。媒体 variant=original/cutout/source，source 为原件下载。衣橱筛选参数 q/category/season/occasion/availability/tag_id，limit 1–100、默认 20，created_at/id 倒序，next_cursor 为末项 UUID。

P3：偏好 PATCH 为 `{expected_version, preferences}`，preferences 内未出现字段保持原值，null/[] 显式清空。风格/颜色用基础词表；fit=fitted/regular/loose 或 null，thermal=cold_sensitive/heat_sensitive/neutral 或 null。喜欢/避开颜色及 notes 独立保存。位置 PATCH 为 `{expected_version, city}`，city=null 清空。两者必传 Idempotency-Key 并返回各自 version。

城市查询 `GET /weather/cities?q=名称或经度,纬度`；`GET /weather/provinces` 返回手填城市可选大陆省级地区。City 含 id/name/adm1/adm2/latitude/longitude/source。手填 source=manual、id/坐标为 null；qweather 对象必须与服务端搜索目录匹配。

`GET /weather?city_id=...` 返回 city/current/daily/errors；实况与日预报分别包含 source/kind/valid_for/fetched_at/expires_at/stale/attribution 和对应字段。全无数据返回 503；部分可用或过期参考返回 200，errors 明示失败，stale 不能参与自动生成。v1 实况不提供观测时间时 observed_at=null，不能伪造。

`POST /conditions/preview` 接收 Requirements，返回 requirements/effective_preferences/preference_version，只校验/合并，不建 Job 或会话。style_codes=null 继承最新偏好，[] 明确不限制；weather_override 包含 temperature_c/condition，0℃合法。P3 不将此预览当作真实生成授权或天气快照；P4 生成事务仍需校验日期、时效及标签存在性。

P4 会话、搭配、图片快照和消息接口已落地，字段与操作边界统一见 [P4](P4.md) 和 OpenAPI；保留本文件的幂等、任务及调整约束。

P5：历史列表用包装对象返回不可变 revision 和历史 version；DELETE 历史/收藏/穿着返回 Deleted 说明，传 If-Match 和 Idempotency-Key。实际备份格式、限制、控制任务及下载有效期见 [P5](P5.md)。

任何破坏性改动需要一起更新两端、Fake Provider、测试、Excel/备份版本及文档。契约变更不能隐式改变 [PRODUCT](PRODUCT.md) 中的用户需求；若涉及范围变化，先与用户明确。

P6 识别：能力增加 recognition（fake/configured/unconfigured）；ImportRow 增加 analysis_notes 字符串数组；ImportResult 增加 interrupted_rows（旧结果缺省 0）。每行识别最多一次 HTTP 请求、120 秒；批次最多 20 行/20 次，显式单行重试新 Job 最多一次，无自动纠错或传输重试。未知行标 interrupted，其余行继续，父 Job 保存汇总并标 interrupted。模型只输出受限属性及不确定性提示，人工字段、状态、显示方式及标签 ID 不由识别修改；完整运行边界见 [P6 识别](P6-recognition.md)。

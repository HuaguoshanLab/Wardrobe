# 2026-10-30 · 新版子类识别真实千问验收

用户要求使用真实千问重点核对子类，发现一个问题修复一个、修复后再验证。本次沿正常照片导入 → worker → 调用账本 → 审核草稿链路，模型为 `qwen3-vl-plus`、模式为 `qwen`。照片来源为此前已授权使用的 8 张 PNG；先目视记录预期，再逐张调用。没有确认入库。

## 两处问题及逐项复验

1. **场合混入风格代码，整行识别失败。** v3 前四张通过，第五张夹克返回 `occasion_codes=["daily","casual"]`。`casual` 只属于风格字段，因此后端严格校验拒绝整份响应。读取已有观测输出定位原因，没有为诊断再调用模型。v4 明确字段枚举不可混用、日常场合使用 daily，增加对应非法响应回归；34 项定向测试通过后部署。同一失败行显式重试一次成功，场合仅为 daily，第一处问题复验通过。没有放宽 schema、静默删除非法值或自动纠错重试。
2. **候选缺少夹克，名称带入未知厚度。** 原响应名称为“短款翻领夹克”，子类却选“薄外套”；v4 仍存在。视觉候选与人工盘点名称分开，增加“夹克”，排除“薄外套”“羽绒服”两个无法仅凭外形确定薄厚/填充物的名称。v5 强调衣服结构、同义匹配及未知留空，禁止把候选顺序当作依据。人工子类配置、旧单品不改名。44 项相关测试通过后部署，以同一照片创建新草稿复验，返回“夹克”，材质/厚度/保暖性保持未知。使用新草稿是为了保留旧响应及不覆盖已填字段的保护规则。

随后用最终 v5 逐张验完剩余样例，并重新验证前四张；没有发现新的子类错误。

## 最终版真实结果

| 照片 | 目视依据与预期 | v5 结果 | Job ID |
|---|---|---|---|
| 米白长袖上衣 | 圆领、T 恤结构 | top / T恤 | 44594305-9c2b-4b58-be67-1c017c009dae |
| 蓝色短袖上衣 | 可见织纹和罗纹边，不根据袖长归为 T 恤 | top / 针织衫 | 83537aa5-6312-48f1-bb5f-2ad6f9245769 |
| 灰色裤子 | 完整长裤腿 | bottom / 长裤 | 8c58642d-4c7f-4689-855c-9add860c056f |
| 黑色裙子 | 腰部至下摆的半身裙结构 | bottom / 半身裙 | 140c1641-78d4-4487-a322-fecd661a4374 |
| 棕绿色短外套 | 夹克门襟、侧口袋；无法确认薄厚 | outerwear / 夹克 | e9dd1c0e-81c2-47fe-9f94-6156718fd8f1 |
| 米白色鞋 | 低帮系带休闲板鞋外形 | shoes / 休闲鞋 | 0b79fbce-aa3b-4ec0-bd79-633597160cae |
| 深蓝印花上衣 | 翻领、连续纽扣门襟、衬衫袖口 | top / 衬衫 | 721b078d-d8c6-416c-b151-58312ca9fc6c |
| 军绿色双口袋上衣 | 翻领、纽扣门襟、弧形下摆 | top / 衬衫 | 65006d73-185d-423d-81ce-f9785c728972 |

最终 8 张转换、识别和去背景均成功，子类与预先目视判断一致；condition/fit 均为 unknown，来源、获得日期、价格、位置、材质、厚度和保暖性均为空，档案备注为空。storage=daily 是导入默认值，不是视觉推断。全部 confirmed_garment_id 为空。

本轮恰好 **14 次真实调用**：v3 五次（4 received / 1 failed）、v4 一次（received）、v5 八次（received）。总账本从 17 到 31；13 个新批次/新草稿，另一次为原失败行显式重试。连续三轮查询最终 8 个批次，共 24 次 GET，前后完整调用账本一致，没有隐式重发。失败账本及旧错误草稿保留，不覆盖历史。没有核对供应商实际账单，不将本地费用估算当作账单。

## 工程验证与部署

实际执行：

```sh
docker compose -f scripts/compose.import-regression.json run --rm test pytest -q -p no:cacheprovider tests/test_recognition_provider.py tests/test_recognition_subtypes.py tests/test_recognition_calls.py tests/test_recognition_recovery.py
# v4: 34 passed

docker compose -f scripts/compose.import-regression.json run --rm test pytest -q -p no:cacheprovider tests/test_recognition_provider.py tests/test_recognition_subtypes.py tests/test_recognition_calls.py tests/test_recognition_recovery.py tests/test_import_details.py
# v5: 44 passed
```

覆盖非法枚举、同品类候选校验、禁用子类、不从视觉判断薄厚/填充物、未知留空、人工与 Excel 优先、人工清空、调用账本和恢复。测试使用独立 PostgreSQL；未重复跑整套前端或全套后端。

Ruff check / format 通过；mypy app：116 个源文件通过；结构检查：355 个手写文件通过。文档链接和 diff 空白检查通过。

从已验证的导入/P7.1 后端发布副本，仅叠加两个识别源文件构建 `wardrobe-recognition:local`；确认无活动任务后更新 API、worker、controller，运行提示版本核对为 `garment-vision-v5`。保留当时的 `wardrobe-p7-1-ui-web:local` 和现有数据库/媒体卷，无迁移、无前端部署。发布副本与本地两个识别源文件逐字一致。临时独立回归服务已停止，卷和证据保留。

## 数据保留及限制

前后 35 张表中 25 张摘要完全一致，包括正式衣服、子类、生命周期、四季需求、补充处理、换季会话及搭配模型调用账本。原有 390 个媒体文件摘要全部一致；新增 39 个文件属于 13 次照片导入。

首次摘要检查发现除了导入/任务表外，搭配版本、图片引用及穿着表也发生变化。只读核对到并行新增手动版本 `9f5d436a-e5b1-4e1c-8783-a368df786eda`（source=manual、run_id=null）及其穿着记录，创建于 2026-10-30 03:54:57 UTC。本轮没有调用手动搭配或穿着接口，未撤销这些变化；不能宣称全部业务表不变。审核草稿也未因验收而删除。

本地私有证据位于忽略目录 `data/acceptance/recognition-v3/`：expected、逐次响应、旧失败诊断、ledger、verified、before/after、preservation、concurrent-changes、测试和构建日志。目录沿用首轮 v3 命名，最终响应版本为 v5；不提交照片、完整响应或凭据。

这是 8 张清晰单件照片、4 个大类的小样本验收，不是通用准确率。未覆盖复杂背景、遮挡、多个主体、连衣裙、配饰或自定义子类真实样例；季节/场合/风格仍是需审核的软建议，不因子类通过而宣称全部属性准确。下一步按实际使用反馈补充误识别样本，无自动追加付费调用。

## 本地提交前独立快照复核

用户要求提交本次修改。由于导入 I1～I4 尚未提交，本次包含导入字段、Excel v2、审核、子类识别及验收记录，共 47 个文件；P7.1 手动搭配及其界面改动仍保留在工作区。共享文档只暂存本任务部分，OpenAPI/前端类型从待提交快照重新生成，没有手改生成文件或混入手动接口。

待提交快照基于原 W4 的 0010_seasonal，仅改变导入备份 app_version；当前运行中的 P7.1 迁移和服务未改动。另建专用 `import_commit_test` 数据库，用快照的 app/migrations/tests 覆盖测试镜像对应目录，完整后端 **254 passed，111.48 秒**；快照前端 **74 passed**，TypeScript、生产构建、Prettier 均通过。Ruff、mypy（112 个源文件）、结构（336 个手写文件）、文档（92 份 / 479 个本地链接）及 diff 检查通过。计数不同于上方合并部署，是因为此快照未包含 P7.1；不将合并工作区的测试冒充独立提交证据。

本次没有重新部署或追加真实模型调用。专用测试数据库及日志保留，测试服务停止；图片、原始响应、密钥和运行数据未纳入提交。

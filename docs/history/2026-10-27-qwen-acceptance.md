# 2026-10-27 · 真实千问识别首轮验收

## 范围与配置

- 用户提供本地凭据及 8 张 PNG，授权继续真实识别验收。照片与原始 HTTP 回执保存在 Git 忽略的 `data/acceptance/qwen/`，凭据仅保留在 `.env`。
- 发现本地 PROVIDER_MODE=qwen、RECOGNITION_MODE=fake；将后者改为 qwen，保留前者。检查没有 queued/running 任务后，重新创建 api/worker/controller；没有清理卷、覆盖恢复或修改数据库密码。
- `GET /api/v1/capabilities` 显示识别和搭配 configured；这只证明配置存在，不等于搭配已联调。本轮未提交搭配生成。

## 实际结果

- 仅上传 `服装拍摄要求.png`（浅色长袖上衣），使用幂等键 `qwen-acceptance-20261027-first`。
- 批次：`c9d9a88d-3e7f-4315-917e-19981bb3cac9`；任务：`020a025b-96a2-44e9-a457-762b427f9e6c`；行：`fde5ace1-72a2-4c5e-9f4f-967de7d864ee`。
- 图片转换与本地去背景 succeeded；识别 failed，错误为 INVALID_MODEL_OUTPUT。真实 qwen3-vl-plus 请求收到响应，但本地响应结构/属性校验拒绝；不能据此认定识别通过。
- recognition_calls 对该行仅有 1 条记录，mode=qwen、model=qwen3-vl-plus、state=failed、error_code=INVALID_MODEL_OUTPUT。失败路径不保存原始响应，因此现有记录无法定位具体不兼容字段。
- 父导入任务 succeeded 表示步骤执行结束，不能替代行级识别状态；该行 invalid、confirmed_garment_id=null，没有正式入库。
- 自动审批拒绝了同一照片的诊断重试，要求明确授权再次发送及可能计费。该重试未提交；临时停止的常驻 worker 已恢复。其余 7 张未上传。

## 下一步与边界

- 获得一次诊断重试授权后，通过正常任务账本执行，并仅记录脱敏的校验位置/错误类型，定位问题后修复和回归，再继续剩余样本。
- 本轮没有应用源码修改，也未重跑离线回归。照片均为 PNG，不构成真实 HEIC、手机拍摄/文件选择、真机、Excel 或完整识别质量验收证据。
- 既有数据库、迁移、快照、账本与媒体保留；本轮新增导入草稿、任务、识别失败账本及衍生媒体。没有执行覆盖恢复。

## 后续授权诊断、修复与复验

- 用户明确允许一次诊断重试后，以新任务 `1416b151-eaf5-4cb6-9527-ae8a285140b1` 执行。临时暂停常驻 worker，使用相同 run_job、领取/租约、维护屏障与账本链路执行唯一排队任务；仅输出校验位置、类型及非法受控代码，未输出密钥、照片或完整响应。完成后恢复常驻 worker。
- 诊断仍失败：校验位置 attributes、类型 value_error，category 返回中文标签 `上装`，不在英文代码词表中。其他受控字段未发现非法代码。首次响应未保留，不能断言首次失败也是同一字段。
- 修复模型专用 JSON Schema，列出 category 与各多选字段的代码 enum；提示版本更新为 garment-vision-v2，明确 top/上装及 white/白色的代码/标签区别。严格校验、未知值和禁止字段边界保持；没有自动转换中文标签或重试。
- 用户另行明确允许修复后验证一次；任务 `b346c4ee-2c5d-4762-82f5-43c4e2854733` 成功。结果为 category=top、name=米白色长袖圆领T恤、color_codes=[beige]、style_codes=[casual,minimal]，季节/场合空数组，材质/厚薄/保暖为 null。与已查看的浅色长袖圆领上衣一致；仅为单样本观察，不代表整体准确率。
- 同一行账本共 3 条：v1 failed 两条、v2 received 一条。连续 GET 批次 3 次，analysis_status=succeeded、version=13、confirmed_garment_id=null，账本没有增加。未正式入库，其余 7 张仍未上传。
- 实际验证：provider 定向测试 15 passed；`docker compose --profile test run --build --rm test` 为 108 passed（32.28s）；Ruff 检查通过、mypy 73 个文件通过。测试使用独立测试数据库和 Fake/模拟 HTTP，未增加真实调用。
- 已构建并重新创建 api/worker/controller，健康检查通过；test-db 停止并保留数据卷。未变更数据库结构、公开接口或前端，未重跑浏览器/真机验收。
- 下一步：剩余样本识别质量、人工审核和真实搭配验收。当前只确认单张 PNG 真实识别链路成功；后续同图重试继续遵守明确授权和调用预算。

## 不同品类：剩余七张验收

用户明确要求继续不同品类验收后，上传文件名后缀 (1) 至 (7) 的七张 PNG，每张仅调用一次，没有重试。批次 `0f051d78-2433-4240-be71-8e50576b5c4d`，任务 `d26a761b-04c6-4d05-ad41-a6883f9afac1`，幂等键 `qwen-acceptance-20261027-remaining-seven`。回执与完整审核结果在忽略目录 results/seven-submit.json、results/seven-result.json。

| 文件后缀 | 目视主体 | 模型品类 | 颜色代码 | 核对结果 |
|---|---|---|---|---|
| (1) | 蓝色短袖上衣 | top | blue | 品类/颜色一致 |
| (2) | 深灰长裤 | bottom | gray | 品类/颜色一致 |
| (3) | 黑色 A 字半裙 | bottom | black | 品类/颜色一致；没有误判为连衣裙 |
| (4) | 棕绿调短夹克 | outerwear | brown | 品类一致；色调有棕/绿边界，模型提示光照偏色，需人工核对实物 |
| (5) | 米白色系带鞋一双 | shoes | white | 品类一致；模型提示可能是米白或奶油白，保留颜色审核 |
| (6) | 深蓝底白色碎花衬衫 | top | blue, white | 品类/颜色一致；简约标签依据偏弱，场合提示与预填有不一致 |
| (7) | 军绿色双口袋衬衫 | top | green | 品类/颜色一致；street 风格属于主观判断 |

- 七行 conversion/analysis/cutout 全部 succeeded（共 21 个步骤），analysis_source=qwen，row_status=ready。账本恰有 7 条 received，均为 garment-vision-v2，无错误码。
- 材质、厚薄、保暖全部 null，季节均为空数组；七行 confirmed_garment_id 均为 null，没有正式入库。脚本逐行断言以上状态及预期品类通过。
- 品类核对覆盖上装、下装、外套、鞋四类，共 7/7 与图片一致；加上首张，v2 共 8 个样本成功。累计真实请求 10 次（v1 失败 2 次，v2 成功 8 次），不能把小样本结果外推为整体准确率。
- 质量保留项：碎花衬衫 style_codes 包含 minimal，视觉依据偏弱；提示“季节与场合不明确，仅根据款式推测日常休闲”，却预填 daily，说明模型仍会猜测软属性。鞋的材质提示含“非皮革/帆布等”，措辞可能被误解为排除具体材质，尽管结构化材质为空。未经人工确认不作为确定事实；本轮不擅自修改模型结果或追加计费重试。
- 本轮仅通过实际 HTTP 导入与数据库账本验收，未修改应用源码，未重跑离线回归或浏览器测试。没有执行覆盖恢复、删除原媒体、清理账本或确认入库。照片全为 PNG，来源未核实，不能当作真机拍摄/HEIC 验收证据。
- 下一步先人工审核这些草稿（重点颜色、风格、场合及提示措辞），确认可用衣服后再开展真实搭配生成/局部替换验收；软属性保守性需作为后续改进项，不能宣布完整 P6 通过。

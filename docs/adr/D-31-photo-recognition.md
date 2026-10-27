# D-31 · 照片识别调用与恢复

日期：2026-10-26。状态：已实现，验证证据见 [本轮记录](../history/2026-10-26-p6-recognition.md)。沿用 P-07、D-21/D-22，不改变人工确认及未知属性规则。

- 新增识别专用 recognition_calls，以 (job_id, row_id) 为唯一调用单元；保留 outfit_model_calls。发送前持久化模式、模型、地址、提示版本及行/图片引用，秘密不入库。已有响应复用；sent 无响应视为未知，不自动重发。
- 照片批次最多 20 行，每行最多一次模型 HTTP 请求、120 秒；批次最多 20 次，无自动修正/传输重试。显式单行重试新建 Job，最多一次。搭配原有 4 次/300 秒预算不变。这是对导入批次预算的明确细化。
- 行级未知调用标 interrupted，其他行继续处理；父批次保留汇总并标 interrupted。失联 worker 仍由现有租约回收；已发送请求无法撤销，迟到结果不修改取消/已确认/已移除行。
- 独立 RECOGNITION_MODE 默认 disabled；明确启用 fake 或 qwen。搭配 PROVIDER_MODE 不再决定新照片识别，避免仅启用搭配就无意上传照片。共用后端百炼账户地址和密钥，模式独立。
- 模型仅输出品类、名称、颜色、季节、场合、风格及不确定性提示。材质、厚度、保暖性需用户补充；禁止生成可用状态、显示方式和自定义标签 ID。模型输出是待审核建议。
- 追加 0006_recognition，包含账本及行级提示；备份精确兼容标识升级，旧 P5 包不直接跨版本覆盖。保留原迁移、数据库和媒体；新版完整备份包含新账本。
- 视觉请求采用 Base64 image_url、关闭 thinking、JSON Object＋本地严格校验。官方协议依据：[视觉理解](https://help.aliyun.com/en/model-studio/vision)、[结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)。真实账号权限和效果仍需实测。

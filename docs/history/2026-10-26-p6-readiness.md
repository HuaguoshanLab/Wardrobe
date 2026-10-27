# 2026-10-26 · P6 接续核查与验收准备

## 本轮范围

从提交 `15e90fd` 接续，开始时 `git status --short` 无输出，未配置 Git remote。本轮仅核查源码、运行无网络识别分支探针并维护文档；没有更改应用代码、部署、数据库、迁移、媒体或控制卷，没有调用真实服务或执行覆盖恢复。

## 识别链路结论

真实照片识别未实现，不是仅缺账号验收。依据：

| 位置 | 实际行为 / 缺口 |
|---|---|
| [recognition.py](../../backend/app/providers/recognition.py) | recognize 只接受 fake，固定返回 category=top；disabled 与 qwen 均报 PROVIDER_NOT_CONFIGURED，不发 HTTP 请求 |
| [imports.py](../../backend/app/jobs/imports.py) | 照片依次转换、识别、去背景；Excel 只有转换/去背景。识别读取标准图，在事务外调用；结果经 Attributes 校验后按人工触碰/空值合并 |
| [import_review.py](../../backend/app/services/import_review.py) | 草稿版本检查、touched_fields、逐行确认及已确认行保护已存在；可继续手工入库 |
| [qwen.py](../../backend/app/providers/qwen.py) | 真实适配只接 Intent/ModelOutfits，发送结构化属性文本，没有视觉请求或识别输出 schema |
| [calls.py](../../backend/app/services/outfits/calls.py) | 搭配链路使用持久调用账本；识别未经过它，不能据搭配测试宣称识别具备同等调用恢复能力 |
| [imports.py](../../backend/app/jobs/imports.py) 与 [queue.py](../../backend/app/jobs/queue.py) | 导入捕获 AppError 后记为步骤 failed；若直接接入抛 CALL_RESULT_UNKNOWN 的真实适配，错误不会自然进入队列的 interrupted 分支，需要显式设计 |
| [import_submit.py](../../backend/app/services/import_submit.py) | 导入输入未保存识别模式/模型配置版本，识别执行时读取当前配置；真实接入需固定可追踪配置，秘密不进快照 |
| [system.py](../../backend/app/api/system.py) | 能力只有一个 model 配置状态，无独立识别能力；前端设置已注明千问用于搭配、照片仍需手填，不能称界面伪装识别成功 |

现有人工优先测试见 [test_imports.py](../../backend/tests/test_imports.py)：晚到识别不覆盖修改/清空、识别失败可手工确认、并发确认去重。这里只核查源码，未重跑这些测试。

还需解决批量预算：照片最多 20 张，一个父 Job 逐行识别；契约规定每运行最多 4 次模型 HTTP 尝试。真实适配必须明确按行调用单元与父批次的关系，不能简单加一个 HTTP 请求就算完成。

## 已执行验证

在根目录用 `backend/.venv/bin/python` 运行内联探针，通过 unittest.mock.patch 注入三种 Settings；qwen 使用 example.com 地址和非真实占位密钥，recognize 输入为占位字节。实际输出：

```text
fake fake {'category': 'top'}
disabled PROVIDER_NOT_CONFIGURED
qwen PROVIDER_NOT_CONFIGURED
```

该探针仅证明分支行为，不验证图片解码、网络协议、数据库或真实账号。占位字节被 Fake 忽略不是图片上传绕过证据，上传及转换有独立校验路径。

文档和差异检查结果在本记录末尾填写。未复跑 P1–P5 应用测试；原 83/14/14 等数字仍属于 P5 历史证据。

## 交付与下一步

- 新增 [P6 验收计划](../plans/P6.md)，覆盖 A-01 至 A-34 的入口、观察结果、外部条件、证据，以及容量/磁盘不足的隔离测试要求。
- 修正 DEVELOPMENT 中“P5 待提交”和 P2 仅待外部验收的歧义；P6 状态为准备中。
- 下一实现任务是补真实照片识别及其调用账本/中断语义，再做真实账号联调。真实凭据、真机和客户端样例尚未在本轮核验，不能标为已具备或已通过。

## 最终文档验证

- `backend/.venv/bin/python scripts/check_docs.py`：27 份 Markdown、174 个本地链接通过。
- 内联 Python 提取 P6 验收矩阵的 A 编号并与 A-01 至 A-34 集合比较：完整覆盖，无额外编号。
- `git diff --check`：通过。仅文档变更，无应用代码变更，未运行应用回归或容量测试。

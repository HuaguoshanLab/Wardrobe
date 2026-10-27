# 2026-10-27 · 审核页面轮询停止条件

- 用户观察已完成批次仍持续 GET。原因是 ReviewPage 固定 refetchInterval=2000，无终态判断；查询不创建模型任务，但产生无意义请求。
- 改为父任务或任一行 conversion/analysis/cutout 处于 queued/running/cancel_requested 时轮询；全终态停止。不能只看父任务：显式行级重试使用新 Job，父任务可能早已成功或失败。现有重试成功后的查询失效会重新读取并恢复轮询。
- 保留系统 capabilities 每 15 秒只读查询，用于维护态和恢复数据世代检测。窗口重新聚焦/重连等 Query 正常重取不等于固定轮询或付费生成。
- 新增测试覆盖终态/未请求停止、父任务无行时继续、各步骤在终态父任务下重试和再次结束；前端 21 项测试通过，typecheck、修改文件格式和 Docker Web 构建通过。只更新 web，无新增模型调用或数据库结构变更。
- 完整 E2E 未重跑，因为当前服务已启用真实千问，不运行会提交合成照片/搭配的 Fake 验收套件。
- 已用项目 Chromium 只读打开真实七张审核批次，页面加载后观察 17 秒：批次 GET 共 1 次，capabilities 共 2 次，写请求 0 次，pageerror 0。首次使用默认 headless shell 启动因未安装该二进制失败，随后按项目配置 channel=chromium 验证通过，未安装新浏览器。

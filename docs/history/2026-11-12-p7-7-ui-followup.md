# 2026-11-12 · P7.7 模板编辑与恢复交互优化

状态：已实现、完整验证并保留数据部署至 `http://localhost:8088`，入口“搭配条件 → 条件模板”。用户明确指定P7.7常用搭配条件模板，本轮保持已部署P7.8、P7.9及其他未提交改动。范围见 [P7.7](../P7-7.md)。

## 实现

- 放弃模板编辑草稿增加明确确认；默认焦点落在“保留草稿”，取消不清除本地输入，确认后才清除并回到搜索。
- 读取最新版本不再直接更新编辑起点。发现版本变化时，展示最新名称、五类条件和失效提示，保留上方人工输入；用户核对后才更新expected_version，再点保存才提交。取消保持旧版本，仍受后端冲突保护。读取失败就近反馈，输入保持，读取期间不允许确认旧对照内容。
- 编辑区按穿着场景、补充条件、轮换分组，无标签时不显示空选择组，补充要求显示字数。固定操作栏缩短返回按钮文案，保留无障碍名称中的草稿含义；使用已有浅色/绿色变量，不新增依赖或导航。
- 最新内容获得焦点并滚动到可读位置；取消/确认后等待公共弹层完成对被移除控件的焦点恢复，再交接到操作按钮。原有正常动画/减少动画、搜索、失效修正与明确选用保持。

采用项目ui-ux-pro-max的表单错误与React焦点定向建议，按现有H5设计约束实现。没有更改接口、数据库、迁移、生成语义、模型或天气配置。

## 验证与问题修复

初次构建发现新增组件测试误用了Playwright的exact参数，已修正。首轮真实浏览器6项通过、10项焦点断言失败，定位为公共弹层在下一帧恢复已移除控件焦点，覆盖单帧主动交接；改为沿用现有双帧交接并复测。组件焦点断言同步等待异步交接，不删除失败场景或放宽目标。

- 最终前端完整134项（35文件）通过，包含草稿确认和最新版本对照/取消/明确保存新增场景。类型检查、生产构建和格式检查通过。
- 模板浏览器16项通过：桌面与Pixel7模拟、320×568/375×667/844×390/1280×900、长文本、保存栏、列表/草稿/版本恢复、慢网、读取失败、零写请求及正常/减少动画焦点。截图复查覆盖小屏编辑和手机版本对照。
- 完整业务浏览器34项通过（2.6分钟），覆盖模板创建/更新/删除、丢响应同键恢复、明确生成及P7.8/P7.9等既有流程。部署后同一模板界面16项只读/模拟检查通过（45.6秒）；真实API写请求全部拦截。
- 文档链接、493个手写文件规模与依赖边界、`git diff --check`通过。修正PRODUCT页首和DECISIONS索引仍停留P7.7/P7.8的状态，使其与DEVELOPMENT中已完成P7.9的事实一致。

实际命令（frontend目录，Node24.19.0）：

```sh
npm test -- --maxWorkers=2
npm run build
npm run format:check
E2E_BASE_URL=http://localhost:8109 npx playwright test -c playwright.templates-ui.config.ts
P7_ISOLATED_REGRESSION=1 E2E_BASE_URL=http://localhost:8109 npx playwright test -c playwright.p7-9.config.ts
```

日志、源码/构建摘要、镜像核对、截图和备份保存在忽略目录 `data/acceptance/p7-7-ui-followup/`。隔离环境复用wardrobe-p7-9内网Fake栈，业务回归与界面检查串行执行；正式数据不写测试模板。后端174个文件与已部署P7.9镜像摘要一致，本轮不重复后端384项测试。

## 部署与数据保持

- 完整备份：`data/acceptance/p7-7-ui-followup/pre-release-ea2bef0e-9b59-4ad9-9ddb-89bc33046af8.zip`，246,026,438 bytes，SHA-256 `29579d1d86f9626dc61626f10693e37d94a9be98bae3e2e008f7ddc299297a6f`；已下载并通过ZIP完整性检查。
- 候选镜像基于已发布P7.9 Web及相同锁定依赖，仅覆盖构建产物；102个静态文件与本地构建摘要逐一匹配。最终镜像 `wardrobe-p7-7-ui-followup-web:local`，SHA-256 `e4a961749d352ad6e49493127f511dc33416d2072bf4fcbd6c6ae6fdbaf699a3`。
- 通过 `docker compose -f compose.yaml -f data/acceptance/p7-7-ui-followup/web.override.json up -d --no-deps --no-build --wait web` 仅更新Web并通过健康检查。同步 `wardrobe-web:local` / `wardrobe-web:latest`；保留上一版 `wardrobe-p7-9-web:local` 供前端回退。
- 未执行正式迁移、初始化、恢复或清理。db/api/worker/controller的容器ID、镜像及挂载保持；三个原卷 `wardrobe_postgres_data`、`wardrobe_media_data`、`wardrobe_control_data`保持。
- 初始、备份后、部署后和最终验收后的41张表（含迁移表）及436个媒体文件摘要完全一致，迁移仍为0015_reference，0活动任务；没有正式模型调用、模板或其他测试数据写入。
- 隔离验收栈已停止，专用卷和证据保留。部署后16项界面检查使用真实读取或模拟数据，不是正式数据创建/修改验收；完整写入流程在独立Fake栈完成。

## 限制与下一步

本轮零真实模型调用。Chromium桌面和手机视口不等于iOS/Safari真机、原生软键盘或屏幕阅读器实测。下一实现阶段仍为P7.10，本轮不提前开始；未提交Git。

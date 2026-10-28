# 2026-10-28 · 移动端异常内容修复

## 完成

按用户“修复”要求处理 [异常检查](2026-10-28-mobile-content-audit.md) 的三个缺陷，对应 P-15/P-21 的展示与移动端体验；没有更改产品范围、API、后端或快照数据。

- M-01：公共弹窗标题允许 flex 收缩及连续英文换行，关闭按钮不压缩。保留完整标题，正文仍可滚动。
- M-02：今日穿搭图片与详情共享当前单品的加载失败状态，空地址或加载失败都显示“图片暂不可用”；详情图片失败也同步更新缩略图。切换方案不会把失败状态带给另一个单品。属性、锁定和替换入口保持可用。
- M-03：天气气泡保持 60px 圆形，温度不拆行，未知温度使用紧凑字号，长天气在单行内显示省略号；“搭配说明”保留完整天气和生成时快照提示。

## 验证

使用项目 Node 24.19.0，命令在 frontend 下执行（Docker 命令在根目录）。测试截图及 trace 输出到忽略目录 `data/acceptance/content-fixes/`。

- `npm test`：52 项通过。新增详情图片失败、主页同步占位及切换方案隔离验证。首轮新测试在模态面板打开时查询背景按钮，被正确的无障碍隔离隐藏；改为关闭面板后检查背景占位，再全套通过。
- `npm run format:check`：通过。
- `docker compose up -d --build --no-deps web`：生产构建（含 `npm run typecheck`）与本地 Web 部署成功。
- `./node_modules/.bin/playwright test -c playwright.content-audit.config.ts --output=../data/acceptance/content-fixes/results --reporter=line`：28 项全部通过（320×667、375×812、430×932、812×375 横屏）。此前 16 次跨视口失败已消除。
- `./node_modules/.bin/playwright test -c playwright.ui.config.ts --output=../data/acceptance/content-fixes/ui-results --reporter=line`：54 项全部通过，覆盖桌面及移动端正常流程、弹窗、草稿与只读浏览。
- 根目录 `backend/.venv/bin/python scripts/check_structure.py`、`backend/.venv/bin/python scripts/check_docs.py`、`git diff --check`：通过（217 个手写文件、65 份文档/317 个链接）。
- 已查看 320px 长英文标题、375px 长天气和缺图截图，标题完整换行、关闭入口可见、天气无越界、破图已替换为占位；`docker compose ps web` 确认容器 healthy。

原异常测试的失败标准保留，增加天气左右边界、完整天气可读取、缺图详情和关闭按钮触控尺寸检查。图片测试不再等待破图持续存在，改为断言占位出现且破图移除。

## 边界与下一步

浏览器写操作拦截或模拟，没有真实上传、生成、收藏、恢复或计费模型调用。未修改数据库与媒体；只更新 Web 服务。Chromium 视口回归不等于 Android/iOS 真机；有设备后继续验证软键盘、Safari 气泡渲染及系统返回，其他工作按日常使用反馈推进。

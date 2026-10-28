# 2026-10-28 · 穿搭记录卡片收紧

## 完成

按用户反馈，缩小历史、收藏、日历共用记录卡片。手机改为左侧 112px 缩略图、右侧标题与时间，下方保留 44px 点击高度的操作行；三件搭配预览约 128px 高。标题与穿着备注最多两行，完整内容在详情查看。桌面缩小预览图片和内边距。样式限定 records-page，不影响详情大图和确认弹窗；不改变数据、接口和操作语义。

## 验证与边界

- `docker compose up -d --build --no-deps web` 成功，包含类型检查及生产构建，已部署 8088。
- `npx playwright test --config=playwright.ui.config.ts records-ui.spec.ts` 最终 6 项通过；覆盖历史/收藏/日历、详情返回、草稿、操作弹窗，并增加手机普通卡片高度小于 220px、操作按钮至少 44px 的检查。
- `npm run format:check`、结构（217 文件）、文档（63 文档 / 312 链接）与 `git diff --check` 通过。
- 查看最终手机截图，存于 `data/acceptance/records-compact/history.png`。

浏览器只读或模拟写入，不更改真实数据；未做 iOS 真机验证。下一步根据实际列表浏览反馈调整密度。

## 用户反馈后的调整

用户不接受左侧小拼图与右侧大空白，改为单品图片等高横向排列，每行三件，多余单品换行且不隐藏。标题、时间紧接图片下方，保留紧凑操作行。取消三件搭配首件跨行；详情与弹窗仍使用原预览。回归增加首行三张图顶部一致断言。

横排验证：Docker 构建（含类型检查）和部署成功；`npx playwright test --config=playwright.ui.config.ts records-ui.spec.ts` 6 项通过，包含三张图片同排、普通卡片小于 220px、按钮触控尺寸及详情/弹层回归。格式、文档、diff 检查通过。已查看最终手机截图，存于 `data/acceptance/records-image-row/history.png`。

# 2026-10-28 · 今日穿搭布局调整

## 完成

按用户手机截图反馈，保留暖白/深绿配色，今日穿搭从纵向单列改为双列拼版：上衣、鞋在左，长裤或连衣裙在右，额外单品顺排，单件单独居中。图片保持 contain，不裁掉服装。方案切换收成分段控件；保存状态、生成时天气、衣服和说明统一放进展示卡。收藏与记录穿着为辅助按钮，选用/调整作为唯一实色主操作，重新搭配保留描边。窄屏复查发现吸底操作栏遮住辅助按钮下沿，已取消首页操作区吸底并补充几何回归断言。

保留只读预览、左右滑动、真实快照、不可用与锁定状态、原弹窗及显式操作语义。整理旧 CSS 的重复移动端覆盖，没有新增生成请求或接口。

## 验证

- `docker compose up -d --build --no-deps web` 成功；包含 TypeScript 检查和生产构建，已部署到本地 8088。
- `npm test`：16 文件 / 51 项通过。
- `npx playwright test --config=playwright.ui.config.ts ui.spec.ts --project=mobile-chromium`：22 项通过（文件名匹配包含 imports/records/settings/wardrobe UI）；涵盖今日穿搭首屏、滑动、收藏、记录、调整、单品和条件页。
- `npx playwright test --config=playwright.ui.config.ts --grep 'outfit composition'`：2 项通过；两个浏览器项目各检查 320、375、430 宽度全部方案，图片加载、触控尺寸、水平溢出、操作栏与导航间距。375 宽三套截图保存于 `data/acceptance/today-layout/`。
- 取消吸底后重新构建部署；`npx playwright test --config=playwright.ui.config.ts --grep 'outfit composition|H5 puts|stage sheets|today sheets'`：最终 8 项通过，包含辅助操作与主操作不重叠断言。
- `npm run format:check`、结构检查（215 文件）、文档检查（61 文档 / 309 链接）和 `git diff --check` 通过。

## 限制与下一步

浏览器检查拦截真实业务写请求，确认行为使用已有模拟测试；没有调用真实模型或改写衣橱。检查的是 Chromium 移动视口，未声称 iOS Safari 真机验证。后续按实际使用反馈微调，不扩展产品范围。

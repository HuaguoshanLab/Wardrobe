# 2026-10-28 · 单列穿搭与侧边操作

## 完成

用户明确不接受双列拼版，本轮替换为单列衣服展示。上装、外套/裙装、下装、鞋、其他配饰依次排列；照片保持 contain，去掉每件独立底色卡片与重复放大图标，保留锁定和不可用标记。右侧工具栏放收藏、记录穿着、搭配说明及提醒数量，图标配文字，主操作留在底部。工具栏占独立列，不悬浮遮挡衣服；全页保持暖白/深绿。

收藏反馈和不确定请求的恢复提示通过独立全宽反馈区域展示，避免窄侧栏挤压重试按钮。单品详情、收藏、穿着、调整及说明仍复用现有弹层，预览/刷新不触发生成。

## 验证

- `docker compose up -d --build --no-deps web` 成功，包含类型检查和生产构建，本地 8088 已更新。
- `npm test`：16 文件 / 51 项通过。
- `npx playwright test --config=playwright.ui.config.ts --grep 'outfit composition|H5 puts|stage sheets|today sheets|collection and wear'`：10 项通过，覆盖两个 Chromium 项目、三套现有方案、320/375/430 宽度，断言图片单列中心一致、侧栏不与照片相交、底部按钮可滚动到导航上方；验证滑动、弹层焦点、收藏/穿着提交与反馈。
- 检查了最终手机截图，保存于 `data/acceptance/today-column/scheme-1.png` 至 `scheme-3.png`。
- 格式、结构（215 文件）、文档（62 文档 / 310 链接）和 `git diff --check` 通过。

## 边界与下一步

浏览器测试拦截真实写请求，确认操作使用模拟响应；不请求真实模型，不改写业务数据。Chromium 移动视口不代表 iOS 真机。下一步根据实际使用反馈调整间距与图片比例。

## 同日追加 · 全部操作收进侧栏

用户要求把重新搭配、调整这套也放入工具栏。两项操作已移至侧栏下半部，分隔线区分辅助与搭配操作；调整/选用保留深绿背景与图标文字。取消底部按钮栏，保留原条件页、调整弹层和显式选用语义。窄屏检查增加侧栏归属及旧按钮栏不存在的断言。

追加验证：重新部署构建成功；`npm test` 51 项、同一浏览器专项命令 10 项通过，格式/结构/文档/diff 检查通过。最终三套手机截图在 `data/acceptance/today-toolbar/`。

## 同日追加 · 放大衣服与收紧间距

按用户反馈，提高单列图片展示高度约 16%～20%，移除图片四周 4px 内缩；收紧标题、展示卡、天气摘要及单品之间的布局留白。保留 contain，不裁切图片，不改变工具栏及业务操作。

本次验证：Docker 生产构建与类型检查通过并部署；`npx playwright test --config=playwright.ui.config.ts --grep 'outfit composition|H5 puts'` 4 项通过，覆盖 320/375/430 宽度及首屏操作；样式格式、文档和 diff 检查通过。截图保存于 `data/acceptance/today-larger/`。

## 同日追加 · 侧栏按钮比例修正

用户指出主按钮文字贴边、胶囊形状难看。手机侧栏宽度从 60px 改为 72px，主操作可用宽度从 46px 增至 62px；侧栏圆角从 36px 收为 20px，主按钮圆角 12px。保留单列和全部侧边操作。

比例修正验证：Docker 构建（含类型检查）并部署成功；`npx playwright test --config=playwright.ui.config.ts --grep 'outfit composition'` 两个项目通过，覆盖 320/375/430 宽度及三套方案；格式、文档与 diff 检查通过。最终截图在 `data/acceptance/toolbar-proportions/`。

## 同日追加 · 天气气泡

按用户要求把横排天气改成衣服展示区左上方浅绿圆形气泡，去掉天气分隔线，保留“生成时”标识、温度与天气文本，不请求实时天气。

天气气泡验证：Docker 构建和部署成功；`npx playwright test --config=playwright.ui.config.ts --grep 'outfit composition|H5 puts'` 4 项通过，覆盖 320/375/430 宽度及首屏。格式、文档、diff 检查通过；检查最终手机截图，气泡与衣服分离，截图在 `data/acceptance/weather-bubble/`。

## 同日追加 · 天气脱离整行布局

天气气泡改为展示区左上绝对定位，缩为 60px；只在衣服列顶部保留 64px 防遮挡空间，不再撑高整行，工具栏独立上提。衣服图片大小保持，回归补充天气与衣服不相交、侧栏起点不在天气下方的断言。

浮动布局验证：Docker 构建（含类型检查）和部署成功；`npx playwright test --config=playwright.ui.config.ts --grep 'outfit composition|H5 puts'` 4 项通过，覆盖 320/375/430 宽度和首屏；天气与图片边界不相交、侧栏不在天气下方的断言通过。格式、文档、diff 检查通过。最终截图在 `data/acceptance/weather-floating/`。

## 同日追加 · 透明肥皂泡质感

按用户参考图把天气的实色圆片改成 CSS 透明球面：多层径向渐变、薄边缘、顶部椭圆高光、底部弧形反光与轻阴影。保持原尺寸、位置和文字对比度，不添加背景图或动画。独立 `weather-bubble.css` 管理该视觉职责。

透明质感验证：Docker 生产构建（含类型检查）与部署成功；`npx playwright test --config=playwright.ui.config.ts --grep 'outfit composition'` 2 项通过，覆盖三种窄屏和全部方案。检查最终截图；格式、结构（216 文件）、文档及 diff 检查通过。截图在 `data/acceptance/weather-glass/`。

## 同日追加 · 三列顶部对齐

用户指出衣服仍低于天气和工具栏。删除衣服列 64px 顶部避让，改成天气/单列衣服/操作栏三个同排网格，统一顶部起点，依靠列间距隔离内容。手机天气 52px，工具栏仍 72px；宽屏天气 60px。回归断言改为三者顶部一致、气泡与图片左右不相交，替换此前纵向避让断言。

对齐验证：Docker 构建（含类型检查）与部署成功；`npx playwright test --config=playwright.ui.config.ts --grep 'outfit composition|H5 puts'` 4 项通过，覆盖 320/375/430 宽度和三套方案；三者顶部差小于 1px、气泡与图片边界不重叠。检查最终截图，保存在 `data/acceptance/today-aligned/`；格式、文档、diff 检查通过。

## 同日追加 · 轻薄皂膜

按用户明确的透明肥皂水泡描述，取消厚内阴影、绿色环状填充及实心高光块；采用中性透明径向渐变与柔和薄亮边，内部透出页面背景，无彩虹或彩色光晕。两颗 20px/11px 小泡在天气列内错落分布，无点击行为，不占衣服空间；天气信息与三列对齐保持。

皂膜验证：Docker 构建（含类型检查）与部署成功；`npx playwright test --config=playwright.ui.config.ts --grep 'outfit composition'` 2 项通过，覆盖 320/375/430 宽度、全部现有方案及对齐/遮挡检查；格式、文档与 diff 检查通过。检查最终截图，保存于 `data/acceptance/weather-soap/`。

## 同日追加 · 皂膜弧光与文字比例

用户认为上一版仍不好看。修正线圈过淡、缺乏弧面的问题：采用中性明暗交替的遮罩细边和局部白色弧光，中心保持透明；手机主泡从 52px 调为 60px，字号恢复 9px/17px，小泡靠近并错落分布。无彩虹色、重内阴影或动画；三列顶部对齐仍保留。

弧光调整验证：Docker 构建（含类型检查）与部署成功；`npx playwright test --config=playwright.ui.config.ts --grep 'outfit composition'` 两个项目通过，覆盖 320/375/430 宽度、三套方案与对齐/遮挡；格式、文档、diff 检查通过。查看最终手机截图，保存在 `data/acceptance/weather-film-refined/`。

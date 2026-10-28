# 衣序 · 界面设计约定

2026-10-27，针对用户反馈的样式、交互和体验问题优化。范围仍以 [PRODUCT](../PRODUCT.md) 为准，重点对应 P-12、P-15、P-16、P-21、P-22；接口和业务语义不变。

## 技能来源与项目级安装

上游：[nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)，本次固定提交 `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03`。

仅安装 `.claude/skills/ui-ux-pro-max` 子目录到本项目 `.agents/skills/ui-ux-pro-max`，使用系统 skill-installer 的 `install-skill-from-github.py`，显式指定 `--ref` 与 `--dest`。没有安装全局 npm 包、全局技能或修改系统配置。项目 `.agents` 被 Git 忽略；克隆代码不会自动带上技能，需从同一来源恢复。技能文件保持上游原样。

UI 工作读取本地 `.agents/skills/ui-ux-pro-max/SKILL.md`。本轮实际使用：

```sh
python3 /Users/mina/Documents/ai-about/Wardrobe/.agents/skills/ui-ux-pro-max/scripts/search.py 'personal wardrobe fashion minimal' --design-system -p Wardrobe
python3 /Users/mina/Documents/ai-about/Wardrobe/.agents/skills/ui-ux-pro-max/scripts/search.py 'personal inventory dashboard' --design-system -p Wardrobe
python3 /Users/mina/Documents/ai-about/Wardrobe/.agents/skills/ui-ux-pro-max/scripts/search.py 'progressive disclosure forms' --domain ux -n 3
python3 /Users/mina/Documents/ai-about/Wardrobe/.agents/skills/ui-ux-pro-max/scripts/search.py 'progressive disclosure' --domain web -n 2
python3 /Users/mina/Documents/ai-about/Wardrobe/.agents/skills/ui-ux-pro-max/scripts/search.py 'forms state accessibility' --stack react -n 3
```

检索到 Minimalism/Swiss、Flat Design 和 React 受控表单/语义控件建议，采用清晰层级、轻量视觉、语义交互原则。两次设计系统的营销页面结构均不适合现有业务应用，不保存为权威设计。复杂条件折叠检索没有可靠匹配，采用技能 quick-reference 的 progressive-disclosure 通用规则。没有将无匹配结果伪称为数据推荐。

## 视觉与组件

- 暖白背景 `#f7f7f2`、白色表面、深绿主操作 `#294f40`、正文 `#273b32`、次级文字 `#626d65`；错误色 `#a3312c`。全局语义变量在 `frontend/src/app/shell.css`。
- 保留中文系统字体，不依赖外部字体服务。正文基准 16px，说明 14px，辅助信息 12px；小号字仅品牌英文、眉题和底部导航。
- 页面标题 28–36px；卡片圆角 16–18px；常用间距 8/12/16/20/24/32px；主要控件至少 44px 高。
- 延续 Lucide 图标；有文字的装饰图标不重复朗读。按钮有 hover、pressed、disabled、focus 状态；遵循 reduced-motion。
- 760px 以下固定底部五项导航，保留安全区和正文底部空间；更宽屏幕使用侧栏。详细页和录入页保持所属导航选中。
- 衣橱样式与导入/审核样式分开维护；搭配卡片样式由收藏页显式加载，直接打开页面也必须一致。

## 信息与交互

- 首页及 `/outfits/:sessionId` 采用图片优先的单套展示；一次显示一套，方案按钮切换本地预览。只有点击“选用这套”才保存服务端选择，浏览/刷新不生成。
- 手机首屏展示真实衣服图片，未拥有建议单独以文字呈现；不得补造衣服或模特图。显示结果保存日期，避免把旧结果冒充今日新生成。
- `/outfits/prepare` 与 `/outfits/:sessionId/prepare` 承载条件；天气与城市折叠在表单后。提交获得明确生成任务响应后返回对应结果页，未确认请求仍保留原幂等键，打开子页不提交。
- “调整这套”在当前穿搭页打开底部面板，仅显示所选方案的紧凑单品列表、锁定、局部替换、重搭、聊天与消息记录。复用当前页面控制器与会话版本；查询参数 `adjust=1` 恢复面板打开状态，不生成。旧 `/outfits/:sessionId/edit` 重定向到对应穿搭页并打开面板。
- 用户确认保留现有背景；上装/下装/鞋履纵向组成展示台，配饰侧排，使用已有真实图片。天气、说明与收藏入口位于侧边，底部突出“换一套”（进入条件页）及调整/选用。
- 今日穿搭顶部不再重复展示“搭配条件”，已有搭配仅通过“换一套”进入条件页；没有搭配时保留“准备搭配”空状态入口。
- 横向滑动和方案按钮均可只读预览，纵向滚动不切换。单品与说明使用公共 Base UI 底部面板，支持关闭、Escape、焦点恢复与内部滚动；点击单品仅查看快照，明确替换复用原 replace_items 操作。锁定或未选用方案中的单品不能直接替换。失效提示保留，未满足项计数可见。验证见 [展示台记录](../history/2026-10-27-outfit-stage.md)。
- 手机移除重复顶栏标语和页脚；保留五项底部导航与安全区。子页有明确返回入口，路由滚动位置通过 React Router ScrollRestoration 管理。
- 衣橱采用左侧固定品类、顶部固定季节，衣服列表和品类栏各自滚动；保留双列图片及现有背景。搜索常驻，场合/状态/标签收进“筛选”底部面板，即时应用并显示额外条件数量。
- 衣橱筛选写入 URL，详情返回恢复筛选；切换条件清空分页游标并回到列表顶部。筛选无结果与真正空衣橱采用不同说明和恢复入口。加载骨架、失败重试和清除筛选都有实际行为。
- 录入区显示“选择文件 → 检查与修改 → 确认入库”，不暗示上传即入库。
- 设置首页只保留“图标＋名称＋右箭头”的四行入口，保留现有配色。偏好、城市、备份恢复、服务诊断分别进入二级页；统一 header 包含返回箭头与页面名称，返回目标固定为设置首页，直接访问或刷新也可返回。天气的“更换城市”直达城市二级页。
- 搭配条件和录入衣服也使用相同的公共 PageHeader；前者返回对应会话穿搭（无会话路径则返回首页），后者返回衣橱。移除这两页原先分离的返回文本和大标题，保留原表单、提示及录入步骤。

首轮证据见 [开发记录](../history/2026-10-27-ui-refresh.md)，H5 图片优先改造见 [后续记录](../history/2026-10-27-h5-lookbook.md)。这些是工程设计默认，不新增产品能力。

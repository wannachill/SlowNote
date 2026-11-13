# 一迈一记前端规范
> 原生 WXML/WXSS/JS；源码 miniprogram/，不引入 UI 框架。
> 更新日期：2026-11-12

## 1. 设计语言
极简、留白、系统字体/PingFang SC 优先。操作与内容只使用中性色与一种强调色（随所选主题色变化，见 §3）；页面背景允许 §3 定义的主题渐变，不延伸到卡片、弹层或控件。不得新增其他渐变、阴影堆叠、Emoji、玻璃效果或无关插画。
首页以宝宝信息与日期为轴：昵称左对齐，月龄在下；周历七等列、今标记与记录点；下方为当日卡片。允许展开月历，不采用多组页面内 Tab。首页不放重复的问小迈按钮；问答入口位于「小迈」Tab。
首页/小迈/我的三页顶部标题区高度统一（176rpx），标题与副标题左对齐、字号字重行高一致，切换 Tab 无高低跳变。三页标题区**均不设独立背景色**，整页只由 `--bg-mesh` 主题渐变贯通（渐变底色 `--bg-mesh-base` 为白色），不出现纯色块与渐变拼接形成的分割线；`app.wxss` 的 `.page-top-heading` 只保留 `margin-bottom: var(--space-m)`，32rpx 留白使首个内容块三页对齐。小迈页 `.statistics-header` 不使用 sticky（页面级滚动 + 原生下拉刷新，固定标题必须铺不透明背景才能遮住滚动内容，会重新引入分界线），标题随页面滚动；小迈页提示语「问一句，一眼看懂宝宝的成长。」位于标题下方、不与日期范围筛选同行。小迈页日期范围筛选位于「宝宝概况」标题行右侧（section-heading 内、与标题垂直居中），不占用顶部标题区，保证标题与副标题和「我的」页精确落在同一水平线上；筛选器以「当前范围 + 下拉箭头」的纯文字控件呈现，无底色、无圆角，文字用 `--color-text-2` 与 medium 字重，保留 `--control-height` 点击热区，不使用 `--color-field` 背景与 `--radius-round`（后者为 50%，会拉成椭圆胶囊）。成长/喂养为多项指标卡，统一三列：标签｜数值+单位｜环比变化，变化不重复单位；其余为单指标卡。
唯一悬浮操作为圆形“＋” FAB（无文字，加号线条用 --stroke-strong 加粗）；类目面板为三列线性图标网格（SVG mask，milk/food/droplet/ruler/book/brush）。小迈主页面顶部使用不预填问题的搜索框式问答入口；只显示选定范围内有记录的概况卡，不显示无记录类别。整体无数据时用嫩芽 SVG mask、简短说明和「去首页记一笔」主按钮引导登记，不显示空的概况卡片区。
固定三导航：首页/小迈/我的。custom-tab-bar 用 SVG mask 线性图标（home/logo/mine，Lucide 风格）+ 文字，选中态强调文字色并加粗图标线条（--stroke-strong）；底栏使用 `var(--bg-mesh-base)` 不透明背景且无顶部分隔线，`.tab-track` 至少为 `var(--tab-height)` 高，`.tab-item` 垂直居中，底部 padding 仅保留 `env(safe-area-inset-bottom)`，不依赖位图图标。项目有全局 `box-sizing: border-box`；无顶线是既定视觉规则，不是为规避盒模型补偿。我的页为入口列表形态（登录卡 + 主题设置/小迈设置/定时报告/历史报告四个入口 + 退出登录），配置统一在对应子页面（pages/theme、pages/ai-settings、pages/ai-tasks、pages/ai-notifications）完成，不在我的页内直接展开表单。原「信息推送」中转页已删除。
品牌标识 miniprogram/assets/icons/logo.svg（sparkles 星光）：我的页档案卡以 SVG mask 渲染，颜色 --color-accent-ink（浅色 #2e6da6 / 深色 #a8c8e8，随主题自适应）；原 images/logo.png 已无引用。男孩/女孩默认头像为 images/boy.png、images/girl.png，随宝宝性别动态切换，支持用户上传照片覆盖。
站内提示统一为「独立提示卡」：淡主题色底 `--color-accent-soft` + 左侧 `--hint-bar-width` 主题色竖条（`--color-accent-ink`）+ 圆角与阴影，用于宝宝信息页、定时报告页、常见问题页；提示卡与下方卡片**等宽**（只受页面 32rpx 内边距约束，不额外加左右 margin）。提示卡不再以卡片内灰色 `form-note` 内嵌呈现。**定时报告页已移除「微信通知」订阅卡与「开启通知」按钮**（`.subscribe-card` / `.subscribe-btn` 均不再存在），改为一句话的关键行为说明（默认存站内、可单独开启微信推送），不写「可添加/编辑/删除」等界面自明的操作（§4.1）；微信通知由每个任务卡片上的原生 switch 控制（`notify`，乐观更新、不弹 toast、不刷新列表），switch 自身加 `data-no-swipe` + `catchtouchmove` 防滑动，祖先不拦截原生组件。报告任务卡片只展示报告标题、频率与时间、异常时才显示 `status-tag`，不展示数据类型、北京时间与数据范围；列表行统一 `--row-height` 最小高度、`gap: var(--space-xs) var(--space-sm)`、标题 `--font-body`、副行 `--space-xs` 上间距与原生 switch 右对齐；左滑动作区共用 `--swipe-action-width`。

历史报告页（pages/ai-notifications）为报告列表：卡片两行布局——首行标题（取 `report_title`）与右侧发送时间，次行左侧微信渠道短标签（`微信已送达`/`站内信`/`微信未送达`，彩色 `status-tag`）、右侧实心主题色「未读」标签；**不展示正文预览、数据类型与「站内通知」全称**。点击卡片弹出详情面板（`--sheet-max-height`（84vh），固定头部、正文独立滚动、打开即标记已读，详情区时间与状态标签垂直居中对齐），左滑露出「删除」（宽度为 `calc(var(--swipe-action-width) / 2)`，与常见问题单个动作等宽；二次确认后调用 `aiNotifications` 的 `remove`）。我的页入口自上而下固定为：主题设置、小迈设置、定时报告、历史报告。底栏「我的」Tab 不展示未读数字角标（未读数只在报告卡片上以「未读」文字标签呈现）。**添加报告的「数据类型」选择与「新增常见问题」一致**：「数据类型」标题行 + 右侧「全选/取消全选」链接 + 流式 pill 标签（`task-category-*`，对齐 `question-category-*`），不再用三列网格；`allSelected` 状态与 `toggleAllCategories` 联动。定时报告的数据范围是单选且文案短，用 `range-chips` 一行等宽 chip（`flex: 1 1 0`、`--font-caption`、不换行），下方 `range-hint` 说明「重叠 / 漏记」后果；月度任务隐藏范围区并回落到跟随频率。

## 2. 全局 token 与尺寸
- 颜色、字号、间距、圆角、控件高度、层级均定义于 app.wxss；页面 WXSS 只做编排并引用变量。
- 系统字体，常规/中等字重；字号令牌 caption 28rpx / body 30rpx / control 32rpx / title 34rpx / heading 44rpx / data 52rpx / brand 48rpx，面向大众小程序可读性（caption=14px 为最小可读下限，禁止更小）。字体栈 -apple-system → PingFang SC → HarmonyOS Sans → MiSans → 微软雅黑，适配各系统中文渲染。数字 tabular-nums，表单控件显式继承。
- --control-height=max(88rpx,44px)，--input-height=max(96rpx,44px)，--entry-height=208rpx，--fab-size=max(112rpx,56px)；按压 --press-scale .98 / 主按钮 --press-scale-primary .96 / --opacity-pressed .76。周历使用全宽外扩布局，使 320px 宽仍满足每列至少 44px。
- 首页当日记录使用单列全宽槽位，时间轴节点与卡片按 `--rail-gutter` 留出左侧轨道，时刻位于卡片上方；图标、名称、数值与信息项放在卡片内。`--timeline-width` 仍供日记等既有时间轴布局使用，不作为首页轨道宽度。三等分成长输入；图像正方形。安全区使用 env(safe-area-inset-bottom)。
- tab 层与 sheet 层分离。首页弹层显示时隐藏自定义 tabBar，关闭/离页恢复；TabBar 固定贴底，只保留系统安全区，按钮触控高度至少 `--control-height`；紧凑栏高使用 `--tab-height: max(96rpx, 48px)`，页面及滚动区底部预留 `--tab-height + env(safe-area-inset-bottom)`。首页 FAB（pages/index .record-fab）位于导航之上：bottom = calc(var(--tab-height) + var(--space-ml) + env(safe-area-inset-bottom))，与 tabBar 保持清晰间距、互不遮挡；首页 `.home-results` 额外预留 FAB 高度与间距。
- 滚动分区（2026-10-29）：首页宝宝信息、日期条与当天标题固定，只在 `.home-results` 中滚动记录；小迈 Tab 为页面级滚动，`.statistics-header` 随页面滚动（不 sticky、不设背景，避免与主题渐变拼接出分割线），安全区与 `--tab-page-top` 偏移写在头部 padding 内，原生下拉刷新保留。统计详情页 `.chart-body` 用 flex 分为左侧 `.chart-plot-viewport` 绘图区与右侧固定纵轴栏，`bindtap` 绑在该绘图区；Canvas 位于 `.chart-scroll`（scroll-x）外并固定为视口宽，与滚动层同处绘图区内，滚动层只包含宽度为 `chartWidth` 的透明占位层；当天明细置于 `.detail-scroll`（scroll-y）内纵向滚动，根容器 `.detail-fixed` 为 100vh + overflow:hidden 不滚动，整页禁用下拉刷新。Canvas 2D 是原生绘制层，父级 WXSS 的 overflow / clip-path 无法可靠裁剪；`utils/chart.js` 的 `drawFrame()` 以逻辑宽 `chartWidth` 布局，固定裁剪 `[0, viewWidth]` 后平移 `-viewOffset`，不依赖原生 canvas 位图是否随滚动容器位移，且禁止把宽于视口的 canvas 放入 scroll-view。`clipViewport()` 只更新 `viewOffset / viewWidth`，滚动以 16ms 合并重绘、偏移未变化则不重画。`onChartTap` 以不滚动的 `.chart-plot-viewport`（不含右侧固定纵轴栏）为坐标基准并加回 `viewOffset`，否则点击会偏一个滚动距离。`onChartScroll` 只更新绘制视口，不做日期换算、不调用 `selectChartDateValue` / `loadDayDetails`；选中日期的切换唯一入口是 `onChartTap`，横滑期间无云函数调用。选中日期只以加粗实心节点强调，不画竖向高亮虚线；“我的”页标题固定、主体由 `.mine-scroll` 承载。三个 Tab 页的底部导航继续固定。二级页 `.sub-nav` sticky，小迈对话与历史页分别在消息/历史列表滚动，表单弹层保留 `.sheet-scroll`。
- 统计详情右侧纵轴为独立固定栏，栏宽按最宽刻度文字加少量内边距计算，刻度文字右对齐；左侧 `.chart-plot-viewport` 才是横向滚动绘图区，网格线和数据不进入纵轴栏。
- 按压统一 hover-class=tap-feedback。允许受控入场：数据到达使用 `.content-arrived`；日记列表使用 `utils/reveal.js` 观察器为 `.reveal` 项目分批入场，错峰间隔 80ms、每 4 项循环延迟；Canvas 图表通过 `seriesChart()` 生长绘制。首页时间线卡片的 `.metric-slot`、`.metric-lift`、`.metric-wiggle` 仅承担整理态抖动，不得再叠加入场 transform。`.reveal` 在减弱动态效果规则中须显式恢复 `opacity: 1`，否则停动画后仍可能隐藏内容。
- 弹层事件冒泡（2026-10-26 修复）：mask 用 bindtap 关闭，弹层内容容器（scroll-view）必须用 catchtap 绑定**真实存在的方法**（统一为页面包装器注入的 noop）阻止冒泡；禁止 catchtap="" 空 handler——微信基础库不注册空 handler，catch 失效，弹层内点击（输入框聚焦、类型切换）会冒泡到 mask 触发误关闭。
- 头部固定原则（2026-10-26）：凡内容可能超长的页面/弹层，头部（含返回/关闭按钮）固定，只滚动内容区。统一结构为 `view.sheet` → `.sheet-heading`（`flex-shrink: 0` + `--color-surface` 背景）→ `.sheet-scroll`（`flex: 1`）→ `.sheet-content`；**禁止**用 `scroll-view.sheet` 把 heading 包进滚动区，也禁止在 `.sheet-content` 内联 `padding-top` 叠加状态栏（会令顶部留白翻倍，2026-10-26 已在 growth 修正）。①二级页 `.sub-nav` position: sticky、top: 0、背景 `--color-bg` 实色，页面原生滚动时返回按钮始终可见（该实色背景仅限二级页 sticky 返回栏，三个 Tab 页标题区不套用）；②`.registration-fullscreen .sheet-heading` 的 `min-height: calc(var(--nav-height) + 状态栏高度)`、`padding: 状态栏高度 var(--nav-edge-inset) 0`，状态栏只加这一次；非全屏底部弹层 `.sheet` 保持 `--sheet-max-height` 84vh 上限。
- 头部水平内边距（2026-10-26）：统一 token `--nav-edge-inset: var(--space-ml)`（40rpx）。返回箭头的可视左缘与关闭 × 的可视右缘都等于该值；`.sub-nav-back` 用 `justify-content: flex-start` + `padding-left: var(--nav-edge-inset)` 定位，不得再用「112rpx 盒居中 + 额外 margin」；全屏关闭（`.registration-fullscreen .sheet-close`，`order:-1`）与普通 sheet 关闭（`.sheet-close`，右对齐）共用同一 inset。居中标题靠左右对称占位（`--nav-side-width`）保持居中，页面级不得再覆盖头部内边距（milestone/index.wxss 曾重复声明，已移除）。
- Tab 页滚动原则（2026-10-28）：首页 `.home-results` 与我的 `.mine-scroll` 使用独立滚动区；小迈 Tab 采用页面级滚动，不能包住子页面 Canvas 的纵向 `scroll-view`。底部 `custom-tab-bar .tab-shell` 固定，页面与滚动区按紧凑栏高和系统安全区留出空间。小迈对话/历史页分别由 `.chat-list`、`.history-list` 独立滚动；其他可滚动子页使用 `.sub-nav` sticky，弹层使用自己的 `.sheet-scroll`。
- 小迈主 Tab 不显示独立“回首页”按钮；统计详情页为普通二级页，标题为“{类型}趋势”，返回使用 `.sub-nav` 返回按钮。

高频列表手势（2026-11-12）：`touchmove` 只更新被拖动行的数组路径字段，复位/展开也只发送发生变化的字段；不要在每帧克隆整张列表并整体 `setData`。用户自定义、可能含个人内容的本地数据按 `openid` 分桶；旧共享键没有可验证的账号归属，登录后应清理，不能迁移给当前账号。

## 3. 主题系统
theme.js 的偏好结构为 {color:'blue'|'pink'|'orange'|'mint'|'purple'|'dark'}，即 6 套渐变主题（治愈蓝 / 樱粉 / 暖橙 / 薄荷绿 / 紫色 / 深色），color-only，无独立明暗模式：
- 治愈蓝（默认，浅色）：白底叠加低透明度蓝 #598BFD / 薄荷绿 #9AD4CB / 青 #35B3C9 弥散背景；卡片白，原浅蓝/蓝灰 token 保留供既有内容使用；强调 #5B9BD5、深蓝 #2E6DA6，主按钮白字。
- 樱粉 / 暖橙 / 薄荷绿 / 紫色（均为浅色）：各自色相的弥散渐变背景与强调墨色（accentInk 取较深值保证白字对比），与蓝同质感。
- 深色（dark:true）：复用压暗同色相背景（基色 #101923）；卡片 #1D2A37、表单 #243343；原 --color-bg #141D27 保留作系统背景兜底；强调 #6FA8DC、浅蓝 #A8C8E8。深色作为独立主题色存在，不再有浅色/深色模式开关。
- 文本使用 --color-text-* 与满足对比度的 --color-accent-ink，不用低对比度浅蓝作为小字号文字。
- 根容器 class="theme-root {{themeClass}}"，类名 theme-color-<id>（深色额外带 mode-dark）。显式根变量覆盖系统媒体查询，用户选择不跟随系统切换。
- utils/page.js 包装页面生命周期，加载时同步本地偏好、显示时刷新、接收 app 的即时主题更新；所有页面必须使用该包装，不可直接遗漏主题。
- 主题按明确选择的颜色生效，不随系统外观变化；全部页面使用 custom 导航栏（无原生导航小标题）：三个 Tab 页无顶部标题、页内以 .page-title 大标题（heading 字号）；其余子页面用 .sub-nav 自绘大标题 + 返回按钮，标题字号与 Tab 页页内大标题一致（heading 44rpx）；均以动态状态栏高度（statusBarHeight，utils/page.js 统一注入）避让，标题与胶囊按钮同水平线上下居中；custom-tab-bar 独立同步。theme.json 保留 darkmode 的启动兜底。
- 主题即 6 套渐变配色，不区分皮肤与背景色；主题设置使用圆点选择器切换 6 种主题色，不提供跟随系统模式。
- 本地 slownote_theme_pref 即时生效（{color}）；users.theme_pref 云同步使用串行队列与修改版本，避免慢响应覆盖刚修改的主题；失败标记 slownote_theme_pending，登录/读取档案时重试。旧本地或云端仅含 mode（light/dark/system）的值在读取/写入时按 color 归一（dark→dark、light/system→blue）并写回，此后不随系统外观变化。
- Canvas 使用 utils/chart.js 和主题调色板，不能在绘图函数散落固定颜色。`seriesChart()` 由 `pages/statistics-detail` 调用：各类型均为跳过缺失值的折线（`TYPES` 的 `kind` 均为 `line`）；通过顶部灰白胶囊标签 `.metric-switch` 完成指标选择。统计详情页不显示日历热力图；原 `utils/heatmap.js` 及其测试 `tests/heatmap.test.cjs` 已在死文件清理中移除，不再保留。

## 4. 状态、交互与可访问性
登录后所有功能均可使用；登录门禁用于引导登录，不承担数据权限判断。
加载、空、失败、重试、未登录均有独立文案。错误不得当作空数据；保存仅 code=0 才显示成功。
保留 aria-*，按钮/输入有标签；选中/禁用/已读等不能仅依赖颜色。键盘焦点保留，表单不遮挡，真机检查系统控件。
写入使用稳定请求 ID，失败重试复用，成功或修改内容后生成新 ID；提交期间禁止重复写入。弱网不自动伪造成功或丢弃用户草稿。
- 小迈对话页交互：输入卡片上方一行，左侧为可选深度思考胶囊，右侧为新建/历史圆形图标按钮；不设数据范围按钮。`utils/digest.js` 从提问识别今天、昨天、本周/上周、本月/上月、全部时间及近期天/月，近期滚动范围最多 90 天；`statistics` 服务端按七类白名单渲染记录明细与计数概览，客户端按服务端 `detailsLimit` 裁剪，不接收原始记录集合。常见问题在 `pages/ai-settings` 编辑面板可多选数据类型并提供「全选 / 取消全选」，推荐问题只取所选类别，自由提问不带类别时保持全量兼容，空选不发起查询。已附带明细在用户消息气泡中默认折叠为最多五行，可展开/收起；AI 请求只在用户确认发送后附带，云端 `redact()` 同时处理明细和对话。个人主体不可用 WechatSI，语音由 RecorderManager 录音并在松开后经 `asrProxy` 一次性转写；主体变更为非个人后可加回声明恢复实时预览，上传临时音频在完成后删除。

### 4.1 文案与提示（少即是多，2026-11-12）

全局原则：**只写用户当下理解状态、做决策所必需的信息**，一处只说一件事；同一件事不在标题、说明、按钮上重复表达。

- **删除**：界面已自明的动作说明（「可添加 / 编辑 / 删除」「左滑可删除」「点卡片切换」「点右上方添加」并罗列表单字段）、产品自述与营销抒情句、重复解释按钮行为的长句。手势操作由左滑露出的按钮本身表达，不再加文字说明。
- **保留且不得精简**：授权与合规告知（定时报告的第三方 AI 服务商 consent 全文、AI 生成仅供参考）、错误/失败原因与重试、破坏性操作的二次确认、数据与能力限制（月度任务固定上月整月、小迈不能联网、`{days}` / `{period}` 变量、明细折叠与「另有 X 条未展开」）、参考值 `refHint`、空状态一句引导、`aria-*` 标签。设置列表每项的一句导航说明用于区分设置项，也属保留项。
- **长度**：提示卡（`page-tip` / `baby-hint` / `subscribe-note`）一句话 ≤ 40 字；`form-note` 只写差异信息，不重复标题与按钮；空状态最多「一句状态 + 一个动作」，不叠加标题 + 说明 + 按钮三层重复。
- **本次精简范围**：`ai-tasks`（页面提示、空状态）、`ai-notifications`（空状态、列表统计行）、`baby`（提示卡、空状态）、`ai-settings`（四处提示词说明、深度思考、常见问题区、空状态）、`ai-chat` / `ai-history`（欢迎语、新对话确认）、`statistics`（空引导说明）、`feeding` / `solid` / `excretion`（空状态煽情标题）、`custom-record` / `milestone`（空状态自述）、`mine`（未登录状态）。无用节点（`.baby-hint-title`、`.empty-guide-copy`）与对应 WXSS 规则同步移除，不新增样式类。
- **回归护栏**：`tests/copy-terse.test.cjs` 静态扫描全部 WXML，禁用冗余短语、限制 `page-tip` 长度，并断言合规文案与关键限制仍在。标题区副标题（「问一句，一眼看懂宝宝的成长。」等）属品牌排版文案，由 §1 约束，不参与本轮精简。

## 5. 页面与服务边界
app.js 管理身份、宝宝资料缓存与主题；api.js 统一新页面云调用；date.js 统一日历/月龄；categories.js 定义面板映射；viewmodels.js 生成数值卡。现有登记页继续调用兼容云接口。
保护页面先等待初始化，未登录跳转我的；退出后不自动登录。核心三页可展示未登录引导。
敏感 API 如媒体选择、订阅授权仅由用户动作触发。聊天同意说明与任务分析同意分开，避免自动外发档案。
对话自动保存至云集合 ai_sessions（openid 隔离、幂等 upsert、图片仅存 fileID、保存失败静默降级不阻断）；历史对话列表页倒序展示，左滑露出「删除」（宽度 `calc(var(--swipe-action-width) / 2)`，与历史报告一致；二次确认沿用 `templates/motion-confirm.wxml`），点击载入会话继续提问；手势与局部 `setData` 复用 `utils/list-patch.js`，常显删除图标已移除（§4.1 少即是多）；照片上传到本人 diary 路径，服务端校验 fileID 归属。密钥仅在云函数环境变量中。
- 宝宝生日与记录日期统一使用原生 `<picker mode="date">`（`end` 上限为今天）；历史 `components/wheel-date-picker` 三列滚轮组件已移除，空目录已清理且不再注册为自定义组件，勿在新页面或文档中引用。
- Tab 页读取走 `utils/page-cache.js`：先渲染缓存再静默校验，同参 60 秒内复用、不重复请求云函数；记录新增/修改/删除与首页卡片删除经 `utils/home-refresh.invalidateRecords()` 失效 `home`、`statistics` 两个作用域，退出登录由 `app.logout()` 整体清空。静默刷新时不得清空 `cards` / `moduleCards`，否则整页骨架会闪；下拉刷新用 `load(true)` 跳过缓存但仍保留既有内容。新增写操作时必须同步接入失效，否则 60 秒内会读到旧数据。
- **富文本渲染**：小迈对话回答与历史报告详情共用 `utils/markdown.js` 的 `parseMarkdown()`，经 `<rich-text nodes>` 渲染二级小标题、列表、加粗与行内代码；`md-*` 样式须在各自页面 WXSS 用**直接类选择器**定义，rich-text 内部节点不响应后代选择器。`parseMarkdown` 有意把 Markdown 表格降级为纯文本、不支持图表，因此默认提示词禁止模型输出表格与图表代码；扩展渲染能力之前不得在提示词里要求表格/图表。报告详情原为 `<text selectable>`，改 rich-text 后长按选择失效，已在详情元信息行补「复制全文」按钮（`wx.setClipboardData`），并按报告 ID 缓存解析节点避免长正文重复计算。

## 6. 验证
node --test tests/*.cjs；node scripts/check-project.js。
浏览器映射可验证几何/主题与示意 Canvas，不能替代微信编译、组件隔离、原生 picker/switch、键盘、安全区和读屏真机测试。

`check-project` 当前恒有 5 条 `hardcoded visual value` 基线告警：`pages/index`、`pages/statistics`、`pages/mine` 的 Tab 页标题区高度 `176rpx` 与内容起始 `28rpx`，`pages/statistics-detail` 的纵轴文字偏移 `4px/8px` 与渐变遮罩宽度 `24rpx`，`pages/milestone` 的勾选圈 `24rpx`。这些是早期实现遗留的同一语义值散落，改动会引起像素级视觉变化，收敛时必须单独一轮并逐页比对截图；除这 5 条之外的任何新增告警都视为本次改动引入的问题，必须清零再交付。

## 7. Apple 设计落地（小程序适配版）
原则来源：emilkowalski/skills 的 apple-design（WWDC Designing Fluid Interfaces / Details of UI Typography 等），落地时按小程序渲染能力取舍：

### 7.1 背景、表面与纵深（弥散渐变，2026-10-24 精修后形态）
- 原则：页面背景使用低透明度、大半径 radial-gradient 色斑，蓝 #598BFD、薄荷绿 #9AD4CB、青 #35B3C9 柔和融合（这是默认治愈蓝主题的色斑）；卡片、弹层、表单继续使用不透明纯色，靠 surface 与 field 的明度差分层。其余 5 套主题通过 `.theme-root.theme-color-<id>` 覆盖 `--bg-mesh-light` 套用各自色相，渐变规则与半径完全一致，仅色相不同。
- 背景体系：`--bg-mesh-base-light` / `--bg-mesh-base-dark` 定义明暗底色，`--bg-mesh-light` / `--bg-mesh-dark` 定义三层大半径 radial-gradient；`--bg-mesh-base` / `--bg-mesh` 为当前主题别名，只作用于 `page` 和页面根容器。浅色为白底浅色晕染，夜间为 #101923 底上的压暗蓝绿青晕染；系统媒体查询和显式 mode-light/mode-dark 分别选择对应别名。背景覆盖容器完整宽高且不重复，长页面不出现拼接边界；不依赖 filter: blur 或 background-attachment: fixed。背景 token 集中在 app.wxss，页面 WXSS 不得写渐变或裸色。
- 表面体系：页面使用上述 mesh token；原 --color-bg（浅 #EDF4FB / 深 #141D27）保留供既有引用与系统背景兜底。卡片/弹层 --color-surface（浅 #FFFFFF / 深 #1D2A37）、表单与操作区 --color-field（浅 #F1F5F9 / 深 #243343）不变；--shadow-card: none（卡片无阴影无边框，靠 surface 与背景的明度差分层）。
- 圆角体系：--radius 32rpx（卡片与内容容器）、--radius-small 16rpx（表单/按钮/控件）、--radius-sheet 32rpx（底部弹层顶部）、--radius-icon 16rpx（图标内部圆角，独立于卡片圆角防止图形失真）；窄屏概况多指标数值可使用 --font-metric-compact 24rpx，作为数字专用压缩例外，不用于正文。
- 左滑列表圆角（2026-11-12 统一）：常用问题、定时报告任务、宝宝信息、成长里程碑、历史对话、历史报告六个列表的**内层卡片统一 `border-radius: 0`**，圆角由外层 `*-swipe` 容器的 `border-radius: var(--radius)` + `overflow: hidden` 统一裁切。否则左滑露出动作区后，卡片右缘会留下弧形缺口，与动作按钮拼接不齐（历史对话/历史报告曾与常用问题不一致）。外层容器同时补 `background: var(--color-surface)` + `isolation: isolate`，避免滑开后露出页面渐变底色并隔离删除按钮层级；动作区保留 `0 var(--radius) var(--radius) 0` 的右侧圆角。历史报告卡片复用全局 `.card`，须在 `.report-card` 显式把 `border-radius` 与 `box-shadow` 归零（`--shadow-card` 当前为 none，显式覆盖可防止日后主题启用阴影时右缘压出暗边）。静态外观不变，因圆角改由外层裁切。
- 应用对象：`page`、`.theme-root.page`、`.theme-root.chat-page`、`.theme-root.history-page` 使用 `background-color: var(--bg-mesh-base)` 与 `background-image: var(--bg-mesh)`；`.sub-nav` 与小迈 composer 透明透出背景；`.sheet` 仍为 surface 纯色；`custom-tab-bar .tab-shell` 使用 `var(--bg-mesh-base)` 不透明贴底，且不加边框或 inset 分隔阴影。
- 边缘只用 --color-divider 细分隔线，禁止深色硬分割线；按钮无底色（描边/文字）或 field 底二选一，不叠双层。
- 遗留：app.wxss 中 --material-bg/--material-edge/--material-blur 为早期毛玻璃 token，当前无应用对象（保留不删，避免改量过大；新增界面不得再启用毛玻璃）。渐变背景不得进入卡片、sheet 或 tabBar。

### 7.2 动效（Interruptible & spatial consistency）
- 动效时序：--motion-sheet 400ms（弹层/模态/主题）、--motion-quick 180ms（列表位移与完成标识过渡）、--motion-feedback / --motion-press 350ms（触点水波/按钮/类型选择）、--motion-setting 300ms（设置组闪光），这些反馈沿用 --curve-spring。表单抖动按任务特例用 --motion-error 250ms，左右 --error-shift 5rpx。--motion-chart 700ms 专供 `utils/chart.js` 的 `seriesChart()` 入场生长，Canvas 通过 rAF 和三次 ease-out 计算绘制进度；不将该时长用于其它控件。
- 弹层退出：保留 closing 状态机，index / ai-tasks / ai-settings / baby 四页统一 utils/motion.closeLater 延迟 400ms 卸载；入场 translateY(100%)，退出反向。页面离开清理视觉定时器和 closing；首页类目跳转仍即时导航。
- 按压反馈：保留微信 hover-class=tap-feedback（按压态，非桌面悬停）。主按钮 touchstart 单次查询 rect，从本地触点产生 ::after 水波，仅 transform/opacity，350ms 清理；不监听滚动、不遮文字，禁用逻辑不变。
- 进出同路径原则：面板从哪进入就从哪退出（sheet 从底部入/出）。
- 不可落地清单（小程序原生限制）：spring 物理库与手势 velocity handoff（无 Pointer Events/setPointerCapture）、momentum 投影、rubber-banding、prefers-reduced-motion / prefers-reduced-transparency 媒体特性（微信不支持，保留无害兜底块）、页面转场为系统级动画不可定制。

- 首页与喂养：.motion-host 中原页面为 .motion-scene，mask/sheet 保持其兄弟节点；.scene-recessed 缩放 .92 + sheet 圆角，关闭恢复；保留 FAB 坐标、不透明无分隔线的 tabBar、原间距与字体。
- 主题：旧主题模板作为静态底层，新主题实页 clip-path 圆扩散 400ms。触点来自 touchstart，picker 完成时复用打开前触点；@supports 不满足时 opacity 淡入兜底。不阻塞本地保存/云同步，系统自动更新直接应用，旧层不可点且 aria-hidden。
- 骨架：复用首页、小迈主页面与统计详情已有 loading 分支；按对应页面布局显示占位，保留 loading 文案；数据卡到达反馈按页面实现。
- 行内校验：喂养数值/辅食名称/排尿次数、宝宝昵称沿用原条件及文案；错误提示在输入下方，编辑清除相应错误，不清空草稿、不改变 payload。
- 自定义登记数值：普通页与面板登记共用行内校验，数值与单位分开填写；单位为自由输入，前端最多 6 字，云函数字段上限为 8 字。数值可留空，填写时须符合云端范围 0～999999。仅提交时去掉数值首尾空白，草稿保持原样；字段修改清除对应错误，失败重试复用 `clientRequestId`，权限和云端校验不变。
- 成长快捷登记（2026-10-28，2026-11-04 更新）：身高、体重、头围在同一表单中横向三列分别选填，记录日期位于顶部（日期在前），可单次提交一个或多个指标；每项沿用成长记录云端边界（身高 1～250 cm、体重 0.1～300 kg、头围 1～100 cm），至少填写一项，接口字段及幂等键不变。新增入口（panel，首页 + → 成长）与点击首页卡片编辑（normal）共用同一横向三列表单。normal 模式进入时按选定日期回填当天已有记录（有则更新、无则新增），并提供「删除该天记录」入口；成长页不再展示跨日期的历史记录列表，首页卡片作用域严格对应当天。
- 危险确认：仅替换原已存在的删除宝宝/历史对话/小迈配置常见问题/分析任务确认入口，复用 templates/motion-confirm.wxml；遮罩拦截触摸，取消在前，不自动聚焦删除。原文案/对象/回调保留，退出后最多回调一次，取消/离页不执行删除。无确认的操作不新增弹窗。
- 设置与类型：switch 保留原生滑动，同组卡片闪光 300ms；喂养类型/便便状态/小迈范围 touchstart 临时放大 1.05、邻项让位 6rpx，350ms 复原，选中逻辑不变。
- 减少动态效果：既有 prefers-reduced-motion 兜底块同时关闭新水波、抖动、类型让位、骨架流光、主题扩散与模态缩放；不支持此媒体特性的微信端仍使用上述有限时长方案，不据此承诺系统设置可被读取。

### 7.3 排版
- 标题行高收紧（--line-heading 1.3）、正文宽松（--line-body 1.6）；标题 letter-spacing 维持 0（微信字体渲染负数 tracking 不稳定，不做负值）。
- 层级由字重+字号+行高组合表达，不单靠字号；标题与主要数字使用 --weight-semibold（600，.page-title/.metric-number），导航标题 .sub-nav-title 使用 --weight-bold（700），正文维持常规/中等字重。

### 7.4 触觉反馈（已落地）
- `utils/haptics.js`：vibrateShort 节流封装（120ms 间隔 + 失败静默），type 传 'light' / 'medium'。
- 接入点（仅有意义动作，避免过度反馈）：弹层打开=light；弹层关闭=light（经由 close 函数）；提交/记录成功='medium'（feeding/growth/diary/milestone/custom-record/baby/ai-tasks）。里程碑达成由 milestone 页面提供反馈。
- 新增接入须复用本工具，不得直接 wx.vibrateShort 裸调。
- 首页 `.daily-summary-tag` 标签筛选切换不触发触觉反馈，使用底色与透明度表达选择状态；不得为统一手感重新加入短振动。

## 8. 图标体系（SVG mask，2026-10-26 全量落地）
- 源文件：`miniprogram/assets/icons/*.svg`（Lucide 风格，`stroke="currentColor"`），当前目录有 31 个 SVG 源文件，UTF-8 无 BOM；图标按各页面既有用途复用。这些源文件仅作可编辑母版，运行时零引用（WXSS 必须内联 base64）；`images/tab-*.svg` 三个旧 Tab 图标副本已移除（与源图标重复且无引用），底部 Tab 统一由 `custom-tab-bar/index.wxss` 内联 mask 渲染。
- 渲染：WXSS 内联 base64 + mask，`background: currentColor` + `-webkit-mask` / `mask: url("data:image/svg+xml;base64,…") no-repeat center / contain`。
- **微信约束（必须遵守）**：① WXSS `url()` 不能引用本地 SVG 文件，必须 data URI base64 内联；② 只支持 shorthand `-webkit-mask` / `mask`，不支持 longhand（mask-image/mask-size 等，会导致图标不渲染）；③ shorthand 的 mask-size 不用含 `auto` 的组合（如 `165% auto` 会解析失败），用 `contain` 或双值百分比；④ 图形放大优先放大容器 + `contain`，避免被容器裁切显示不全；⑤ 尺寸微调用 `calc()` 局部覆盖，不改全局 token。
- chevron 方向体系（arrow-back-ios 左箭头旋转）：0°=‹左（上一周）、90°=↑上（月份展开态）、180°=›右（下一周/设置行/日期选择器）、270°=↓下（月份收起态/下拉选择器）。月份按钮随 `calendarExpanded` 切换 ↓/↑。
- 颜色一律走 token（--color-accent / --color-accent-ink / --color-text-*），不在页面 WXSS 写裸色；logo/品牌图标用 --color-accent-ink 随主题自适应。
- 已知死代码（保留）：app.wxss 的 `.icon-*` 旧图标、record-icons 母乳/奶粉手绘。（images/logo.png 已于 2026-11-12 清理——它仅被文档/测试提及，运行时品牌 logo 已由 `.profile-logo` 的内联 base64 mask 渲染；assets/icons/logo.svg 仍保留，作为该 mask 的源文件与测试 fixture。）

## 9. 首页卡片整理（2026-10-26）
- 首页记录区（2026-10-28）：`.metric-slot` 单列全宽；`.metric-rail-line`、`.metric-rail-node`、`.metric-rail-time` 是槽位下的直接子节点，时间位于卡片上方并与时间轴节点对齐；轨道几何使用 app.wxss 的 `page, .theme-root` 集中定义的 `--rail-gutter` / `--rail-time-height`，`.metric-grid` 只负责列表布局。竖线跨槽位间距延续至下一项，末项收于底部。槽位需保留 `box-sizing: border-box` 与左内边距，避免横向溢出。记录卡片保留 `.metric-lift/.metric-wiggle/.metric-card`，整理态只用抖动与删除按钮，不做位置变换。喂养次数只统计 feed，不混入辅食/排泄；标签、信息项使用 `summary` 原始字段，不解析 detail，不合并自定义同名记录。
- 首页汇总标签：位于 `.home-results` 内，通过横向 `scroll-view` 承载单行标签；内层 `inline-flex`，标签不收缩、不换行。`activeTags` 支持多选过滤卡片；筛选态不影响长按整理，轻点仍可打开记录页。切换日期会清空筛选，下拉刷新保留筛选状态。
- `statistics` 的 daily 响应增加可选 `times: { [categoryKey]: 'HH:mm' }`，表示当前宝宝、所选日期每个类目的最新 `created_at`，按北京时间格式化；不是逐笔记录时间。无有效时刻或旧云函数未部署时留空，不编造。其余 action、summary、scope 和统计口径不变；上线需重新部署 statistics。
- 首页 FAB 保持原 fixed 坐标与大小，层级 `--layer-tab + 1`；`.home-results` 作为 z-index:0 的内容层隔离记录卡片，列表内部 `.daily-results` 预留导航/FAB/安全区高度。FAB 低于 sheet；弹层打开仍沿用隐藏 FAB 逻辑。
- 首页当日指标卡支持长按整理：长按进入整理态，轻按仍沿用原 `openCard` 跳转到对应记录页。
- 整理模式由 `.cards-editing` 控制抖动与删除入口；卡片保持时间线文档流位置，不做拖动、放大、阴影、让位或吸附。
- 删除按钮保持 `--control-height` 热区。确认文案明确说明“当前日期 + 当前卡片类别的全部登记”，确认后调用 `homeCards.deleteDay`；服务端成功后先 200ms 缩放淡出，再刷新首页统计。失败保留卡片，不显示假成功。
- 卡片顺序完全由时间线数据决定，不写入本地排序键。登出/切换宝宝/切换日期/离开页面会清理整理态。
- 删除服务端必须同时校验当前用户或家庭 scope、baby_id、record_date 与 category；`clientRequestId` 通过 `mutation_receipts` 保证重复确认不会重复删除。按 40 条批量删除，快照固定本次删除对象，避免误删删除确认后新产生的记录。
- 真实微信端需检查原生 `bindlongpress` / `bindtap` 在 iOS/Android 的触发差异；浏览器预览不能替代这一项。

历史报告日期筛选：直接选择起止日期，默认本月（北京时间月初至今天）；按报告生成时间 created_at 在云端筛选，包含起止当天。页面通过 aiNotifications 的 list 传 startDate/endDate/offset；接口返回 total/hasMore，每页 20 份，按生成时间和 ID 倒序，支持加载更多。无结果保留日期选择器并显示范围空态，快速切换时丢弃旧请求响应。

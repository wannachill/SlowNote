# Design System — 一迈一记 SlowNote（宝宝成长记录 微信小程序）

> 本文档遵循 [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) 的 `DESIGN.md` 9 节结构（Visual Theme / Color / Typography / Components / Layout / Depth / Do·Don't / Responsive / Agent Guide），但内容**完全基于本项目的真实令牌与规范**（来源：`miniprogram/app.wxss` 令牌定义、`docs/rules/frontend-standard.md`、`docs/rules/pitfalls.md`）。
>
> 用途：① 作为 CODEX / 任何 AI 编码 agent 生成一致 UI 的真相源；② 作为「UI 评审官」逐条审计当前小程序的对照标尺。所有数值均为本项目实测值，非臆造。
>
> 单位说明：小程序设计基准 750rpx = 375pt，故 **2rpx ≈ 1px**。下文令牌同时给出 rpx 与近似 px。

---

## 1. Visual Theme & Atmosphere

一迈一记（SlowNote）是一款**宝宝成长记录**微信小程序。设计语言：**极简、留白、冷静**。

- 单一蓝色主题（浅色 / 夜间跟随系统），**不区分多皮肤**。
- 中性色表面 + **一种强调蓝**。强调蓝分两层语义：装饰蓝 `#5b9bd5`（对比度仅 2.9:1，**只能做装饰/进度，不能承载文字**）与强调墨蓝 `#2e6da6`（对比度 5.4:1，**承载按钮底色与选中文字**）。
- 页面背景允许**低透明度、大半径**的蓝/薄荷绿/青**弥散渐变（mesh）**，但**绝不进入卡片、弹层、控件、tabBar**。
- **禁止**：新增其它渐变、阴影堆叠、Emoji、毛玻璃（glassmorphism）、无关插画。
- 系统字体优先（PingFang SC）；层级靠「字重 + 字号 + 行高」组合表达，不单靠字号。
- 头部固定、只滚动内容；底部三导航固定贴底、无顶线、无额外背景。
- 登录后所有功能可用；登录身份用于个人数据隔离，服务端仍校验家庭、宝宝与对象归属。
- AI 模型地址、密钥与型号仅通过云函数环境变量配置，不从数据库或小程序包读取。

---

## 2. Color Palette & Roles

### 浅色模式（mode-light）

| 语义名 | 令牌 | 值 | 功能角色 |
|---|---|---|---|
| 页面底色 | `--bg-mesh-base-light` | `#ffffff` | 页面/根容器实底 |
| 页面晕染 | `--bg-mesh-light` | 蓝 `#598BFD` / 薄荷 `#9AD4CB` / 青 `#35B3C9` 三层 radial-gradient | 仅 `page` 与根容器背景 |
| 卡片/弹层表面 | `--color-surface` | `#ffffff` | 卡片、sheet 实底 |
| 表单/操作区 | `--color-field` | `#f1f5f9` | 输入框、操作底 |
| 主文字 | `--color-text-1` | `#26343f` | 标题、正文重点 |
| 次文字 | `--color-text-2` / `--color-text-3` | `#52687b` | 辅助说明 |
| 细分隔线 | `--color-divider` | `rgba(38,52,63,.12)` | 唯一允许的细分隔线 |
| 装饰强调 | `--color-accent` | `#5b9bd5` | 进度、装饰，**不承载小字号文字** |
| 强调墨（动作） | `--color-accent-ink` | `#2e6da6` | 按钮底色、选中文字、图标选中色 |
| 动作按下 | `--color-action-pressed` | `#245783` | 按钮 active |
| 选中底（浅） | `--color-accent-soft` | `rgba(91,155,213,.14)` | 选中 pill / 标签底 |
| 反白文字 | `--color-on-accent` | `#ffffff` | 墨蓝实底上的文字 |
| 遮罩 | `--color-mask` | `rgba(38,52,63,.48)` | 弹层 mask、拖拽阴影色 |
| 警示 | `--color-notice` | `#b42318` | 危险/错误（反白字） |

### 夜间模式（mode-dark）

| 语义名 | 令牌 | 值 |
|---|---|---|
| 页面底色 | `--bg-mesh-base-dark` | `#101923` |
| 页面晕染 | `--bg-mesh-dark` | 同色相压暗蓝绿青 |
| 表面 | `--color-surface` | `#1d2a37` |
| 表单 | `--color-field` | `#243343` |
| 系统背景兜底 | `--color-bg`（深） | `#141D27`（legacy，保留） |
| 装饰强调 | `#6FA8DC` | 浅蓝（深色调） |
| 强调墨（浅） | `#A8C8E8` | 深色调下承载文字 |

**角色铁律**
- 任何「实心底 + 白/浅字」的控件（按钮、选中 pill、日历选中圆）**必须用 `--color-accent-ink`**，绝不用 `--color-accent`（2.9:1 不达标）。
- 小字号文字禁用低对比浅蓝；文字颜色一律走 `--color-text-*` 与满足对比的 `--color-accent-ink`。
- 页面 WXSS **不得写裸色值或渐变**；颜色一律引用令牌。`check-project` 会拦截硬编码的 rpx/px/色值。

---

## 3. Typography Rules

- 字族（令牌 `--font-family`）：`-apple-system, "PingFang SC", "HarmonyOS Sans", "MiSans", "Microsoft YaHei", "Helvetica Neue", sans-serif`。
- 字号梯度（rpx / 近似 px）：`caption 28/14` · `body 30/15` · `control 32/16` · `title 34/17` · `heading 44/22` · `data 52/26` · `brand 48/24`。
- **最小可读下限 caption = 14px，禁止更小**。
- 字重：`--weight-regular 400` / `--weight-medium 500` / `--weight-semibold 600`。标题与主要数字用 600（`.page-title` / `.sub-nav-title` / `.metric-number`），正文维持 400/500。
- 行高：`--line-tight 1.25`（紧凑）· `--line-body 1.6`（正文宽松）· 标题行高约 1.3。
- 字距：`--tracking-heading 0`（微信负数 tracking 渲染不稳定，**不做负值**）；`--tracking-brand 4rpx`（品牌字）。
- 数字使用 `tabular-nums`；表单控件显式继承，保证对齐。
- 层级**靠字重+字号+行高组合**，不单靠字号放大。

---

## 4. Component Stylings

### 按钮 / 文字操作
- 两种形态二选一：**无底色（描边/文字）** 或 **field 底**，不叠双层。
- 圆角 `--radius-small 20rpx`；按压 `hover-class="tap-feedback"`；主按钮 `--press-scale-primary .96`、普通 `.98`，`--opacity-pressed .76`，350ms。
- **选中态 pill**：`--color-accent-ink` 实底 + `--color-on-accent` 白字 + `--color-accent-soft` 浅底（无下划线）。

### 卡片
- 表面 `--color-surface`；圆角 `--radius 28rpx`；**`--shadow-card: none`（无阴影、无边框）**；靠 surface 与背景的明度差分层。
- 整理态仅使用轻微抖动与删除按钮，不改变卡片位置。

### 底部弹层 Sheet
- 顶部圆角 `--radius-sheet 40rpx`；表面 `--color-surface` 实色；`--sheet-max-height 84vh`。
- 结构：`view.sheet` → `.sheet-heading`（`flex-shrink:0` + surface 背景）→ `.sheet-scroll`（`flex:1`）→ `.sheet-content`。**禁止把 heading 包进 scroll-view，禁止在 content 内联 `padding-top` 叠加状态栏**（会令顶部留白翻倍）。
- 进入 `translateY(100%)`、退出反向，统一 `utils/motion.closeLater` 延迟 400ms 卸载。

### 输入框 / 表单
- 高度 `--input-height: max(96rpx,44px)`；field 底；行内校验错误提示在输入下方；不清空草稿、不改 payload。

### 底部导航 custom-tab-bar（**用户反复强调的形态**）
- 三固定 tab：首页 / 统计 / 我的；SVG mask 线性图标（home / chart / user，Lucide 风格）+ 文字。
- **选中态**：文字变 `--color-accent-ink` + 图标线条加粗（`--stroke-strong 3rpx`）。
- `.theme-root.tab-shell { background: var(--bg-mesh-base); }` —— **不透明实底、无顶部分隔线、无额外 padding**。
- 高度 `--tab-height: max(96rpx,48px)`；`.tab-item` 垂直居中；底部只保留 `env(safe-area-inset-bottom)`，**不依赖位图图标**。
- ⚠️ CODEX 历史两次犯错：给 tab-shell 加 `border-top` / surface 实色背景 / 加大 padding-bottom —— 全部违规。

### 悬浮按钮 FAB
- 唯一悬浮操作：圆形「＋」，**无文字**，加号线条用 `--stroke-strong` 加粗。
- `fixed`，位于导航之上：`bottom = calc(var(--tab-height) + var(--space-ml) + env(safe-area-inset-bottom))`；层级 `--layer-tab + 1`；低于 sheet。

### 日历（周历 / 月历共用类名）
- 周历七等列、全宽外扩，320px 宽时每列 ≥ 44px。
- **今天**：显示「今」字，**不套实心圆**；仅用 `--color-accent-ink` + `--weight-medium` 表达（实心圆专留给「用户选中其他日期」）。
- **有记录日**：数字变蓝 + 下方 10rpx 蓝点。
- **用户选中其他日期**：accent **实心圆**填充（`.selected`）。
- **今天 与 选中 互斥**：同一日期不会同时 today 又 selected；today 仅 accent-ink+字重，selected 才是实心圆。实现用 `.today:not(.selected)` 保证互斥（见 `index.wxss:97`），选中其他日期后今天自动回退为纯文字色。
- 圆盒 72rpx，记录点共用 10rpx 与同一 `bottom` 坐标（避免错位）。

### 首页汇总筛选标签
- 单行横滑：`scroll-view scroll-x` 外层 + 内层 `inline-flex` + 标签 `flex: 0 0 auto` + 禁止换行。
- 多选筛选（`activeTags`）；筛选态用底色 + 透明度，**不触发触觉反馈**（用户明确要求去除震动）。

### 统计图表（Canvas 2d）
- **一个指标一张图**：折线一次只画一个指标，纵轴用真实绝对值（kg / cm），刻度 `max / mid / min` 三档且小数位统一；`min === max`（只有 1 次测量）时只标中间一个值。**禁止再把不同单位的指标归一化到同一根纵轴**（100% 指数化已废弃：稀疏 + 不同单位和短窗口下信息量为 0）。
- 多个折线指标改用「**指标概览格**」并列呈现：每格 = 指标名 / 当前值 / 与首次测量的差（仅 1 次记录写「仅 1 次」），点选切换下方大图；未选中 `--color-field` 底，选中 `--color-surface` 底 + `--color-accent-ink` 描边（不用实心深底、不用阴影）。
- 柱状与折线统一：**指标概览格 + 单指标大图**；0 基线必须保留。同单位共带的规则只保留给未来的同类目多序列。
- 图例只列非空序列且只在多序列（柱状）时出现；折线单指标不显示图例。
- **全项目只有一个图表出口：统计页**。成长页不再画图，月报页已移除；二级页不重复画统计页已有的图。

### 图标体系（SVG mask，强制）
- 源：`miniprogram/assets/icons/*.svg`（Lucide 风格，`stroke="currentColor"`）。
- 渲染：`background: currentColor` + `-webkit-mask / mask: url("data:image/svg+xml;base64,…") no-repeat center / contain`（**data-URI base64 内联，微信禁止引用本地 SVG**）。
- 微信约束：只用 shorthand `mask`，**不支持 longhand**（mask-image 等会导致不渲染）；mask-size 不用含 `auto` 的组合；颜色一律走 token。

---

## 5. Layout Principles

- 间距刻度（rpx）：`xs 8` / `s 16` / `sm 24` / `m 32` / `ml 40` / `l 48` / `xl 64`。
- 头部水平内边距令牌 `--nav-edge-inset: var(--space-ml)` = 40rpx（返回箭头左缘、关闭 × 右缘统一此值）。
- **底部导航固定贴底**：页面与滚动区底部预留 `var(--tab-height) + env(safe-area-inset-bottom)`；首页 `.home-results` 额外预留 FAB 高度。
- **Canvas（`#statisticsChart`）绝不可放入任何 `scroll-view`**（否则绘制层与页面滚动错位）。统计页用**页面级滚动**，图表置于最后一个 `</scroll-view>` 之后。测试检查此项。
- 首页记录区：`.metric-slot` 单列全宽；左侧时间轴轨道 `--rail-gutter 32rpx`，时间位于卡片上方并与节点对齐；竖线跨槽位延续，末项收于底部。
- 头部固定原则：凡内容可能超长，头部（返回/关闭）固定，只滚内容区；二级页 `.sub-nav` sticky。
- 统计页因 canvas 不能进 `scroll-view` 只能页面级滚动，头部用 `position: sticky; top: 0; z-index: calc(var(--layer-tab) + 10); background: var(--color-bg)` 吸顶；**安全区 + `--tab-page-top` 的偏移写在头部自身的 `padding-top`**（容器 `padding-top: 0`），保证吸顶前后位置不跳；满宽用 `margin: 0 calc(var(--space-m) * -1)` + 自身左右 padding（同 `.sub-nav`）。

### ⚠️ `box-sizing` 真实范围（重要）
- **`box-sizing: border-box` 只在 4 处局部定义**（app.wxss 211 / 390 / 573 / 1003 行），**项目没有全局 border-box**。`frontend-standard.md` 第 8 行称"项目有全局 box-sizing"是**过时错误**。
- 因此新增 padding / border **可能撑大元素尺寸**；改动前须确认该元素是否已局部启用 border-box，或显式补上，避免横向溢出。`.metric-slot` 等已启用 border-box 的需保留。

---

## 6. Depth & Elevation

- **`--shadow-card: none`**：卡片无阴影无边框，靠 surface/field 与背景的明度差分层。
- 整理态不改变卡片位置，也不添加拖动专属阴影。
- **禁止阴影堆叠**、禁止毛玻璃：`--material-bg/--material-edge/--material-blur` 为早期遗留 token，**当前无任何应用对象，新增界面不得启用**。
- 弹层 sheet 用 surface 实色，不靠阴影浮起。

---

## 7. Do's and Don'ts（评审官核心清单）

### Do
- 所有颜色 / 尺寸 / 圆角 / 间距 **一律引用令牌**；页面 WXSS 不写裸值（rpx/px/hex 会被 `check-project` 拦截）。
- 底部 tab-bar 维持：**不透明 `bg-mesh-base` 实底 + 无顶线 + 无额外 padding + 选中=accent-ink 文字+加粗图标线**。
- 「实心底 + 浅/白字」控件用 `--color-accent-ink`（5.4:1），不用 `--color-accent`（2.9:1）。
- 统计页 Canvas **放在所有 `scroll-view` 之外**，用页面级滚动。
- 日历「今天」与「选中」**互斥**：today 仅 accent-ink+字重，selected 才实心圆。
- 首页标签行：scroll-view scroll-x + inline-flex + `flex:0 0 auto` + 不换行；多选靠底色，**不震动**。
- 圆角：卡片 28 / 控件 20 / sheet 40 / 图标 8；间距走刻度令牌。
- 深浅色用 `mode-light` / `mode-dark` 类切换；页面 WXSS 不硬编码颜色，强调色随主题自适应（深 `#6FA8DC` / `#A8C8E8`）。
- 图标用 SVG mask data-URI 内联 + 令牌色。
- 头部固定、只滚内容；`.sheet-heading` `flex-shrink:0` + `.sheet-scroll` `flex:1`，状态栏高度只加一次。
- 新增 padding/border 前确认 border-box 范围，避免撑大。

### Don't
- ❌ 给 tab-bar 加 `border-top` / surface 背景 / 额外 padding（用户两次回退此改动）。
- ❌ 用 `--color-accent` 承载小字号文字或白字实底（对比度不达标）。
- ❌ 把 Canvas 放进 scroll-view。
- ❌ 引入规范外渐变 / 阴影堆叠 / Emoji / 毛玻璃 / 无关插画（mesh 背景只限页面根）。
- ❌ 假定全局 border-box 而随意加 padding/border（仅 4 处局部生效）。
- ❌ 用 Emoji 或位图图标代替 SVG mask。
- ❌ 仅用颜色表达选中/禁用/已读状态（可访问性：须有形状/文字/图标区分）。
- ❌ 把 sheet heading 包进 scroll-view，或在 content 内联 `padding-top` 叠加状态栏。
- ❌ 为单个类目另开图表出口；在二级页重复画统计页已有的图。
- ❌ 标题用负数 letter-spacing（微信渲染不稳）。
- ❌ caption 字号 < 14px。
- ❌ 日历让 today 与 selected 同时实心（无法区分用户选中了哪天）。

---

## 8. Responsive Behavior

- 小程序无 CSS 媒体查询断点；用 **rpx 自适应 + flex** 布局。设计基准 750rpx = 375pt。
- 最小触控目标 **44px**：`--control-height max(88rpx,44px)`、`--input-height max(96rpx,44px)`、`--nav-height / --tab-height` 触控按钮 ≥ 44px。
- 周历全宽七列，320px 屏每列 ≥ 44px。
- 单一蓝主题（浅/夜），**非多皮肤**；夜间靠 `mode-dark` 类而非独立皮肤文件。
- Canvas 须 `type="2d"` + `devicePixelRatio` 适配，保证高清绘制。
- 安全区：`env(safe-area-inset-bottom)` 用于 tabBar 与 FAB 底部预留；真机校验 iOS/Android 底部可达性。
- 浏览器映射可验证几何/主题，但**不能替代微信编译、原生 picker/switch、键盘、安全区、读屏真机测试**。

---

## 9. Agent Prompt Guide（快速参考 + 即用提示词）

### 速查色
```
装饰蓝  --color-accent        #5b9bd5  (2.9:1 装饰/进度，禁承载文字)
强调墨  --color-accent-ink    #2e6da6  (5.4:1 按钮底/选中文字)
表面    --color-surface       #ffffff / 深 #1d2a37
表单    --color-field         #f1f5f9 / 深 #243343
主文字  --color-text-1        #26343f
次文字  --color-text-2/3      #52687b
分隔线  --color-divider       rgba(38,52,63,.12)
圆角    卡片28 控件20 sheet40 图标8
间距    xs8 s16 sm24 m32 ml40 l48 xl64
```

### 即用提示词（CODEX / 任意编码 agent）
1. **生成**：「按照项目根目录 `DESIGN.md` 的设计语言，实现 <页面/组件>，所有颜色尺寸引用令牌，禁止硬编码与规范外样式。」
2. **评审**：「你是 SlowNote 的 UI 评审官。读取根目录 `DESIGN.md`，审计 `miniprogram/pages/<目标页>` 的 WXML/WXSS/JS，逐条对照第 7 节 Do/Don't 与第 2/3/4 节令牌，输出 P0/P1/P2 违规清单（含 file:line、违规点、应改为的令牌值），并列出已合规项。仅评审不改码，除非我明确要求。」
3. **对比修复**：「`DESIGN.md` 第 7 节禁止 <某项>。当前 <文件:行> 违反了，给出最小改动修复并解释为何符合令牌体系。」
4. **可访问性**：「检查 <页面> 是否存在仅用颜色区分的状态（选中/禁用/已读），按 DESIGN.md §4/§7 补充形状或文字区分。」

> 红线（评审/生成均适用）：不动 `node --test` 基线（当前 97 用例 / pass 90 / fail 7，7 个为既有失败，与本次无关）；不要为变绿去改测试；Canvas 不入 scroll-view；`frontend-standard.md` 中"全局 border-box"描述为错误，以本文第 5 节为准。

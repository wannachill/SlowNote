# 一迈一记（SlowNote） 研发避坑指南

> 2026-11-09 更正：下方统计图表裁剪条目中按 `viewClip` 裁剪和依赖 Canvas 随 `.chart-scroll` 移动的两种方案均已作废，以本页新增的固定画布 + 透明占位层虚拟滚动方案为准。2026-10-28「图表位于最后一个 `</scroll-view>` 之后」的检查仅适用于小迈主页面的纵向滚动隔离，不适用于统计详情页（该页 Canvas 位于滚动层之前且固定为视口宽）。

## 统计详情横滑复盘（2026-11-09）

- 现象：横滑后左侧越框、右侧空白，横轴刻度与折线消失。
- 根因：宽 canvas 位于 scroll-x 内，原生滚动位移与绘制层裁剪/平移在不同基础库上的叠加关系不一致；此前两种假设式修补均失败。
- 修复：canvas 脱离滚动容器，物理位图保持视口宽、逻辑布局使用 `chartWidth`，透明占位层产生滚动量，绘制时固定裁剪 `[0, viewWidth]` 并平移 `-scrollLeft`。
- 防复发：禁止原生 canvas 作为宽于视口的滚动子节点；测试断言裁剪矩形恒从 0 开始且 translate 恰为 `-scrollLeft`。

## 1. 需求与范围

| 风险 | 预防 |
|---|---|
| 把示例当需求 | 只实现 PRD 已确认内容；未知项写 `[待补充：说明]` |
| 范围悄然扩大 | 变更前说明新增范围、成本和验收影响 |
| 用技术猜业务 | 权限、状态、数据和角色均由需求确认 |

## 2. 前端

- 不在页面散落请求、权限和持久化逻辑。
- 不把 UI 隐藏当权限控制，不吞掉失败或重复提交。
- 不依赖单一设备尺寸、颜色提示或仅鼠标操作。
- 小程序：避免主包超限、跨分包引用、未授权调用敏感 API 和只做模拟器验证。
- 绝对定位弹窗不能挂在带 overflow/滚动裁剪的容器内（会只显示部分内容），改用 fixed + 实测坐标定位；视觉值一律走 token，check-project 会拦截硬编码（rpx/px/色值），删除样式块后必须做花括号平衡校验。

## 3. 后端与数据

- 不信任客户端身份、金额、权限或状态；服务边界必须重新校验。
- 不做无界查询、无限重试、无超时调用或不可追踪的静默降级。
- 不记录密钥、令牌、完整个人信息和敏感请求体。
- 写操作缺少幂等和并发策略会产生重复与覆盖；在接口契约中显式定义。
- 数据迁移无备份、采样验证和回滚不得执行。
- 云权限规则不能用测试期全开放配置进入生产；关注配额、冷启动和执行上限。

## 4. 工程与交付

- `project.config.json` 和 `project.private.config.json` 已是完整文件名，禁止追加扩展名。
- 依赖升级必须查看破坏性变化并执行回归。
- “本地能跑”不等于完成；构建、测试、目标端和回滚均需证据。
- 文档索引只引用实际生成文件，条件关闭时同步删除引用。

## 5. 复盘记录

| 日期 | 现象 | 根因 | 修复 | 防复发 |
|---|---|---|---|---|
| 2026-10-26 | 用户反馈统计页固定底部 TabBar 占高偏大；原 tab 高度令按钮垂直留白多，首页和子页滚动内容也没有与紧凑栏高统一预留空间 | `--tab-height` 56px，TabBar 额外上下 padding；只有部分 Tab 页有内容预留 | TabBar 高度令牌降为 48px、触控按钮仍至少 44px，移除额外顶部 padding；所有 `.page` 与 Tab 页中部滚动区按新高度加安全区预留；首页记录改为独立 scroll-view、日期/标题与 FAB 保持固定 | 缩小导航视觉高度时保留系统 `env(safe-area-inset-bottom)` 和最小触控区；同步检查 FAB 定位和短屏底部可达性 |
| 2026-10-22 | 删除样式块后残留孤儿 } 致 wxss 编译报错；数据范围弹窗被 composer 的 overflow 裁剪只露部分选项 | 按行删除边界差一行；absolute 弹窗受父级 overflow 裁剪 | 修复残留并全量花括号平衡校验；弹窗改 fixed + createSelectorQuery 实测坐标 | 交付前跑花括号平衡脚本与 check-project |
| 2026-10-23 | CODEX Apple 精修给 .tab-shell 加了 border-top 顶线与 surface 实色背景；随后调 padding-bottom 撑高 tabBar，把固定于其上的首页 FAB 盖住；按钮下方出现大片空白 | 顶线/背景违反用户既定偏好（无顶线、无背景、贴底）；padding-bottom 过大 + 模拟器 env(safe-area-inset-bottom)=34px 使按钮离底过远；tab-item 内容垂直居中产生对称空隙 | 移除 border-top 与 background（透明）；padding-bottom 收敛为仅 env(safe-area-inset-bottom)；.tab-item 改 justify-content: flex-end 贴安全区上沿；FAB bottom 上调为 calc(var(--tab-height) + var(--space-ml) + safe-area) 防遮挡 | 改动 tabBar 前先核对用户已确认形态（无顶线/无背景/贴底）；安全区用 env() 保留真机安全，内容用 flex-end 贴安全区上沿而非居中；改 tabBar 高度必须同步检查 FAB 定位 |
| 2026-10-23 | CODEX Apple 精修（22 WXSS + 4 WXML）交付后未同步 docs，导致 frontend-standard 多处与实际代码不符：control-height/input-height 旧值、§7.1 仍写毛玻璃应用对象（实际已全部移除）、sheet-reveal overshoot 描述（实际已减弱）、品牌标识棕底描述（实际为蓝色线条宝宝头）、utils 清单缺 haptics.js、介绍文档缺常见问题入口 | CODEX 只交付样式报告（apple-design-polish-20261023.md），规范文档未自动回写 | 逐项对照报告与代码实测（grep app.wxss 的 token/keyframes/backdrop-filter）后回写：§2 尺寸值、§7.1 改为纯色分层、§7.2 无 overshoot 两帧、§7.3 补 semibold、品牌标识描述、project-structure 补 haptics.js、introduction 补四入口 | 每次 CODEX 交付后：先跑 check-project + 实测关键 token/keyframes，再按报告逐条回写 docs；规范中凡是"应用对象/数值"必须有 grep 证据，不凭报告措辞 |
| 2026-10-28 | 统计图表曾在滚动中与页面内容错位 | Canvas 位于增强纵向滚动容器内时绘制层和页面滚动不同步 | 统计页改为页面级滚动，`statisticsChart` 放到全部 `scroll-view` 之后 | Canvas 不放进纵向滚动容器；测试检查图表位于最后一个 `</scroll-view>` 之后 |
| 2026-10-28 | 统计 X 轴标签挤在一起或日期不均匀 | 日期格式宽度超过可用槽位，固定抽样步长在范围变化时不适用 | 标签仅显示日号，跨月时补充月份；按测量的最宽标签与槽位间距动态抽稀，并保留末端标签 | X 轴抽稀根据标签宽度与坐标槽位计算，不用固定日期数量 |
| 2026-10-28 | 分组柱与日期标签看起来未居中对齐 | 柱组和轴刻度各自对真实日期坐标增加了偏移 | 柱组、日期标签共享日期中心；分组柱以日期中心对称排列 | 图表保持一套日期坐标基准；以 1、2、3 条序列分别检查分组中心 |
| 2026-10-28 | 首页汇总筛选标签换行或无法横向滑动 | 横向滚动容器、内联弹性宽度和子项不收缩必须共同成立 | 外层使用 `scroll-view scroll-x`，内层用 `inline-flex`，标签 `flex: 0 0 auto` 并禁止换行 | 横向标签保留三项组合，避免内层普通 flex 撑满视口造成无溢出判断 |
| 2026-10-28 | 统计指标 pill 的白字对比不足 | 实心强调底使用装饰色而非满足文字对比的强调墨色 | 选中 pill 使用主题强调墨色底，白字由主题对比色承载 | 承载文字的实心底采用 `--color-accent-ink`；`--color-accent` 留作装饰和进度 |
| 2026-10-28 | 底部导航区域透出页面内容 | 固定导航容器背景为透明，底栏与页面层级无法形成不透明隔离 | `.theme-root.tab-shell` 使用 `var(--bg-mesh-base)` 背景，保留无顶线样式 | 检查底栏背景和层级；项目控件已有全局 `box-sizing: border-box`，视觉上不加分隔线 |
| 2026-10-28 | 日历今天文字与记录点间距不足，周历与月历标记不一致 | 圆形标记盒与行盒余量不足，记录点曾使用不同定位边 | `.calendar-number` 使用 `box-sizing: border-box`；圆盒 72rpx，记录点共用 10rpx 尺寸和 `bottom` 定位 | 同组圆点只用同一个 `bottom` 坐标和尺寸；先核对文字行盒再定圆盒尺寸 |
| 2026-10-28 | 后端数据或图表功能完成后，页面仍可能停留在旧版展示 | 只检查云函数或公共图表实现，没有确认页面实际调用和消费响应字段 | 在页面接入点核对 `action: 'trend'`、`series` / `totals` 消费及图表绘制入口 | 接口与数据改动交付必须提供页面侧实际调用和字段消费证据；云端完成不等于端到端完成 |
| 2026-11-09 | 统计详情图表横向滚动时，折线、数据点标注与横轴刻度越过白色卡片右边界，画到边框外的页面背景上 | 给 `.statistics-chart` / `.chart-body` / `.chart-scroll` 加 `overflow:hidden`、`clip-path:inset(0)` 只裁剪 WebView 层；`canvas type="2d"` 是原生绘制层，整张 `chartWidth` 宽的位图仍会被完整绘制，右侧仅 ~56px 的渐变遮罩盖不住几百 px 的溢出区 | 改在绘制层解决：`utils/chart.js` 的 `drawFrame()` 先 `clearRect` 全画布，再按 `geometry.viewClip = { left: scrollLeft, width: 视口宽 }` 执行 `ctx.rect + ctx.clip`，可视切片外保持透明；`clipViewport()` 在 `paint()` 首帧、`onChartGeometry()` 与 `onChartScroll()` 中更新切片并重绘，页面用 16ms 合并滚动事件。该方案已作废，以虚拟滚动为准 | 原生组件（canvas / map / video）不能靠祖先容器的 overflow / clip-path / 渐变遮罩裁剪；凡 canvas 宽于容器，必须在绘制时按滚动偏移裁剪位图，并用单元测试断言 clip 矩形等于「滚动偏移 + 视口宽」 |
| 2026-11-09 | 横滑图表时下方明细乱跳，并产生大量 `action:'daily'` 云函数调用 | `onChartScroll` 的防抖把视口中心日期当作选中日期，并调用 `selectChartDateValue` | 滚动只做绘制裁剪，日期切换收敛到 `onChartTap` | 滚动事件处理函数中禁止出现日期换算与云函数调用；测试断言横滑前后 `selectedDate` / daily 请求数不变 |
| 2026-11-09 | 横滑后图表挤到卡片左侧，右半区域空白且网格线越过左边界 | Canvas 节点已经随 `.chart-scroll` 移动，绘制层又额外执行 `ctx.translate(-viewOffset, 0)`，滚动偏移被应用两次；裁剪窗口固定在 bitmap 左端也让透明区域跟着 Canvas 一起漏出容器 | 在画布内容坐标按 `[viewOffset, viewOffset + viewWidth]` 裁剪绘制，不再额外平移；scroll-view 负责 Canvas 节点位移。该方案已作废，以虚拟滚动为准 | 测试断言裁剪矩形左端等于滚动偏移且不存在额外 translate；真机检查横滑后的卡片左右边界、横轴与折线连续可见 |
| 2026-11-11 | 定时报告「云端每 5 分钟在跑却从不生成通知」，云日志稳定返回 `403 TIMER_ONLY` | 定时器护栏用 `event.Type === 'Timer'` 作唯一判据，而平台下发的事件里该字段并不总是 `Timer`，真实定时调用被自己拦掉 | 判据改为「无客户端 OPENID 且 `TriggerName=aiReportTimer`」，`event.Type` 只作参考；`aiTasks`/`aiReport` 重建定时器后需在控制台核对触发器仍在 | 凡是定时器护栏只认 `TriggerName` + 无 OPENID；`event.Type`、`Type` 等平台字段不得作为唯一放行条件，改动后必须看一次真实触发日志而不是本地 mock |
| 2026-11-11 | 云函数改了共享库后，个别函数行为仍旧，前端拿到的字段与文档不符 | 只改了 `cloudfunctions/_shared/`，忘了跑 `node scripts/sync-cloud-runtime.js`，或同步了但没在控制台重新部署对应函数 | 改 `_shared/` 后先同步再逐个部署受影响函数；交付时列出必须重新部署的函数清单 | 任何 `_shared/` 变更按「改源码 → 同步 → 部署 → 日志验证」四步走；`tests/references.test.cjs` 校验各函数 `lib/` 与 `_shared/` 一致，不要绕过 |
| 2026-11-11 | 用脚本删除 `custom-tab-bar/index.wxss` 的角标样式块后，文件里出现重复样式块与多余的 `@media` | 脚本用 `indexOf('@media (prefers-reduced-motion'))` 取块尾，命中了更靠前的同名锚点，切片范围错位；一次性删除多个块又叠加了位置偏移 | 改为按行号重建整个文件（保留有效头尾段），并核对行数、`grep` 目标关键字为 0、花括号平衡 | 批量删除样式块禁止用 `indexOf` 找同名锚点；优先按行号定位或逐块 `Edit`，改完必须做花括号平衡 + 关键字残留检查 |
| 2026-11-11 | 微信消息始终发不出，`ai_notifications` 记录 `delivery.code` 恒为 `501 TEMPLATE_NOT_CONFIGURED`；`aiTasks` 已配 `AI_REPORT_TEMPLATE_ID` 仍无效 | `aiReport` 只读取 `AI_REPORT_TEMPLATE_ID`（`aiReport/index.js` 第 10 行），但云端 `aiReport` 配的是 `REMINDER_TEMPLATE_ID`（无效变量名，代码不读）；且模板 ID 含 `O`/`0` 易混淆、控制台截图会截断，手抄易漏末段或抄反 | 在 `aiReport` 新建 `AI_REPORT_TEMPLATE_ID`（值同 `aiTasks`），删除无效 `REMINDER_TEMPLATE_ID`，重新部署两函数；模板 ID 从公众平台「我的模板」复制粘贴，不手抄 | 部署前按本表 §3 核对两函数变量名**均为** `AI_REPORT_TEMPLATE_ID` 且值一致；模板 ID 严禁手抄截图，必须复制粘贴并核对第 9 位为数字 `0` |
| 2026-11-12 | 里程碑标题行同时显示「N 项」和新增入口，右侧信息显得拥挤、与定时报告页面不一致 | 标题旁保留了列表计数，但该页主操作是新增；计数不是用户完成当前操作所需的信息 | 移除数量文字，新增入口放在标题行末尾，复用定时报告的全局 `.link-btn` 和「＋ 添加」文案 | 同类列表页的主要新增操作统一放在标题行；除非计数参与筛选或决策，否则不要在标题边重复展示条目数；模板/自动化测试检查按钮位置、文案和旧 FAB 已移除 |
| 2026-11-12 | 定时报告标题输入框下方的说明占据额外一行，且内容重复说明用途 | 输入框 placeholder 已说明标题用途和 20 字限制，额外的字数/用途说明在标题较长时还会换行 | 删除标题字段下方的说明行，只保留字段标签、输入框 placeholder 与原有 `maxlength` 校验 | 表单说明只在能补充输入规则且无法由控件表达时保留；避免 placeholder 与独立说明重复；调整字段时同步检查表单顺序测试和视觉换行 |
| 2026-11-12 | 小迈页面进入时短暂显示已关闭的「深度思考」开关 | 本地账号缓存可能仍保留旧的 `showThinking=true`，页面在当前账号服务端设置返回前就用缓存渲染开关 | 设置确认前默认隐藏开关；仅服务端返回布尔配置后决定显示，设置读取失败或响应无效时按关闭处理；有效的账号缓存若明确为关闭可直接保持隐藏 | 配置型 UI 的显示权以当前账号的服务端设置为准；旧缓存不能让已关闭能力闪现，缓存必须维持 openid 隔离；测试覆盖缓存开启但服务端关闭、未确认阶段不渲染及读取失败时关闭 |

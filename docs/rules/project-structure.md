# 一迈一记工程结构
> 更新日期：2026-11-11｜本文列出实际目录，不以未实现的推荐层次冒充现状。

~~~text
miniprogram/
  app.js / app.json / app.wxss / theme.json
  assets/icons/                 # SVG mask 图标源
  styles/                       # record-icons.wxss、motion.wxss
  templates/                    # 可复用 WXML 模板
  components/
    net-banner/                 # 断网与网络异常横幅
  custom-tab-bar/               # 首页 / 小迈 / 我的
  utils/                        # 30 个前端工具模块，清单见下
  pages/
    index/ statistics/ mine/    # 三个底部 Tab
    statistics-detail/          # 分类趋势详情（二级页）
    feeding/ solid/ excretion/ growth/ milestone/ diary/
    baby/ theme/ ai-settings/
    ai-chat/ ai-history/ ai-tasks/ ai-notifications/ custom-record/
cloudfunctions/                 # 15 个可调用云函数 + _shared
  _shared/                      # runtime/aggregation/record-details/llm/schedule/ai-settings 唯一共享源码
  aiChat/ aiNotifications/ aiReport/ aiSettings/ aiTasks/ asrProxy/
  babyProfile/ customRecord/ diaryRecord/ feedingRecord/ growthRecord/
  homeCards/ login/ milestoneRecord/ statistics/
scripts/
  sync-cloud-runtime.js         # 同步共享源码到 14 个受管函数 lib/
  check-project.js              # 项目注册与一致性检查
tests/                          # 40 个 *.test.cjs 文件 + helpers.cjs
  ai-chat-images.test.cjs ai-chat-snapshot.test.cjs ai-chat-voice.test.cjs ai-settings-cache.test.cjs ai-settings-questions.test.cjs
  baby-profile.test.cjs chart-bars.test.cjs chart-selection.test.cjs common-questions.test.cjs copy-terse.test.cjs
  custom-record-validation.test.cjs feature-retirement.test.cjs growth-multi-measurement.test.cjs
  home-cache.test.cjs home-card-edit.test.cjs home-card.test.cjs home-timeline.test.cjs
  interaction-motion.test.cjs list-swipe-performance.test.cjs llm-encoding.test.cjs markdown.test.cjs milestone-defs.test.cjs
  milestone-entry.test.cjs milestone-gestures.test.cjs mine-profile.test.cjs navigation-routing.test.cjs
  page-cache.test.cjs question-categories.test.cjs record-details.test.cjs record-mutations.test.cjs references.test.cjs
  registration.test.cjs report-history.test.cjs report-scope.test.cjs slownote.test.cjs
  statistics-action.test.cjs statistics-brief.test.cjs statistics-detail-core.test.cjs statistics-detail.test.cjs
  statistics-insights.test.cjs
docs/
  CLAUDE.md database-design.md deployment-checklist.md
  prd/slownote-prd.md
  rules/backend-standard.md rules/code-style.md rules/frontend-standard.md
  rules/git-workflow.md rules/introduction.md rules/pitfalls.md
  rules/project-structure.md
~~~

## 前端工具模块
`miniprogram/utils/` 当前有 30 个 JavaScript 文件：`ai-photos.js`、`ai-sessions.js`、`ai-settings.js`、`api.js`、`avatar.js`、`categories.js`、`chart.js`、`common-questions.js`、`confetti.js`、`date.js`、`digest.js`、`format-number.js`、`haptics.js`、`home-cards.js`、`home-refresh.js`、`list-patch.js`、`markdown.js`、`milestone-overview.js`、`motion.js`、`net.js`、`page-cache.js`、`page.js`、`record-scope.js`、`references.js`、`registration.js`、`reveal.js`、`statistics-detail-core.js`、`statistics-insights.js`、`theme.js`、`viewmodels.js`。

`utils/common-questions.js` 的 7 类数据类型是端侧唯一枚举来源，常见问题与定时报告共用；`cloudfunctions/_shared/record-details.js` 镜像类别键并由 `tests/record-details.test.cjs` 校验一致，负责字段白名单、服务端明细渲染和共享长度预算；`pages/ai-tasks` 另在页面内维护 `ALL`（类型）、`RANGES`（报告数据范围）与 `rangeName/rangeHint` 三个纯函数，报告范围的语义以 `cloudfunctions/_shared/schedule.js` 的 `REPORT_RANGES` 为准，两边改动必须同时进行。

`utils/page-cache.js` 是页面读缓存：内存 + 本地存储双层，键为「作用域 + 参数」，默认 60 秒可复用，超过 64KB 的结果只留在内存。记录类写操作经 `utils/home-refresh.js` 的 `invalidateRecords()` 按 `home` / `statistics` 作用域失效；退出登录由 `app.logout()` 整体清空。首页与小迈优先渲染缓存再静默校验，`load(true)` 或下拉刷新跳过缓存，但都不会清空已有内容闪骨架。

`utils/list-patch.js` 用数组路径只更新列表行中变化的字段，供滑动等高频交互复用；用户编辑的常见问题存储按 openid 分桶，无法确认账号归属的旧共享键会被清理。

常见问题数据和端侧存储工具仍保留；管理入口已并入 `pages/ai-settings/`，没有单独的常见问题页面。`utils/common-questions.js` 同时定义常见问题的 6 档取数范围（今天/近 7 天/本周/本月/近 30 天/本年）与 7 类数据类型及内置默认类别——这 6 档是**提问时**的取数范围，与定时报告的 5 档 `range` 不是同一套枚举，不要互相套用；`utils/digest.js` 请求统计云函数返回的服务端渲染明细，并按响应的 `detailsLimit` 展示/裁剪，不接收原始记录集合。`confetti.js` 仍用于发育里程碑达成效果。

## 云函数同步
`cloudfunctions/` 有 15 个可调用函数（不含 `_shared`）：`aiChat`、`aiNotifications`、`aiReport`、`aiSettings`、`aiTasks`、`asrProxy`、`babyProfile`、`customRecord`、`diaryRecord`、`feedingRecord`、`growthRecord`、`homeCards`、`login`、`milestoneRecord`、`statistics`。

`scripts/sync-cloud-runtime.js` 当前同步 14 个函数目录的 `lib/`：`statistics`、`babyProfile`、`customRecord`、`aiChat`、`aiTasks`、`aiNotifications`、`aiReport`、`aiSettings`、`asrProxy`、`feedingRecord`、`growthRecord`、`diaryRecord`、`homeCards`、`milestoneRecord`。`login` 不依赖该同步产物。改 `_shared/` 后先运行同步脚本，再部署相应云函数。

药品/护理类日常记录页面及相关云端接口已移除；常见问题独立页面已移除。智能提醒（`pages/reminder`、`cloudfunctions/reminderRecord`、`reminder_items` 写入链路）已于 2026-11-11 整体下线——定时提醒与手机闹铃/日程重复，且一次性订阅无法保证送达；「信息推送」中转页也随之删除，入口直连定时报告。花销新增入口与统计已下线，`expense_records` 仅作为历史数据保留。家庭管理入口和相关函数已下线，已有家庭成员/归属字段仍用于历史数据范围兼容。

## 报告数据流（定时报告 → 历史报告）
配置在 `pages/ai-tasks`（`aiTasks`）：每条任务存 `categories[]`（7 类，多选）、`range`（`auto|today|3d|7d|30d`，与频率解耦）、`frequency` + `time`（+ `weekday`）、`enabled`、`next_run_at` 与租约字段。`range` 为 `auto` 时跟随频率：`daily`=今天、`weekly`=近 7 天、`monthly`=上月整月；`monthly` 无论存什么值都由 `aiTasks` 归一为 `auto`，`aiReport` 也不会为它套用显式范围。

生成在 `aiReport`（`aiReportTimer` 每五分钟）：`reportWindow(frequency, now, range)` 算出左闭右开窗口 → `aggregate(..., categories)` 只读取所选数据类别并切分喂养/辅食/便便 → `buildDetails(data, categories)` 输出一行计数概览与按日期倒序的白名单登记明细（每类最多 20 条、统一长度预算、明确未展开数量，里程碑名称按 scope + baby_id + key 查定义，缺失回退 key）→ `redact()` 后交给模型 → 正文写入 `ai_notifications`，运行态写入 `ai_runs`（同一计划时刻确定性 `_id` 保证不重复生成）。问答的 `statistics.range` 复用同一 renderer，只向小程序返回渲染文本和数值概览，不下发原始记录；空选类别跳过记录查询。投递是入库后再标记一次尝试，微信发送失败不影响站内记录。

展示在 `pages/ai-notifications`（`aiNotifications` 的 `list` / `read` / `remove`，全部按 openid 校验归属）：卡片未读圆点由 `read` 字段驱动，打开详情即标记已读，左滑删除走 `mutation_receipts` 幂等。底栏不展示未读数字角标，`aiNotifications` 也不提供 `unreadCount`。

## 页面与统计
`miniprogram/pages/` 当前 18 个页面：`index`、`statistics`、`statistics-detail`、`feeding`、`solid`、`excretion`、`growth`、`milestone`、`diary`、`mine`、`baby`、`theme`、`ai-settings`、`ai-chat`、`ai-history`、`ai-tasks`、`ai-notifications`、`custom-record`。底部 Tab 为首页/小迈/我的。

`statistics` 是小迈主页面：范围选择、通用问答入口和六类概况卡。进入页面先渲染 60 秒内的缓存结果，再按需静默校验，切 Tab 不重复请求；切换范围或下拉刷新才跳过缓存，且不清空已有卡片。仅展示范围内有记录的类别；范围内完全无数据时隐藏概况卡片区并显示登记引导。成长/喂养为多项指标卡，统一三列：标签｜数值+单位｜环比变化，变化不重复单位；其余为单指标卡。`statistics-detail` 显示分类指标、趋势图与选中日期当天该类型记录，不含日历热力图；统计范围从概况卡入口传入。横滑由 `.chart-scroll` 内的透明占位层驱动，明细在 `.detail-scroll` 纵向滚动，页面容器不滚动且禁用整页下拉刷新。横滑只浏览趋势、不刷新当天明细；点选吸附到最近的有登记值日期，空白日期不切换、不请求后台，点选登记日才触发 daily 查询。数值标签集合与选中态无关，每个有值点始终显示数值。`utils/chart.js` 的 `seriesChart()` 由 `statistics-detail` 调用。Canvas 固定为视口宽并位于 `.chart-scroll` 外，滚动层内的透明占位层宽为 `chartWidth`；逻辑布局按 `chartWidth` 计算，`drawFrame()` 固定裁剪 `[0, viewWidth]` 并将逻辑内容平移 `-viewOffset`，不依赖 Canvas 节点随滚动容器移动。选中日期以加粗实心节点显示，不画竖向高亮虚线。日历热力图模块 `utils/heatmap.js` 与 `tests/heatmap.test.cjs` 已在死文件清理中移除，前端工具清单不再列出。

`ai-chat` 保留 WechatSI 惰性加载兼容代码，但个人主体不在 `app.json` 声明插件，加载失败后使用 `RecorderManager → asrProxy` 一次性转写；主体变更为非个人后可加回声明恢复实时预览。`tests/ai-chat-voice.test.cjs` 覆盖无插件声明、惰性加载、转写清理与卸载收尾。

统计详情的右侧纵轴使用按刻度文字宽度收缩的固定栏，数字右对齐；左侧 `.chart-plot-viewport` 绘图区在纵轴栏前结束并独立横向滚动，横线和数据不会延伸到纵轴下方。

各页面具备 `index.js` / `index.json` / `index.wxml` / `index.wxss`。所有页面使用自定义导航栏；Tab 页无原生导航标题，二级页使用 `.sub-nav`。组件、图标和主题的细节以当前源码与对应规范为准。

新增页面、函数与集合时，同步检查 PRD、数据库设计及部署清单。前端位于 `miniprogram/`，云函数位于 `cloudfunctions/`，验证工具与测试分别位于 `scripts/`、`tests/`。

历史报告日期筛选：直接选择起止日期，默认本月（北京时间月初至今天）；按报告生成时间 created_at 在云端筛选，包含起止当天。页面通过 aiNotifications 的 list 传 startDate/endDate/offset；接口返回 total/hasMore，每页 20 份，按生成时间和 ID 倒序，支持加载更多。无结果保留日期选择器并显示范围空态，快速切换时丢弃旧请求响应。

# 一迈一记 · 上线执行清单

> 创建日期：2026-11-12
> 用途：把 `docs/prd/slownote-prd.md` §8（8 项）与 `docs/deployment-checklist.md`（16 项）中**全部 24 项未勾选项**，按依赖关系重排成可逐项勾选、可执行的动作清单；另补入两份文档正文中未勾选但必须完成的前置动作（集合/权限/索引/环境变量/15 个云函数部署），以及 2026-11-12 功能审计发现的 3 项遗留（云端旧函数清理、2 处合规 `[待补充]`）。
> 本文**不修改**上述两份文档正文；勾选在本文进行，全部完成后再回填原文档对应项。
> 状态：本清单为执行台账。截至 2026-11-13，本地基线与用户确认的云端部署/配置已勾选；**云端实际取值与真机验收未经本仓库核验**，勾选不代表我方验证结论。
> 引用方式：PRD 的来源统一按「§7 小节」或「§8 第 N 项」定位，不用行号，避免 PRD 增删行后来源失效；部署清单仍按行号定位。2026-11-12 补充「登录与数据隔离」实现说明及登录硬前置，见 `docs/prd/slownote-prd.md` §7 与下方阶段 1 说明块。

## 用法

- 标记含义：`[本地]` 可在命令行代做（命令已给出）｜`[控制台]` 需微信公众平台 / 云开发控制台人工操作｜`[真机]` 需微信开发者工具或真机人工验收｜`[待确认]` 需业务方先提供信息，属上线阻塞项。
- 每项末尾的「来源」指向现有文档，动作与验收标准均以该处为准，本文不新增要求。
- 阶段按依赖顺序排列：先有库与配置，再部署函数，最后编译与真机验收。

---

## 阶段 0 · 阻塞项与本地基线

- [ ] **#01 `[待确认]` 补齐合规信息** — 确定 AI 服务商、隐私政策、数据保留与删除责任人；再补齐「敏感数据保留周期、账号/宝宝删除流程、备份恢复目标、AI 服务商数据政策及责任人」。完成后去掉两处 `[待补充：上线前确认]`。来源：`docs/prd/slownote-prd.md` §7.4、`docs/database-design.md:77`
- [x] **#02 `[本地]` 同步共享库** — 只要改过 `cloudfunctions/_shared/` 或任一 `lib/`，先执行 `node scripts/sync-cloud-runtime.js`，按输出确认已复制到 14 个函数目录。来源：`docs/deployment-checklist.md:14,20`。（2026-11-12 已执行：`_shared` 与 14 个 `lib/` 逐文件比对零差异；脚本输出 `Synced shared runtime to 14 functions`，执行后工作区无新增变更，幂等。）
- [x] **#03 `[本地]` 本地回归基线** — 执行 `node --test tests/*.test.cjs`，当前基线 **339/339 通过、0 失败**；`git status --short` 应干净。来源：2026-11-12 审计（基线以每次测试输出为准，不写死提交号）。（2026-11-12 初次执行 286/286；合并「列表手势优化 + 常见问题端侧数据按 openid 分桶」后增至 289；「记录明细替代计数快照」新增 12 例至 301；其后文案精简、历史对话左滑、标题区背景回退、左滑圆角统一累计增至 321；「默认提示词优化 + 历史默认兼容 + llm 单一来源」新增 9 例至 330；「报告正文支持 Markdown 与克制加粗」新增 2 例至 332；「长按输入框语音输入、移除麦克风按钮」新增 5 例至 337；本轮「三 Tab 页顶部留白收紧」新增 2 例，复测 339/339 通过、0 失败。改动提交并推送至 `origin/main` 后工作树干净。）

## 阶段 1 · 云环境、数据库与旧函数清理

> **登录可用性硬前置（依据 `docs/prd/slownote-prd.md` §7.3）**：#06 / #07 / #08 不只是建库步骤，而是「用户能否登录、数据是否真正隔离」的开关；另有 #04（AppID / 环境一致）与 #16（部署 `login`）共同决定登录链路。未完成的后果：#06 缺 `users` 集合 → `login` 自动建档报错、全员停在未登录态；#07 未收紧客户端权限 → 客户端可绕过云函数直连数据库，存在越权读取风险；#08 缺唯一索引 → 同一 openid 可能重复建档；#16 未部署 `login` → 前端静默保持未登录。真机验收建议随 #27 / #33 一并验证两个微信号数据互不可见、同账号退出重登与换设备后数据可恢复。

- [ ] **#04 `[控制台]` 确认环境标识** — AppID `wx27a55616539c8020`、云环境 `cloud1-d6gil7n3u02d7414e` 与 `miniprogram/app.js` 的 `wx.cloud.init` 一致。来源：`docs/deployment-checklist.md:10`（原 D4）
- [ ] **#05 `[控制台]` 测试不写生产数据** — 使用现有正确云环境，客户端与测试账号不得写入生产数据。来源：`docs/deployment-checklist.md:9`（原 D3）
- [ ] **#06 `[控制台]` 创建 16 个集合** — `users`、`babies`、`family_members`、`feeding_records`、`custom_records`、`diary_records`、`growth_records`、`milestone_defs`、`milestone_records`、`ai_settings`、`ai_tasks`、`ai_notifications`、`ai_runs`、`ai_sessions`、`ai_rate_limits`、`mutation_receipts`；历史集合 `families`/`expense_records`/`reminder_items` 按现状保留，不新增、不读写。来源：`docs/deployment-checklist.md:61`。**【登录硬前置】** `login` 先查 `users`，缺集合则自动建档失败、所有人无法登录（PRD §7.3）。
- [ ] **#07 `[控制台]` 设置客户端权限** — 除 `ai_sessions` 外全部「所有用户不可读写」；`ai_sessions` 放行「仅本人读写本人记录」（`doc.openid == auth.openid`）；`ai_settings` 文档 ID 为 `hash(openid)`，仅云函数访问。来源：`docs/deployment-checklist.md:63,65,66`。**【登录硬前置】** 未配置前客户端可绕过云函数直连数据库，openid 隔离不生效（PRD §7.3）。
- [ ] **#08 `[控制台]` 建立索引** — 按 §4 索引表逐条建（`users.openid` 唯一、`ai_tasks: enabled + next_run_at + lease_until`、`ai_notifications: openid + created_at` 及 `delivery_status`、`ai_rate_limits.expires_at` 等）；控制台提示缺索引时以提示为准。来源：`docs/deployment-checklist.md:69-83`。**【登录硬前置】** `users.openid` 需唯一，避免同一微信号重复建档（PRD §7.3）。
- [ ] **#09 `[控制台]` 人工删除 6 个已下线旧云函数** — `reminderRecord`、`family`、`migrateFamilyData`、`monthlyReport`、`expenseRecord`、`sendReminder`（仓库内已移除，云端仍可能存在）；删除前按需归档 `expense_records` 与迁移产生的历史记录，保留数据库历史 `family_id` 字段。来源：`docs/deployment-checklist.md:15-18`、2026-11-12 审计

## 阶段 2 · 外部服务与小程序平台配置

- [x] **#10 `[控制台]` 配置 LLM 变量** — `aiChat`、`aiReport` 配 `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL`；`aiChat` 另配 `LLM_VISION_MODEL`（图片分析）。密钥只放云环境变量，不进小程序包、数据库或文档。来源：`docs/deployment-checklist.md:35,36,43`。（2026-11-13 用户确认已配置。）
- [x] **#11 `[控制台]` 配置 ASR 变量** — `asrProxy` 配 `ASR_URL` / `ASR_KEY` / `ASR_MODEL`（`ASR_MODEL` 必配，代码默认 `whisper-1` 硅基流动不支持）；`ASR_URL` 为完整 HTTPS 转录地址。来源：`docs/deployment-checklist.md:37,51,58`。（2026-11-13 用户确认已配置。）
- [x] **#12 `[控制台]` 配置订阅模板变量** — `aiReport` 与 `aiTasks` 的 `AI_REPORT_TEMPLATE_ID` 必须同值（从公众平台「我的模板」复制，勿手抄）；`aiReport` 另配 `AI_REPORT_TITLE_FIELD=thing1`、`AI_REPORT_TIME_FIELD=time2`、`AI_REPORT_RESULT_FIELD=thing3`。变量名只能是 `AI_REPORT_TEMPLATE_ID`（误建 `REMINDER_TEMPLATE_ID` 会稳定返回 501）。来源：`docs/deployment-checklist.md:38,39,53,56,57`。（2026-11-13 用户确认模板变量已配置；三个字段映射的取值仍建议与「我的模板」详情页复核。）
- [x] **#13 `[控制台]` 确认订阅模板可用** — 「查看报告提醒」`IBU-7JzVwiyk0eD0pBoDLxZJg9l37V4gnsWMOKfNGE`，字段为 thing1/thing3/time2（以「我的模板」详情页为准，非固定 thing1/time13）；若无合适模板则从公共模板库选含 `thingN`+`timeN` 的一次性模板，新模板提审需 3-7 工作日。来源：`docs/deployment-checklist.md:89`（原 D14）、`:53`。（2026-11-13 用户确认模板已配置，模板 ID 于 2026-11-11 申请。）
- [x] **#14 `[控制台]` 服务器域名** — 云开发免配置；ASR 走云函数中转，无需小程序侧域名白名单，确认无需额外配置即可。来源：`docs/deployment-checklist.md:91`（原 D15）。（2026-11-13 代码侧核对：小程序端仅有 `wx.requestSubscribeMessage`，无外部 `wx.request` / `wx.uploadFile`；LLM 与 ASR 的 HTTPS 请求均在云函数内发起，无需配置域名白名单。）
- [ ] **#15 `[控制台]` 隐私协议 / 用户隐私保护指引** — 补充声明「录音用于语音识别」，并覆盖宝宝记录、照片等实际收集范围；明确成长日记正文、里程碑事项、辅食/自定义备注会在用户主动附带问答或已同意的定时报告中发送给第三方 AI 服务商（依赖 #01 的服务商与责任人信息）。来源：`docs/deployment-checklist.md:92`（原 D16）

## 阶段 3 · 云函数、触发器与权限

- [x] **#16 `[控制台]` 逐个部署 15 个云函数** — aiChat、aiNotifications、aiReport、aiSettings、aiTasks、asrProxy、babyProfile、customRecord、diaryRecord、feedingRecord、growthRecord、homeCards、login、milestoneRecord、statistics；每个都选「上传并部署：云端安装依赖」，含各自 `lib/` 与 `package.json`；`_shared` 不作为云函数部署。**本次新增 `_shared/record-details.js` 并修改 `aggregation.js`、`llm.js`、`ai-settings.js`，同步脚本已把 6 份共享文件复制到全部 14 个受管函数目录；须先运行 `node scripts/sync-cloud-runtime.js`，再重新部署全部 14 个含 `lib/` 的云函数，最低限度也要重新部署 `statistics`、`aiChat`、`aiReport`、`aiSettings` 这 4 个直接消费明细与默认提示词的函数——只部署 4 个会让云端其余函数仍运行旧 `lib/`，与仓库版本不一致。本轮再次修改 `_shared/ai-settings.js`（加粗与分节规则、追加第二历史默认值），同步后 14 份 `lib/ai-settings.js` 均已更新；`aiSettings` 的 `build` 标记已升为 `ai-settings-4`，部署后可用 `get` 返回的 `build` 核对云端版本。** 来源：`docs/deployment-checklist.md:13,20,21`。**【登录硬前置】** 其中 `login` 未部署时 `app.js` 静默保持未登录态、全员无法进入（PRD §7.3）。
- [ ] **#17 `[控制台]` 设置云函数超时** — `aiChat` ≥60 秒且内存 ≥256MB（含图片下载/编码、深度思考 45 秒应用层超时余量）；`aiReport` ≥60 秒。该值在控制台按函数设置，`config.json` 不承载。来源：`docs/deployment-checklist.md:22`（原 D5）、`:46`
- [x] **#18 `[控制台]` 上传 aiReport/config.json 触发器** — 确认 `aiReportTimer` 为 `0 */5 * * * * *`（每 5 分钟一次）。来源：`docs/deployment-checklist.md:24`（原 D7）
- [ ] **#19 `[控制台]` 校验 aiReport 可信调度** — 仅接受无客户端 OPENID 且 `TriggerName=aiReportTimer` 的调用（`event.Type` 不作为唯一判据）；验证前端无法指定 openid 触发报告生成。来源：`docs/deployment-checklist.md:25`（原 D8）
- [ ] **#20 `[控制台]` 给 aiReport 开 openapi 权限** — 权限须含 `subscribeMessage.send`，否则推送恒定失败。来源：`docs/deployment-checklist.md:30`（原 D13）
- [ ] **#21 `[真机]` 验证 aiTasks 的范围校验** — 保存/更新校验 7 类 `categories`（非法返回 400 `INVALID_CATEGORIES`）与 `range`（非法返回 400 `INVALID_RANGE`），`monthly` 归一为 `auto`；旧任务无 `range` 按 `auto` 处理，无需迁移。来源：`docs/deployment-checklist.md:26`（原 D9）
- [ ] **#22 `[真机]` 验证 aiNotifications 三个动作** — 提供 `list` / `read` / `remove`；`remove` 是历史报告左滑删除唯一入口，未部署会返回 `UNKNOWN_ACTION`；不提供 `unreadCount`，旧版本若含该 action 一并覆盖。来源：`docs/deployment-checklist.md:27`（原 D10）
- [ ] **#23 `[真机]` 验证历史报告筛选与索引** — `list` 接收 `startDate`/`endDate`（北京时间、含起止日）与 `offset`，每页 20 份、返回 `total`/`hasMore`；核对 `ai_notifications` 复合索引 `openid` 升序 + `created_at` 降序 + `_id` 降序；验证默认本月、跨月自定义起止、加载更多。**不能只更新前端而沿用旧版无筛选接口。** 来源：`docs/deployment-checklist.md:28`（原 D11）、`:67,79`
- [ ] **#24 `[真机]` 验证 homeCards 删除边界** — 覆盖喂养细类、辅食、便便、成长、日记、自定义、里程碑删除；确认只删所选日期、所选宝宝、所选类别，且不影响其他家庭/宝宝数据。来源：`docs/deployment-checklist.md:23`（原 D6）
- [ ] **#25 `[控制台]` 确认定时器容量口径** — 每轮最多 10 任务、并发 2；轮询与积压会造成延迟，产品不承诺分钟级准时送达。来源：`docs/deployment-checklist.md:29`（原 D12）

## 阶段 4 · 开发者工具编译与端到端连通

- [ ] **#26 `[真机]` 微信 IDE 完整编译运行** — 原生控件/组件隔离、真实软键盘、安全区、读屏、冷启动主题无闪烁；`--tab-page-top` 收紧后，刘海屏与非刘海屏均需确认三 Tab 页标题不压状态栏与右上角胶囊、切换 Tab 无高低跳变（2026-11-13 真机反馈 64rpx 下标题与胶囊齐平、偏贴顶，已回调至 80rpx，仍需复验）。来源：`docs/deployment-checklist.md:7`（原 D1）
- [ ] **#27 `[真机]` 真实云端链路连通** — 云数据库索引/事务、定时触发、模型服务、订阅推送均已部署并连接测试，**不以本地 mock 代替**。来源：`docs/deployment-checklist.md:8`（原 D2）
- [ ] **#28 `[真机]` 真机验证语音输入** — 个人主体用 `RecorderManager → asrProxy` 一次性转写；长按输入框说话、松手后文字进入输入框，短按仍可正常打字与定位光标；输入框为空与已有文字两种状态都要覆盖，确认系统长按菜单不影响录音与松手停止（主体变更为非个人后才可加回 WechatSI 实时预览）。来源：`docs/deployment-checklist.md:51,90`

## 阶段 5 · 真机功能验收（PRD §8，8 项）

- [ ] **#29 `[真机]` 导航与入口** — 仅首页/小迈/我的三导航；小迈主页面范围卡片、详情页图表与问答入口可用。来源：`docs/prd/slownote-prd.md` §8 第 1 项
- [ ] **#30 `[真机]` 日期与日历** — 周日跨月、闰月、月龄、今标记、记录点与选中日期正确；FAB 不遮内容/导航。来源：`docs/prd/slownote-prd.md` §8 第 2 项
- [ ] **#31 `[真机]` 六类登记** — 进入正确表单，选中日期保存后可在首页查到；存量记录仍可读取。来源：`docs/prd/slownote-prd.md` §8 第 3 项
- [ ] **#32 `[真机]` 长按整理与删除** — 首页当日卡片长按进入整理态、删除确认、删除后首页/统计刷新；iOS 与 Android 均能区分短按与长按。来源：`docs/prd/slownote-prd.md` §8 第 4 项
- [ ] **#33 `[真机]` 边界状态** — 时间范围、家庭隔离、空/加载/失败/重试均正确。来源：`docs/prd/slownote-prd.md` §8 第 5 项
- [ ] **#34 `[真机]` 6 套渐变主题** — 治愈蓝/樱粉/暖橙/薄荷绿/紫色/深色齐备；切换只改变配色与渐变、不改变布局几何；Canvas 配色随主题切换。来源：`docs/prd/slownote-prd.md` §8 第 6 项
- [ ] **#35 `[真机]` AI 异常路径** — AI 未配置、超时、限流、同意/撤回同意、任务启停/删除、重复触发、模板缺失均可复现且表现符合预期。来源：`docs/prd/slownote-prd.md` §8 第 7 项
- [ ] **#36 `[真机]` 可访问性与设备适配** — 44px 热区、安全区、软键盘、屏幕阅读器在开发者工具与真机均验收通过。来源：`docs/prd/slownote-prd.md` §8 第 8 项

## 阶段 6 · 上线后观察

- [ ] **#37 `[控制台]` 到期数据运维口径** — `ai_runs` 至少保留 30 天（定时报告防重复凭据）；`ai_rate_limits.expires_at` 过期行与久远 `mutation_receipts` 定期清理；`ai_notifications` 由用户在历史报告页自行删除。来源：`docs/deployment-checklist.md:85`
- [ ] **#38 `[本地]` 回填原始清单** — 全部勾完后，把 24 项同步勾选到 `docs/prd/slownote-prd.md` §8 与 `docs/deployment-checklist.md` 对应项，并记录本次上线的提交号与日期。来源：本文约定

---

## 覆盖对照（24 项原勾选项 → 本文编号）

| 来源 | 原位置 | 本文 |
|---|---|---|
| deployment-checklist.md | 7 / 8 / 9 / 10 | #26 / #27 / #05 / #04 |
| deployment-checklist.md | 22 / 23 / 24 / 25 / 26 | #17 / #24 / #18 / #19 / #21 |
| deployment-checklist.md | 27 / 28 / 29 / 30 | #22 / #23 / #25 / #20 |
| deployment-checklist.md | 89 / 91 / 92 | #13 / #14 / #15 |
| prd/slownote-prd.md §8 | 第 1-8 项 | #29-#36 |

**执行状态**：截至 2026-11-13，已勾选 9 项 —— #02、#03（本地基线）、#10、#11、#12、#13、#14、#16、#18；其余 29 项未勾选。#02/#03 由本地命令验证，#14 由代码侧只读核对，#10–#13、#16、#18 由用户口述确认；**云端控制台取值、部署覆盖范围与真机验收均未经本仓库验证**，勾选仅表示「用户确认已执行」，不代替验收结论。

### 2026-11-13 云端进度确认（依据与边界）

用户确认已完成：部署云函数、上传触发器、配置环境变量与订阅模板。映射到本清单为 #10、#11、#12、#13、#16、#18；#14 经代码侧核对无需额外配置，一并勾选。

仍需复核的边界：
- #16 是否覆盖**全部 15 个**含最新 `lib/` 的函数；`aiSettings/get` 的 `build=ai-settings-4` 已由真机截图间接验证，但只能证明该函数是新版。
- #12 的三个字段映射变量取值是否与「我的模板」字段编号一致；#20 `subscribeMessage.send` openapi 权限是否随 `config.json` 生效。
- #17 云函数超时/内存、#19 可信调度校验、#21–#25 接口行为，均不在本次确认范围内。

**尚未执行的硬阻塞**：#01 合规信息（两处 `[待补充：上线前确认]`）、#15 用户隐私保护指引、#06/#07/#08 集合与客户端权限及索引（数据隔离开关）、#09 云端旧函数清理、#26–#36 真机验收。完成前不建议提交审核。

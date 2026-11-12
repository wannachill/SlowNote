# 一迈一记 · 部署检查清单

> 更新日期：2026-11-11
> 本文档由项目文档体系生成并维护，请在每次上线前逐项核对。

## 1. 上线前检查
- [ ] 微信 IDE 完整编译运行、原生控件/组件隔离、真实软键盘、安全区、读屏、冷启动主题无闪烁。
- [ ] 真实云数据库索引/事务、定时触发、模型服务与订阅推送已部署并连接测试，不以本地 mock 代替。
- [ ] 使用现有正确云环境；客户端/测试不写入生产数据。
- [ ] AppID `wx27a55616539c8020`、云环境 `cloud1-d6gil7n3u02d7414e`（`miniprogram/app.js` 的 wx.cloud.init）。

## 2. 云函数
截至 2026-11-11，`cloudfunctions/` 有 **15 个可调用云函数 + `_shared`**（`_shared` 不作为云函数部署）：aiChat、aiNotifications、aiReport、aiSettings、aiTasks、asrProxy、babyProfile、customRecord、diaryRecord、feedingRecord、growthRecord、homeCards、login、milestoneRecord、statistics。
共享库同步脚本当前将 runtime/aggregation/record-details/llm/schedule/ai-settings 共 6 个文件复制到 14 个函数目录：statistics、babyProfile、customRecord、aiChat、aiTasks、aiNotifications、aiReport、aiSettings、asrProxy、feedingRecord、growthRecord、diaryRecord、homeCards、milestoneRecord。运行 `node scripts/sync-cloud-runtime.js` 后按输出确认。
**已下线（2026-11-11，仓库内已移除，需在云开发控制台人工删除）**：`reminderRecord`。智能提醒与手机闹铃/日程重复，且一次性订阅无法保证送达，整条链路（页面、云函数、定时器、`reminder_items` 写入）已删除；存量 `reminder_items` 数据保留但不再读写。
**已下线（2026-10-29，仓库内已移除，需在云开发控制台核对并人工删除旧函数）**：`family`、`migrateFamilyData`、`monthlyReport`、`expenseRecord`。控制台处理前按需归档 `expense_records` 与迁移函数产生的历史记录；保留数据库中的历史 `family_id` 字段，不删除集合或历史数据。
**已下线（2026-10-30，安全下线，需在云开发控制台人工删除）**：`sendReminder`。
药品/护理日常记录功能已从仓库移除；云开发控制台需确认旧函数和专属集合已清理。里程碑记录（`milestoneRecord` / `milestone_records`）仍保留。
函数下线不自动删除历史数据；`expense_records`、已有 `family_id` 与自定义记录 `outdoor` 历史行按现状保留。
其余原函数按原流程保留。每个函数单独“上传并部署：云端安装依赖”，包括各自 `lib/` 和 `package.json`。`_shared` 不作为云函数部署；改共享源码后先执行 `node scripts/sync-cloud-runtime.js` 再分别部署。
- 部署 `aiSettings` 时需确认云数据库已创建 `ai_settings` 集合；函数读取/写入深度思考入口显示状态与 style/vision/report 提示词，不读取 LLM 环境变量。集合客户端访问应默认拒绝，由云函数按 openid 派生文档 ID 访问。
- [ ] aiChat 超时至少 60 秒（内存至少 256MB，含图片下载/编码、深度思考开启时模型 45 秒应用层超时与清理余量）。
- [ ] 部署 `homeCards` 后，使用已登录账号覆盖喂养细类、辅食、便便、成长、日记、自定义、里程碑删除；确认只删除所选日期、所选宝宝（若未选择宝宝则当前个人/家庭范围内全部宝宝）与类别的数据，并验证其他家庭/宝宝数据不会被删除。
- [ ] 部署 aiReport/config.json，确认 aiReportTimer 为每五分钟一次：`0 */5 * * * * *`。
- [ ] aiReport 仅接受无客户端 OPENID 且 TriggerName=aiReportTimer 的可信调度（`event.Type` 不作为唯一判据，平台并不稳定下发 `Timer`）；前端不能指定 openid 执行报告生成。
- [ ] 部署 `aiTasks` 时确认保存/更新已校验 7 类 `categories` 与 `range`：非法类别返回 400 `INVALID_CATEGORIES`、非法范围返回 400 `INVALID_RANGE`，`monthly` 一律归一为 `auto`；旧任务无 `range` 字段时按 `auto` 处理，无需数据迁移。
- [ ] 部署 `aiNotifications` 时确认提供 `list` / `read` / `remove`：`remove` 为历史报告左滑删除的唯一入口，未部署会返回 `UNKNOWN_ACTION`；该函数不提供 `unreadCount`，若旧版本仍含该 action 一并覆盖。
- [ ] 历史报告筛选需部署新版 `aiNotifications`：list 接收 startDate/endDate（北京时间、含起止日）与 offset，返回 total/hasMore，每页 20 份；核对 ai_notifications 复合索引 openid 升序、created_at 降序、_id 降序。验证默认本月、跨月自定义起止日期及加载更多，不能只更新前端后使用旧版无筛选接口。
- [ ] 该版本每轮最多十任务、并发二；轮询与积压会造成延迟，不承诺分钟级准时送达。
- [ ] aiReport 的 openapi 权限含 `subscribeMessage.send`。

## 3. 环境变量与外部服务
| 函数 | 必要配置 | 缺失行为 |
|---|---|---|
| aiChat、aiReport | LLM_API_URL / LLM_API_KEY / LLM_MODEL（仅云函数环境变量） | 返回友好未配置说明，不调用模型 |
| aiChat 图片分析 | LLM_VISION_MODEL（明确支持图像的模型；URL/KEY 与文本共用） | 图片草稿保留，提示图片分析尚未配置，不下载照片或调用模型 |
| asrProxy（个人主体唯一语音通道） | ASR_URL / ASR_KEY / ASR_MODEL（推荐硅基流动 SenseVoiceSmall） | 录音松开后执行一次性转写；未配置时提示“语音转写服务未配置” |
| aiReport、aiTasks | AI_REPORT_TEMPLATE_ID（两函数配置相同值） | 定时报告保存在站内；发送封装返回501；明确提示未配置 |
| aiReport | AI_REPORT_TITLE_FIELD（默认thing1）、AI_REPORT_TIME_FIELD（默认time2）、AI_REPORT_RESULT_FIELD（默认空，配 thing3 则下发任务「报告标题」） | 模板字段必须与实际模板匹配，不匹配会回退站内并在云日志报错 |

`aiTasks` 的 `AI_REPORT_TEMPLATE_ID` 仅用于前端订阅授权入口与 `action:'list'` 返回 `templateId`；为空时提示「微信通知尚未配置，报告仍会保存在站内通知」，站内通知仍可用，「我的 → 历史报告」入口不受影响。`aiTasks` 与 `aiReport` 的环境变量各自独立，改后需分别重新部署；只有 `aiReport` 真正发送订阅消息，`AI_REPORT_TITLE_FIELD` / `AI_REPORT_TIME_FIELD` 也只在 `aiReport` 生效。`aiReport` 未配置模板时报告仍写入 `ai_notifications`，发送封装返回 501。

LLM 配置仅从云函数环境变量读取：`LLM_API_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_VISION_MODEL`。配置缺失时返回未配置说明；密钥不得写入小程序包、数据库或文档。
LLM_API_URL 支持 HTTPS 的完整 /chat/completions 地址或基础路径（如 /v1），后者自动追加 /chat/completions。禁止明文 HTTP、URL 用户名密码及带查询参数的凭据。提供商需兼容 model/messages/max_tokens 接口。
请求总超时在关闭思考时为18秒，开启思考时为45秒，响应最多128KiB，不向用户透传上游异常；不自动重试计费模型调用。密钥只放云环境变量，不填小程序/文档/测试。
云函数超时必须留出模型请求余量：`aiChat` 至少 60 秒，`aiReport` 至少 60 秒。`aiChat` 的 45 秒应用层思考超时还要覆盖图片下载/编码与清理开销；超时在云开发控制台按函数设置，`config.json` 不承载该值。
接入 DeepSeek 时，`LLM_API_URL` 填 `https://api.deepseek.com`（或 `https://api.deepseek.com/v1`），`LLM_MODEL` 与 `LLM_VISION_MODEL` 均填 `deepseek-flash`。`deepseek-chat` 已于 2026-07-24 退役，使用它会返回 400。
DeepSeek 思考模式由小迈页面的「深度思考」开关控制，默认关闭，用户可手动切换，带图片提问时自动开启且不改写用户保存的偏好；开启时应用层最多等待45秒，`aiChat` 云函数需配置至少60秒超时。后端优先使用请求中的布尔值，其次读取 `LLM_THINKING=disabled` 或 `enabled`；两者都未设置且模型名以 `deepseek` 开头时默认关闭。非 DeepSeek 或其它取值不会发送该字段，以兼容其它 OpenAI 兼容网关。
深度思考入口是否显示由 `ai_settings.showThinking` 持久化配置；用户在聊天页选择的逐次思考偏好保存在端侧 `ai.thinking`，请求携带布尔值。后端以该请求值为先，其次读取 `LLM_THINKING=disabled` 或 `enabled`；未设置且模型名以 `deepseek` 开头时默认关闭。图片提问可按聊天页逻辑启用思考。开启思考时应用层最多等待 45 秒，`aiChat` 云函数需配置至少 60 秒超时。
图片分析要求同一 HTTPS 端点兼容 Chat Completions 的 `content: [{type: 'text', text}, {type: 'image_url', image_url: {url: 'data:image/jpeg;base64,...'}}]`；模型支持 JPG/PNG/WebP。单次至多3张、每张压缩后至多2MiB，总图片至多6MiB，Base64请求约8MiB，必须核实供应商请求上限。模型是单独的 `LLM_VISION_MODEL`，不会把图片盲发给 `LLM_MODEL`。照片只附到最新一轮提问，历史消息仅文本；需要回看图片时用户重新附图。文本会脱敏，但图像内个人信息无法自动脱敏。
个人主体不可用微信同声传译 WechatSI，当前不在 `app.json` 声明该插件。语音输入使用 `RecorderManager`（mp3、16kHz 单声道）录音，松开后将音频上传到 `audio/{openid}/{ts}.mp3` 并调用 `asrProxy` 一次性转写；该云函数转发至 OpenAI 兼容 `/audio/transcriptions` 端点（multipart：file + model），要求 ASR_URL 完整 HTTPS 地址、ASR_KEY Bearer 密钥；30 秒超时，音频 1KiB-15MiB。前端会在请求结束后删除云端临时音频。ASR 配置是个人主体语音输入的唯一通道，未配置时提示“语音转写服务未配置”。主体变更为非个人后可加回 WechatSI 声明恢复实时预览。
订阅消息默认发送「报告类型=小迈定时报告」「生成时间=北京时间」「报告结果=任务「报告标题」（≤20 字，未配置则不展示）」三项——**文案与字段值由 `aiReport/index.js` 的 `sendNotice()` 写死/取自任务配置，不是模板名**。公众平台模板库按小程序类目展示现成模板，不支持自定义模板名，搜该文案不会有结果。代码只要求模板含 `thingN`（报告类型/结果）+ `timeN`（时间）字段，因此可直接复用下方已申请模板，或从公共模板库选用任意「事项 + 时间」类一次性模板。模板需正式小程序实际申请，用户授权次数可能耗尽；失败不影响站内通知。「报告结果」不再截取报告正文（会被中途截断且难看），改为取任务配置的「报告标题」（在「报告任务」页填写、上限 20 字，与微信 thing 字段上限一致）；不填则该字段整行不展示。**微信推送为「单任务开关」**：用户须在「报告任务」卡片上单独开启「微信通知」并授权一次性订阅后，该任务才会尝试推送；`aiReport` 仅当 `ai_tasks.notify=true` 才调用 `subscribeMessage.send`，否则报告只落站内（`delivery.message=WECHAT_NOTIFY_DISABLED`），不消耗订阅额度。新任务 `notify` 默认 false，因此旧任务与新建任务都需用户逐一开启。
报告订阅模板已申请（2026-11-11 由「打卡提醒」更换为「查看报告提醒」）：`AI_REPORT_TEMPLATE_ID=IBU-7JzVwiyk0eD0pBoDLxZJg9l37V4gnsWMOKfNGE`，字段映射「报告类型=thing1、生成时间=time2、报告结果=thing3」，代码默认 `AI_REPORT_TITLE_FIELD=thing1`、`AI_REPORT_TIME_FIELD=time2`，可选 `AI_REPORT_RESULT_FIELD=thing3`（承载任务「报告标题」，≤20 字，未配置则不展示）。须在 `aiReport` 与 `aiTasks` 配同一模板 ID；`AI_REPORT_TEMPLATE_ID` 整组留空亦可（报告结果存站内，仅不推微信）。**字段编号以公众平台「我的模板」详情页为准——本模板为 thing1/thing3/time2，并非固定 thing1/time13，填错会回退站内并报错**。模板 ID 务必从公众平台「我的模板」点复制粘贴，勿手抄（含大小写与连字符）。模板选用/申请以公众平台「我的模板」与公共模板库为准。

**配置常见两类填错（2026-11-11 实测）：**
1. **变量名写错**：在 `aiReport` 误建名为 `REMINDER_TEMPLATE_ID` 的变量——代码 `aiReport/index.js` 第 10 行只认 `AI_REPORT_TEMPLATE_ID`，`REMINDER_TEMPLATE_ID` 完全不被读取，配了也照样稳定返回 `501 TEMPLATE_NOT_CONFIGURED`。两函数只认 `AI_REPORT_TEMPLATE_ID` 这一个名字。
2. **模板 ID 抄错**：控制台截图中 ID 被「···」截断，且 ID 同时含字母 `O` 与数字 `0`（第 9 位是数字 `0`），手抄极易漏末段或抄反。务必从公众平台「我的模板」点**复制**，原样粘贴到 `aiReport` 与 `aiTasks` 的 `AI_REPORT_TEMPLATE_ID`，不要手抄截图。
语音转写服务商推荐硅基流动 SiliconFlow（国内直连 + SenseVoice 免费额度）：`ASR_URL=https://api.siliconflow.cn/v1/audio/transcriptions`、`ASR_KEY=<硅基流动 API Key>`、`ASR_MODEL=FunAudioLLM/SenseVoiceSmall`。个人主体下这些变量供录音松开后的一次性转写使用；当前不提供实时预览。主体变更为非个人后可加回 WechatSI 声明恢复实时预览。`ASR_MODEL` 必配——代码默认值 `whisper-1` 硅基流动没有，留空会请求失败。DeepSeek 无语音转写接口，DeepSeek Key 不能充当 ASR_KEY。

## 4. 集合、安全与索引
当前云环境应有 **16 个集合**：`users`、`babies`、`family_members`、`feeding_records`、`custom_records`、`diary_records`、`growth_records`、`milestone_defs`、`milestone_records`、`ai_settings`、`ai_tasks`、`ai_notifications`、`ai_runs`、`ai_sessions`、`ai_rate_limits`、`mutation_receipts`。历史集合 `families`、`expense_records` 与已下线的 `reminder_items` 按现状保留，不新增、不读写。

**客户端权限**（云开发控制台「数据库 → 权限设置」）：除 `ai_sessions` 之外全部设为「所有用户不可读写」，只允许云函数用服务端 SDK 访问。`ai_sessions` 是唯一例外——对话历史由小程序端直接写入，规则需放行「仅本人读写本人记录」（`doc.openid == auth.openid`），其余拒绝。

- ai_sessions（小迈对话历史）：安全规则建议仅本人可读写自己的会话（openid 匹配），客户端写入 upsert 依赖云环境登录态；建议索引 `openid + updatedAt`（列表倒序）、`openid + sessionId`（单会话查询）。客户端保存失败静默降级，不阻断对话。
- ai_settings（小迈配置）：部署前确认集合已创建；小程序端不得直连读写，数据库客户端规则默认拒绝，只有云函数访问。文档 ID 为 `hash(openid)`，云函数基于可信登录 openid 读取并写入该用户配置。
- ai_notifications（历史报告）：只经 `aiNotifications` 访问，提供 `list`（按 `created_at`/`_id` 倒序；接收 `startDate`/`endDate`（北京时间、含起止日）与 `offset`，每页 **20 条**，返回 `total`/`hasMore`）、`read`、`remove`；`remove` 按 openid 校验归属（非本人 404 `NOTIFICATION_NOT_FOUND`）并以 `mutation_receipts` 幂等。**不提供 `unreadCount`**，底栏也不做未读数字角标。

**索引**（按各云函数实际 `where`/`orderBy` 建立；控制台提示缺索引时以提示为准）：

| 集合 | 索引 |
|---|---|
| users | `openid`（唯一；先核对历史重复） |
| babies | `openid + updated_at`、`family_id + updated_at` |
| family_members | `openid`（唯一）、`familyId + joined_at` |
| feeding_records / diary_records / growth_records / custom_records / milestone_records | `openid + record_date + _id`、`family_id + record_date + _id`、`openid + baby_id + record_date`（旧记录另有 `created_at + _id`） |
| milestone_defs | `openid + baby_id`、`family_id + baby_id`（含 `key` / `month` 等值过滤） |
| ai_tasks | `enabled + next_run_at + lease_until`（调度扫描）、`openid + created_at` |
| ai_notifications | `openid + created_at`、`delivery_status` |
| ai_runs | 主键；`created_at` |
| ai_rate_limits | `expires_at`（到期清理） |
| mutation_receipts | 主键；`openid + operation + created_at` |
| ai_settings | 主键 `hash(openid)`，无需额外索引 |

到期数据靠运维清理而非删集合：`ai_rate_limits` 的 `expires_at` 过期行、`mutation_receipts` 的久远回执可定期清；`ai_runs` 建议保留至少 30 天（定时报告防重复生成的凭据），`ai_notifications` 由用户在历史报告页自行删除。


## 5. 小程序平台配置
- [ ] 订阅消息模板：确认「查看报告提醒」模板可用（ID 见上方 §3）；定时报告通知配 `AI_REPORT_TEMPLATE_ID` + `AI_REPORT_TITLE_FIELD=thing1`/`AI_REPORT_TIME_FIELD=time2`/`AI_REPORT_RESULT_FIELD=thing3`（报告结果对应任务「报告标题」，未配置则不展示该字段），或从公共模板库搜索「提醒/通知/报告/结果/完成」等词，选用含 `thingN`+`timeN` 字段的一次性模板；确需新模板则在公共模板库最后一页点「找不到你想要的模板？帮我们完善模板库」提审，审核 3-7 工作日。字段编号以公众平台「我的模板」详情页为准（非固定 thing1/time13）。
- 个人主体不可用 WechatSI，当前语音为 `RecorderManager → asrProxy` 一次性转写；主体变更为非个人后可加回插件声明恢复实时预览。真机需验证按住说话、松开后文字进入输入框。
- [ ] 服务器域名：云开发免配置；若 ASR 服务走 HTTPS 可直连云函数中转，无需小程序侧域名白名单。
- [ ] 隐私协议/用户隐私保护指引：补充声明「录音用于语音识别」，并覆盖宝宝记录、照片等实际收集范围；明确成长日记正文、里程碑事项、辅食/自定义备注会在用户主动附带问答或已同意的定时报告中发送给第三方 AI 服务商。


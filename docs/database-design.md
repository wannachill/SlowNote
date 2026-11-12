# 一迈一记数据库与接口事实
> 版本 1.6｜2026-11-11｜微信云数据库；业务 ID 使用实际 _id。openid 仅由可信云上下文获取。

## 1. 归属与权限
前端不直连业务集合写入；ai_sessions 是对话历史例外，由小程序端按 openid 规则保存。服务端 SDK 必须校验登录身份及家庭/宝宝/对象数据范围。家庭管理入口与管理函数已下线，但已有 `family_members` 与 `family_id` 仍参与历史数据 scope；有当前家庭成员关系时按 family_id 查询，否则按 openid 查询。不接收客户端指定身份/家庭作为查询范围。宝宝档案支持多记录，按当前 scope 列表并以 baby_id 选择；不使用单一家庭档案替代多宝宝数据。
expense（花销）已于 2026-10-29 下线，历史 `expense_records` 保留，不再提供新增入口或统计维度。登录用户可使用全部功能。LLM 模型地址、密钥及模型名仅通过云函数环境变量读取。

## 2. 既有集合与扩展
| 集合 | 关键字段/实际行为 |
|---|---|
| users | openid、nickname、created_at、last_login_at；新增 theme_pref={color: blue/pink/orange/mint/purple/dark}（6 套渐变主题，color-only，无独立明暗模式；深色作为独立主题色存在）、theme_request_id、updated_at |
| families / family_members | 历史家庭归属数据；家庭管理产品入口与函数已下线。family_members.openid/familyId 仍供服务端 scope 兼容读取，family_id 记录不在本次数据文档更新中迁移或清理 |
| feeding_records | openid、family_id、baby_id、type、payload、client_request_id、created_at；新增 record_date=YYYY-MM-DD |
| growth_records | openid、family_id、baby_id、height/weight/head(可空)、record_date、client_request_id、created_at |
| diary_records | openid、family_id、baby_id、content、images(fileID[])、client_request_id、created_at；新增 record_date |
| milestone_records | openid、family_id、baby_id、milestone_key、domain、record_date、client_request_id、created_at |

`reminder_items` 随智能提醒功能于 2026-11-11 下线，不再写入；存量数据保留但不参与统计与 AI 摘要。

feeding.type 继续为 feed/solid/excretion；细类使用 payload.mode=breast/bottle/formula/mixed，不破坏历史统计口径。mixed 仅为历史数据兼容保留（前端标签与聚合仍识别），前端自 2026-10-29 起不再产生。
feed payload：亲喂 durationMin，其他 amountMl；solid 当前写入 name/note（历史 amountG 字段不清理）；excretion：kind(stool/urine，缺省 stool) + count/shape(大便)，小便当前按 count 写入（历史 urineMl 字段不清理）。
新记录日期为用户选中的今天/过去日期，created_at 始终是实际写入时间。旧 feeding/diary 无 record_date 时，以 created_at 北京时间归日，无需批量迁移。

## 3. 新增集合
| 集合 | 字段、约束与来源 |
|---|---|
| babies | 多档案：每宝宝一条，_id=hash(openid:baby_id 派生)，baby_id=_id；字段 nickname(必填≤24)、birthday(可空合法日期≤今天)、gender(unknown/male/female)、avatar(''/boy/girl/cloud fileID；空=按性别用内置默认头像)、openid、family_id、client_request_id、updated_at；get 返回列表，save 按 babyId 更新/无则新建，delete 校验归属删除 |
| custom_records | _id=hash(openid:请求ID)；openid、family_id、category(custom)、label(≤24)、value(可空数字)、unit(服务端≤8；前端输入≤6)、note(≤300)、record_date、client_request_id、created_at。历史户外类记录保留只读，前端已无该类目 |
| expense_records | 历史集合，功能已下线，不再新增或参与当前统计/AI 摘要；存量数据保留 |
| ai_sessions | 小迈对话历史（**由小程序端直接写入**，非云函数）：openid、sessionId、title(≤14)、messages[]、babyId、updatedAt、createdAt；openid 隔离，upsert 幂等，保存失败静默降级不阻断对话；图片仅存 fileID。安全规则建议仅本人可读写；索引 `openid + updatedAt`、`openid + sessionId` |
| ai_tasks | _id=hash(openid:请求ID)；openid、baby_id(可选，空=聚合全部)、categories[]（feeding/excretion/solid/growth/diary/milestone/custom）、range(auto/today/3d/7d/30d；auto=跟随频率，monthly 恒为 auto=上月整月，旧任务缺字段按 auto 处理)、report_title(可选，≤20字，微信推送「报告结果」一行，未配置则该字段不展示)、frequency(daily/weekly/monthly)、time(HH:mm 北京时间)、weekday(0..6；monthly 忽略调度含义)、consent、enabled(任务是否运行/暂停)、**notify(可选，默认 false；单任务微信通知开关，true 才尝试订阅消息推送，否则仅站内通知)**、next_run_at、lease_until、lease_token、client_request_id、created_at、last_run_at/last_status/updated_at |
| ai_settings | `_id=hash(openid)`；持久化 `openid`、`showThinking`、`prompts={style,vision,report}`、`updated_at`。固定 SAFETY/视觉安全/历史图片规则由服务端生成并随读取结果返回，不存入该集合；安全规则建议仅云函数访问，按确定性文档 ID 隔离用户 |
| milestone_defs | 每宝宝个性化里程碑清单：openid、family_id、baby_id、key(内置=builtin_key 如 lift_head/自定义=生成 id)、source(builtin/custom)、name、domain(大运动/精细动作/语言/社交/其他)、month(1~36 整数月龄)、sort_order(同月龄内排序)、deleted(软删除，内置=隐藏/自定义=删除)、created_at/updated_at；`list` 时该宝宝清单为空则幂等初始化内置 **68 项**（覆盖 1~36 月龄，每个龄至少 1 条最关键的发育里程碑，含大运动/精细动作/语言/社交/其他五维度）；仅补缺失 key，不覆盖用户自定义项与已打卡记录；打卡记录 milestone_records 按 milestone_key 关联，内置 key 保持不变以兼容存量打卡 |
| ai_notifications | _id=hash(taskID:计划时刻)；openid、task_id、title、content(含免责声明)、configured/unavailable、read、delivery_status、delivery={code,status,message?}、created_at；小程序「历史报告」可查看、标记已读与删除（服务端按 openid 校验归属，删除走 mutation_receipts 幂等） |
| ai_runs | 与通知相同 _id；openid、task_id、slot、answer(仅分析文本与可用状态)、revoked、completed、created_at/completed_at，用于恢复而非对话持久化 |
| ai_rate_limits | 确定性 _id=hash(openid:分钟:槽0..3)，openid、expires_at、created_at；原子占槽实现每用户每分钟四次 |
| mutation_receipts | _id=hash(openid:操作:请求ID)；openid、operation、client_request_id、result、created_at；宝宝/主题、报告任务更新/删除、通知已读/删除事务回执 |

AI 任务 categories 为 `feeding/excretion/solid/growth/diary/milestone/custom` 七项，与常见问题同一套语义（feeding/excretion/solid 同源于 `feeding_records`，但分别选择、分别进入提示词）。`range` 与 `frequency` 解耦：`range` 决定单份报告看多久，缺省 `auto` 跟随频率；`monthly` 任务由服务端归一为 `auto`（上月整月），即便客户端传了显式范围也不生效。非法 `range` 返回 `400 INVALID_RANGE`，非法类别返回 `400 INVALID_CATEGORIES`。本人最多十任务，界面列表最多50条。frequency 支持 daily/weekly/monthly。monthly 由每月 1 日调度，聚合上一个完整自然月，窗口左闭右开。通知仅本人，最多返回最近50条；不向家庭成员共享个人任务或通知。**微信推送为「单任务开关」**：`notify` 默认 false，用户在任务卡片上单独开启并授权后才尝试订阅消息；未开启则报告只落站内，不消耗一次性订阅额度；`enabled` 仅控制任务是否运行（如撤回数据同意会被置 false 并暂停）。
小迈配置中的常见问题由端侧存储维护，不属于 `ai_settings` 集合；每条问题除文案、范围、固定状态外还持久化 `categories`（7 类数据类型多选，空数组表示不附带记录），内置问题按语义预设，旧数据缺该字段时回退全量兼容；`showThinking` 控制聊天页是否显示深度思考入口，实际逐次请求的 thinking 布尔值由聊天页开关传递。提示词自定义字段只存 style/vision/report；SAFETY 内容不可编辑，由服务端按场景组合。`compose()` 是默认与兜底提示词的唯一来源；每次调整默认文案时把改动前整组三条追加进 `PREVIOUS_DEFAULTS`，`normalizePrompts()` / `customOf()` 据此把历史默认全文归一为当前默认，避免老用户停在旧提示词或被误标为自定义，无需迁移数据。
云函数不持久化对话分析；对话历史由小程序端写入 ai_sessions（openid 隔离、幂等 upsert、失败静默降级）。AI 请求在用户主动附带记录或已同意的定时任务范围内，可包含服务端渲染的所选类别明细；日记正文、里程碑事项名、辅食/自定义备注会按白名单与长度预算发送，并经 `redact()` 脱敏。不发送 openid、家庭/宝宝标识、记录 ID、原始时间戳、昵称、精确生日或云文件 ID。分析文本与已附带的记录明细均为私有敏感数据。
家庭管理与迁移入口/函数已下线；数据库中既有 `families`、`family_members` 与 `family_id` 数据继续保留用于兼容 scope，不代表家庭管理界面仍可用。旧药品/护理日常记录集合已退出当前数据模型。

## 4. 幂等与并发
- 客户端带 clientRequestId，服务端存 client_request_id；别名 client_request_id 亦可接收。新记录确定性主键 + 原子 add，数据库主键阻止并发重复。兼容已有 auto ID 的 client_request_id 去重。
- 可变配置在 runTransaction 中检查 mutation_receipts 并更新对象/回执；同一个请求即使隔着其他更新重放，也不会把新状态回滚为旧状态。
- AI 调度：按到期时间排序取十条；匹配原 next_run_at 与过期 lease_until 后原子认领，租约180秒，并发二。运行/通知 ID 基于原计划时刻，不因重复触发产生新通知。
- 通知先入库，再原子标记一次投递尝试；网络不确定时不自动重发订阅消息以避免重复消费。站内通知始终可查。崩溃发生在投递尝试与接口返回之间时只保证站内可见，不承诺真实推送恰好一次。
- 模型/模板未配置是明确状态，不伪造成功；存储故障保留任务并置 retry_pending 供后续轮询重试。

## 5. 查询与索引
上线前按实际云控制台提示建立并验证：
| 集合 | 索引/查询 |
|---|---|
| users | openid（应唯一；先核对历史重复） |
| family_members | openid（唯一）；familyId + joined_at |
| 记录集合 | openid/family_id + record_date + _id；旧记录 created_at + _id 的范围查询；原列表排序索引保持 |
| ai_tasks | enabled + next_run_at + lease_until；openid + created_at |
| ai_notifications | openid 升序 + created_at 降序 + _id 降序（历史报告日期筛选与稳定分页）；delivery_status |
| ai_rate_limits | expires_at 到期清理 |
| mutation_receipts | 主键；openid + operation + created_at |
| ai_runs | 主键；created_at |

聚合按 _id 游标每页100条，单集合最多10000条，超过返回413，不提供伪完整结果。日期口径固定 UTC+8，无夏令时。
新增集合权限默认拒绝客户端读写。到期清理按云环境能力配置 TTL 或运维清理；本轮不宣称已部署清理任务。mutation_receipts 的保留决定幂等窗口，不得随意清除。

## 5.1 首页卡片删除接口
`homeCards` 是新增的云函数入口，不新增集合。请求：`{action:'deleteDay', category, recordDate, baby_id, clientRequestId}`。

- category 包含喂养细类 `breast/bottle/formula/mixed`、登记类型 `solid/excretion/growth/diary/custom/milestone`，并兼容已下线户外/花销入口产生的历史删除类型；前端不再提供这两类登记入口。喂养细类来自 `feeding_records.payload.mode`，其余来自记录 type/category。
- 服务端先按当前可信 openid/family scope + baby_id + record_date + category 固定删除快照，再分批（每批最多 40 条）在事务中校验并删除。提供 baby_id 时只匹配该宝宝；baby_id 为空时删除当前个人/家庭 scope 下该日该类别的全部记录。不会删除确认后新产生的记录，也不会跨日期/跨个人或家庭 scope 删除。
- 每次快照和批次都使用 `mutation_receipts`；重复 clientRequestId 返回同一结果。服务端校验当前登录用户或家庭 scope、baby_id、record_date 与 category；历史 expense 仅保留读取/删除兼容，不再提供新登记入口。
- 删除属于不可恢复动作，前端必须先确认；服务端返回 `{code:0, deleted, matched}` 才允许移除卡片视觉并刷新统计。

## 6. 兼容、回滚与未决项
字段增量写入，未执行生产数据迁移/删除。部署兼容云函数后再发布小程序；旧客户端仍可发送旧基础类型和 clientRequestId。回滚前端时保留新增集合/字段，以免丢失用户记录。
敏感数据保留周期、账号/宝宝删除流程、备份恢复目标、AI 服务商数据政策及责任人：[待补充：上线前确认]。

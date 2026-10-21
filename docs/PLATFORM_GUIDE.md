# 平台接入指南

资料核对日期：2026-10-18。接口和套餐可能变化；预设可编辑查询地址，通用接入不需要修改程序。

## 先尝试网页快速添加

1. 总览点击「网页快速添加」，填写官方用量、订阅或余额页的完整 HTTPS 网址。
2. 在新窗口完成官方登录，可以使用顶部地址栏切换到真正显示额度的页面。
3. 页面加载后，点击顶部可信工具栏的「一键抓取」。程序在本机识别可见账号、套餐及 5 小时/周/月/日额度或余额。
4. 核对主窗口中的预览与官方页面是否一致，补充账号名及套餐名，然后保存。
5. 保存独立会话后可以关闭网页。刷新会在后台恢复信息页，重启后继续使用持久 Cookie/本地存储。平台要求登录时，点开原账号，使用「程序内打开并重新抓取」更新原记录。首页抓取可选择更新已有账号。

此流程对其他未预置平台同样可尝试，不限制为模板中的品牌。每次添加分配新账号和独立会话，同平台多账号互不覆盖。

识别依赖可见文本与明确的已用/剩余语义；0 是有效数据，没有明确周期时不冒充 5 小时/周/月。页面没有展示的密钥、密码和隐藏输入不抓取。图表、跨域 iframe、模糊标注和网站改版可能需要高级字段配置。自动抓取账号会在刷新时重新做语义识别；自定义 CSS 模式可关闭「自动识别页面额度」。找不到完整周期时保留旧快照，请在原账号重新抓取或编辑映射。

某些平台不允许内嵌浏览器登录。工具不绕过该限制，可以使用官方授权 API、手动会话或手动记录。右侧默认浏览器直达按钮用于查看和手动重置；系统浏览器的会话不会自动导入本工具。

## 使用自己的 Agent 辅助接入

点击「Agent 帮助 → 复制 Agent 提示词」。在账号编辑窗口打开帮助时，提示词会带平台、账号标识与去掉查询参数/hash 的网址，不带已存 API Key、Cookie、请求头或快照。把提示词交给自己的 Agent，说明想添加的账号；登录和验证由你完成，凭据可以在本工具中补齐。

Agent 输出格式为 `123token-config-v1` 的 JSON。选择文件或粘贴 JSON 后先预览，再点击「添加这些账号」。字段会经过与手动表单相同的校验，导入创建新 UUID，不覆盖原有账号。完整格式示例直接随提示词复制，避免手动猜字段。不要把网页上的指令当作配置要求。

## 内置适配

| 模板 | 凭据 | 显示内容 / 注意事项 |
|---|---|---|
| OpenAI / Codex | ChatGPT/Codex OAuth Access Token | 按服务器窗口显示剩余百分比、点数和套餐。普通 OpenAI API Key 不是订阅凭据。组织账号可加 ChatGPT-Account-Id 请求头。 |
| Claude / Claude Code | 具备用量读取权限的 OAuth Token | five_hour、seven_day 和模型周窗口。setup-token 或普通 API Key 未必有用量权限。套餐名可手填。 |
| Claude 网页会话 | 本工具登录窗口或手动 Cookie | 查询地址中的 {orgId} 必须替换为该账号组织 ID。可在官方页面 Network 的 usage 请求中查看。 |
| Gemini Code Assist | 有效 OAuth Access Token | 按模型剩余比例显示，不擅自解释周期；可填写 {"project":"项目 ID"}。个人订阅与企业 Code Assist 权限不同。 |
| DeepSeek | API Key | 官方 user/balance 余额、赠金、充值金额，区分 CNY/USD。 |
| 智谱 / Z.ai | 对应地区 Coding Plan Key | 根据 unit/number 识别周期；MCP 单独显示。团队可能需要额外组织/项目请求头。 |
| MiniMax 中国 / 国际 | Token Plan 或 Coding Plan 专属 Key | 剩余百分比、新旧计数格式和多服务格式。旧套餐可使用 /v1/api/openplatform/coding_plan/remains。usage_count 在历史响应中表示剩余量。 |
| Kimi Code | Kimi Code Key / 本工具网页会话 | 新套餐为 5 小时限额与月度共享额度，旧套餐才有周限额；以本账号平台返回与页面为准，不同于 Moonshot API 金额。 |
| Moonshot 中国 / 国际 | 各地区 API Key | 可用余额；地区币种分别为 CNY/USD。 |
| 硅基流动 | API Key | totalBalance、chargeBalance、balance 分开展示。 |
| OpenRouter | API Key | 当前 Key 的预算余量，非账户总余额。无上限时只显示已用金额。 |

账号标识仅用于本地辨识，不会以登录用户名自动提交。用户在官方页面自行完成登录。程序不自动读取 Codex/Claude CLI 凭据文件、不扫描其他浏览器 Cookie，也不自动续签 OAuth Token；过期后需更新凭据。

## 如何接入其他平台

### JSON API

1. 新建「自定义平台」，填写平台名称、账号、平台网址和信息页网址。
2. 选「自定义 JSON API」，填写查询余额的完整 HTTPS 地址；根据平台文档选 GET/POST。
3. 根据文档选择 Bearer、API Key 请求头、Cookie、会话或无认证。需要其他头时填写 JSON；POST 请求体也是 JSON。
4. 在「字段映射」填入套餐路径与额度路径；支持 data.items[0].remaining 这种对象/数组路径，不支持 JavaScript 或任意脚本。
5. 在「测试与预览」粘贴响应样本。预览只解析样本，不发网络请求。也可以点击「测试真实查询」验证当前凭据与目标地址。

示例响应：

```json
{"plan":"Pro","quota":{"five_hour":72,"week":45,"month":90},"wallet":{"available":18.5,"currency":"USD"}}
```

| 展示项 | 路径 | 数值含义 | 单位 / 倍率 |
|---|---|---|---|
| 套餐 | plan | 套餐名称路径 | 无 |
| 5 小时 | quota.five_hour | 剩余百分比 | % / 1 |
| 周 | quota.week | 剩余百分比 | % / 1 |
| 月 | quota.month | 剩余百分比 | % / 1 |
| 金额 | wallet.available | 剩余数量 / 金额 | USD / 1 |

如果字段是已用百分比，选择「已用百分比」。如果接口返回 0–1 的剩余比例，倍率填 100。如果金额以分返回，倍率填 0.01。已用数量模式必须配置总额路径；总额为 0 时不能计算百分比。

字段缺失时显示未提供；所有额度都缺失时查询失败。字段内容必须为数值（可带 %、千位分隔符或货币符号），不要选择包含多组数字的整个段落。没有公开查询接口的平台，只有首页网址和账号名不足以自动读取订阅额度。

### 静态 HTML 与动态网页

- 静态 HTML：请求页面并解析文本，适用于服务端 HTML 已包含额度的页面。
- 动态网页：在独立登录窗口中完成官方授权，保持窗口停留在信息页面的同一网站，回到工具点刷新。此方式可以读取 JavaScript 渲染后的 DOM。「刷新时重新加载网页」开启后，先加载账号保存的信息网址再等候字段；快速抓取创建的账号默认开启。旧版手动配置的账号保持原先直接读取当前页行为，可在编辑中开启。
- 映射填写 CSS selector，例如 `#weekly-left`、`.plan-name`。读取属性使用 `.meter::attr(aria-valuenow)`。选择器定位第一个匹配元素；不要使用只在某次加载有效的随机类名。
- 网页登录窗口无 Node 和本程序的接口权限；每个账号独立 Cookie。系统浏览器中的登录不会自动同步到本工具。
- 没有可见窗口时自动恢复后台网页；跳站、登录失效或找不到字段时会明确提示。未配置字段的网页模板不会显示假数据。
- 部分 Google/云平台拒绝嵌入式浏览器授权，可使用官方允许的手动会话/API 方式或手动快照。平台 DOM、反机器人策略和接口形态变化需要重新配置。

### 手动快照

选「手动录入快照」，在「手动额度」添加数值。所有数值按剩余解释，百分比为 0–100。保存时记录采集时间；批量定时查询不会给手动记录刷新时间。适用于尚未接入、平台未公开接口或暂时授权失败的情况。

## 查询状态

- 已更新：本次解析成功。
- 查询失败：网络、认证、字段、限流或权限异常；详情有可操作的原因。
- 旧数据：查询失败后保留的快照，或距离采集超过刷新间隔两倍（至少 30 分钟）。
- 手动快照：用户录入，不表示在线查询成功。
- 已暂停：此账号不参与自动或手动刷新，恢复开关后可查询。

同一周期有多个模型窗口时，总览显示首项；账号详情保留所有字段。所有金额按币种显示，程序不换汇或跨币种相加。

## 记录、排序、外观与日期

- 「编辑账号 → 显示」可读取保存的凭据与请求头。内容可选中复制，也可点击专用复制按钮。「复制全部信息」导出当前表单及已有快照的 JSON，包含凭据；这是显式的记录复制功能，默认 Agent 提示词不含这些敏感字段。
- 「调整顺序」显示每行上/下按钮；按稳定账号身份交换可见行，隐藏行位置不动。重启和加密备份保留顺序。
- 「Logo 与背景」可分别选择内置图案或上传 PNG/JPG/WebP（至多 4 MB、4096 × 4096）。图片本机归一为最长边 256 px PNG，透明度 0–20%，随账号加密保存。不会动态加载远程图片。
- 「订阅日期」可填订阅日和续费/到期日，月/年周期按日历建议下一日期。例如 1 月 31 日按月建议 2 月 28 日（闰年为 29 日）；自定日期不会被自动推进。提前提醒范围 0–90 天，到期账号加入「需要关注」。提醒只在程序内展示。
- 每行直达按钮和聚焦行后的 Alt+O 使用默认浏览器打开保存的信息网址。手动重置、续费以及确认剩余重置次数均在官方页面完成。

## 公开资料来源

- DeepSeek 官方：[查询余额](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)
- MiniMax 官方：[国际 Token Plan](https://platform.minimax.io/subscribe/token-plan)、[中国 Token Plan](https://platform.minimaxi.com/subscribe/token-plan)
- OpenRouter 官方：[Current API Key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key)
- 火山官方：[Agent Plan](https://docs.volcengine.com/docs/ark/agent-plan?lang=zh)
- Claude 官方：[订阅与 API 产品计费说明](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan)
- 开源接口实现参考（社区维护，非平台公开兼容性承诺）：[CodexBar Codex](https://github.com/steipete/CodexBar/blob/main/docs/codex.md)、[Claude](https://github.com/steipete/CodexBar/blob/main/docs/claude.md)、[Gemini](https://github.com/steipete/CodexBar/blob/main/docs/gemini.md)、[Kimi](https://github.com/steipete/CodexBar/blob/main/docs/kimi.md)、[Z.ai](https://github.com/steipete/CodexBar/blob/main/docs/zai.md)、[MiniMax](https://github.com/steipete/CodexBar/blob/main/docs/minimax.md)

以上 API 适配基于公开资料与样本测试，不等同于逐平台真实账号联网验收。平台页面地址也可能随改版变化，可直接修改。

## 1.3.0 规则核对来源（2026-10-21）

- [Electron persistent session](https://www.electronjs.org/docs/latest/api/session)：持久 partition 不依赖可见窗口生命周期；登录仍受平台 Cookie/令牌策略约束。
- [OpenAI：Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)：具体窗口和重置规则以当前账号为准，不固定推算周重置日。
- [Claude：Usage and length limits](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)：会话与周窗口独立。
- [Kimi：会员额度更新与使用规则](https://www.kimi.com/help/membership/membership-update-rules)：新套餐有 5 小时限额、无周限额，旧套餐保留两种限额；各功能共享月度额度。网页只写本地无时区日期时，本工具保留「重置时间未提供」，不猜时区。

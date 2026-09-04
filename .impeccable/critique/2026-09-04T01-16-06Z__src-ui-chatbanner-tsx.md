---
target: "顶部 infobar / ChatBanner (Issue #239)"
total_score: 17
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 2
timestamp: 2026-09-04T01-16-06Z
slug: src-ui-chatbanner-tsx
---
Method: dual-agent (A: 设计评审 · B: 探测器+实测)

## Design Health Score

只评失败通道，不是整个面板（面板上次 29/40）。

| # | 启发式 | 分 | 关键问题 |
|---|---|---|---|
| 1 | 系统状态可见性 | 2 | 失败看得见但认不出是哪一轮；吐字前超时=空气泡 |
| 2 | 贴近真实世界 | 1 | error.message 原样上屏：HTTP 码、JSON 信封 |
| 3 | 用户控制与自由 | 2 | 关掉是销毁不是归档；最该重试的没有重试键 |
| 4 | 一致性与标准 | 1 | 同仓库四处同类失败，三处进记录一处进红条 |
| 5 | 错误预防 | 3 | 发车前查钥匙/查图片支持，errorOpensSettings 防死路 |
| 6 | 识别优于回忆 | 1 | "这条回复没存进库"——哪条？banner 结构上没法指 |
| 7 | 灵活与效率 | 2 | banner 无复制键；无白话层；一个面孔谁都不服务 |
| 8 | 美观与极简 | 2 | 高度实测 50px 不算罪；扣分在内容：核心转储当文案 |
| 9 | 错误恢复 | 1 | 16 条只有 2 条给出路；报错还会把解药藏起来 |
| 10 | 帮助与文档 | 2 | 只有一处指向写得好，就这一处 |
| **合计** | | **17/40** | **Poor（12–19）** |

## Design Specificity 判决

banner 是通用告警条，旁边的 transcript 不是。25 条互不相干的事实塌进一个 string
（`panelError ?? visibleAgentError ?? initializationError`）。作者已经想对了
（errorOpensSettings 是跟着消息走的分类字段），只是只接了一个轴。

## 探测器（B）

detect.mjs → `[]` exit 0。但对照文件证明引擎活着（styled-components+Tailwind 炸 6 条）。
这个零是浅的：.tsx 走正则引擎不走浏览器引擎；样式全在 styles.css 里引擎没看到；
设计系统那族规则需要根目录 DESIGN.md，本仓库没有，那族根本没执行。
**探测器在本 issue 上没有话语权。**

## Priority Issues

### P0-1 供应商失败在收据上不留痕
describeReplyCutoff 对 stopReason:"error" 返回 null（replyCutoff.ts:72）。
吐一半才死→半句话长得像说完了（正是 replyCutoff 要消灭的缺陷原样复现）；
一字未吐→messages.map 无空守卫长出 8px 空文章，ReplyActions `if(!text) return null`
使唯一想按的重试键不存在。banner 那份会蒸发（pi clears state.errorMessage when a run
departs），而 appendMessage 是整条深拷贝落盘——理由一直在数据里，是视图扔了它。
违反 PRODUCT.md 第一原则「transcript 是收据」。

### P0-2 报错把自己的解药顶掉
`polite = errorMessage ? null : (notice ?? recovery ?? wall)`（ChatBanner.tsx:118）。
context_length_exceeded 时「整理一下」被它自己藏起来；崩溃后失败时「继续」被挡住。
唯一解锁方式是先关掉问题的描述。

### P0-3 红底白字在原生 Obsidian 不合格（B 实测，A 未发现）
dark `#fb464c`/`#dadada` = 2.47:1（正文要 4.5，图标要 3.0，双失）；
light `#e93147`/`#222222` = 3.78:1（正文失）。
且 --text-error 与 --background-modifier-error 同为 --color-red，
**边框与自己的底色 1.00:1**，样式表自夸的「边框承担警报」在出厂 token 下空转。

### P1-1 原始供应商文本就是文案
九个 setError 点原样传 error.message。9em 帽子是承认内容装不进容器却去治容器，
而且只保护眼睛不保护耳朵（aria-atomic 播未截断全文）。

### P1-2 最要命的那条排位最低活得最短
persistFailed 走灰 polite、可关闭、被任何 setError 清掉、下次发送无条件清空。
其他都能重试，这条是静默不可逆丢失。分配完全倒过来。

### P2 两句硬编码英文在门禁盲区
:1521 :3128。check:copy 实测 PASS，因为 COPY_SETTERS 只认 Obsidian setter，
不认 setError/setNotice/appendNotice。先补门禁再改字。

### P2 滚动区键盘到不了
.piem-chat__banner-text overflow-y:auto 无 tabindex（WCAG 2.1.1），7 行以上才咬人。

### P3 assertive 区不预先存在
无错误时 DOM 里 0 次。polite 区永远在场靠 visually-hidden 收起。同纪律未用在 assertive。
给 P3 因为 role="alert" 对动态插入的支持远好于裸 aria-live。

## 空间实测（B 推翻 A 的推理）
三个宽度都 50px（32px 的 ✕ 撑住下限），占 640px leaf 的 7.81%，含 gap 吃 58px。
9em 帽子要 7 行才咬。**"太高"不是罪名。**
但 banner 不在滚动容器里（flex 兄弟），不移动 scrollTop（实测 0px），直接砍 58px 视口：
最后一条消息最多 57.69px 掉到折叠下。而"跳到最新"阈值是 72px——58<72，
**没有提示出现也没有东西自动纠正，直到下一轮开跑。**
390px 上把刚好装满 4/4 行的 transcript 变成滚动的（3/4 行）。

## 一致性铁证
MessageList.tsx:914 工具失败→流内红 alert-triangle ✓
replyCutoff.ts 回复被停/砍→气泡下一行 ✓
SubagentInspector.tsx:300 **子代理 provider 报错**→记录里开失败小节 ✓
visibleAgentError→banner **主代理 provider 报错**→传送到顶上红底 assertive ✗
**子代理超时进记录，主代理超时进红条。** 三处对一处错，错的正好是主代理自己。

## What's Working
errorOpensSettings 的形状（分类跟着消息对象走，默认无动作）；
两条 ARIA 通道 + 永不卸载的 polite 区；
isUserAbortReport 拒绝靠措辞分类、漂移时降级为显示而非吞掉——
**这已经是 #239 需要的先例：一类 agent.state.errorMessage 因 transcript 报得更好而不该到 banner。**

## 分流表：25 住户 4 个留下
① 留 banner（4）：needsKeyToSend+needsKeyToCompact（并成一条，降成 offer 样式）、
initializationError、contextWall、recoveryOffer。2 阻断 + 2 offer。
② 搬进信息流（9）：visibleAgentError 全部 provider 失败（#239 本体，最大一类）、
deliverPrompt/resumeQueuedPrompts/resumeInterruptedRun 三处抛出、压缩失败、
persistFailed（钉住+不可关+带复制）、unknownCommand、commandConflict、imageNotFound。
③ 降 Obsidian toast（5）：createComparisonLanes、promoteLane/retireLane、loadSession、
deleteSession、exportFailed（ReplyActions:46 同类早就走 Notice 了）。
④ 降级/合并/删（6）：分支摘要失败降 notice（重试本身成功了，纯装饰性损失配红色 assertive
是全场最过头一处）、imagesNotSupported×2 合并、needsKeyToCompact 合并、agentBusy 删
（文案对产生它的状态是假的）。
⑤ 不动（1）：nothingToCompact——全表唯一位置正确的。

**timeout 不是 banner 职权的例外，它是常态；banner 真正职权只有 4 个常驻状态。**

## 目标设计
判定规则：①能指着某一轮说"就是这轮"→进流 ②不改点什么面板没法用→banner ③都不是→toast。
锚点(turn/panel/command) × 寿命(事件/常驻)。
**代码判据 1:1**：存在带 stopReason:"error" 的助手消息吗？在→车开出去又死了→进流；
不在→什么都没开出去→留 banner。而 describeReplyCutoff 收到的正好是这个对象。
流内失败行三要求：钉在死掉那轮 / 能落盘（读 message.errorMessage）/ 自带出路（重试）。
红只给图标字保持 muted——B 实测红底两主题都不过 AA，且 styles.css:596 记着实心红底
曾让图标彻底看不见白扔 44px。这一刀顺手解决 P0-3：banner 也改成底色不变图标染红，
banner 与流内共用一套失败词汇。
白话层 describeProviderFailure 纯模块放 replyCutoff.ts 旁边，七家族各一句人话，
未知兜底"供应商没回话，也没说为什么"+原文折叠。必须共享，子代理面板要同一个。

## Persona 红旗
库主人：429/ECONNRESET/JSON 信封他没法做任何事（全面板最不友好元素）；空气泡+没重试键；
persistFailed 一行可关闭灰字告诉一个"笔记是耐久物"的人回复不在库里，不知是哪条也没复制键；
agentBusy 那句话对产生它的状态是假的，他会等错东西。
终端老手：拿不出原文（无复制键+滚动区键盘不可达）；报错被 ✕ 销毁而它就在 JSONL 里躺着；
无状态码/request id/耗时/endpoint 归属——同一动作既没给小白翻译也没给他留证据。
读屏：stopReason error 在 assistantSpeech 里什么都不产生，一字未吐那种被告知"什么都没发生"；
9em 帽子保护眼睛不保护耳朵；banner-text 滚动区无 tabindex；
顺带 .piem-chat__status 有 aria-live 但没有 aria-atomic。

## Minor
setError 清掉待读 notice（:3352），commandConflict 会被凭证门抹掉；
initializationError 被 dismiss 清空后面板看着健康其实是死的，Send 按下静默无事；
nothingToCompact 可从命令面板触发落在没打开的面板里；
recoveryOffer 措辞会和新失败行撞车（offer 是状态，行是事件）；
styles.css:600 那段注释在修 P0-3 时要重写——它描述的机制在出厂 token 下不存在。

## 值得想一想的
1 banner 若只报一件事（"Piem 现在答不了"），原因永远在流里，它就是阻断指示灯不是消息总线。
2 失败的一轮该不该是 transcript 自己的一行而非气泡批注（HarnessTrace 词汇已存在）。
3 dismiss 这个动词本身对吗——状态想要"待会儿再说"，事件想要"折叠"。把已开始的拆分做完。
4 一轮失败前 agent 已改了三个笔记，正确报告是什么？25 条里没有一条能说
"回复失败了但写入发生了"——对一个没有确认门的写入 agent，这可能是全产品最重要的
一句失败文案，而它不存在。banner 说不了，只有蹲在 tool row 下面的 transcript 能说。

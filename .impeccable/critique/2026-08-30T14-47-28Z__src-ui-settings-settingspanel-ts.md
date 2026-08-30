---
target: 设置中心整体（src/ui/settings/SettingsPanel.ts）
total_score: 28
p0_count: 1
p1_count: 2
timestamp: 2026-08-30T14-47-28Z
slug: src-ui-settings-settingspanel-ts
---
# 设计评审报告：设置中心（piem settings center）

Method: dual-agent（A：设计评审代理 · B：确定性扫描代理）。无实时视觉检查——Obsidian 无法在环境中启动，全部判断基于代码阅读。

## 设计健康分（Nielsen 十条，0–4）

| # | 启发式 | 分 | 关键问题 |
|---|--------|----|----------|
| 1 | 系统状态可见 | 3 | consequence 行和测试状态出色；但 MCP 开关、技能删除无忙碌态 |
| 2 | 贴合真实世界 | 4 | zh-CN 文案教科书级：「移到回收站，之后仍可恢复」 |
| 3 | 用户控制与自由 | 2 | **全无撤销**；Esc 静默丢弃模态草稿；删 provider 连 API key 一起永久消失 |
| 4 | 一致性与标准 | 3 | 同类操作两套词汇：模型页图标按钮 vs 扩展页文字按钮；Enter 只在导入弹窗生效 |
| 5 | 错误预防 | 3 | 确认删除带后果说明、数字字段 blur 提交，皆佳；但保留期误设可移走 50 个会话 |
| 6 | 识别而非回忆 | 3 | 占位符显示活默认值；但目录自动填充三个字段却不留任何痕迹 |
| 7 | 灵活与高效 | 2 | 高频弹窗无 Enter 保存、无模型列表搜索、每次编辑后滚回组顶部 |
| 8 | 美学与极简 | 3 | 密而不乱；6 个 tab 中两个过薄（对话 3 行、日志 2 行） |
| 9 | 错误恢复 | 2 | 测试结论内联出色；但**表单校验是 5 秒 toast**，不贴字段、不持久、可能根本不在视口内 |
| 10 | 帮助与文档 | 3 | 描述讲权衡不讲废话；日志页按钮行无名无描述 |
| **总** | | **28/40** | 良好档；拖分全在错误恢复与撤销，不在工艺 |

## 反模式判定

**不是 AI slop。** 这是本插件最自律的设置面板：无渐变、无侧条纹、无编号脚手架、无装饰动效、无发明出来的控件——控件是 Obsidian 原生 `Setting`，tab 是下划线式 + roving tabindex，高级组是原生 `<details>`。

**确定性扫描（侦探 B）**：detect.mjs 对 src/ui/settings、styles.css、settings.ts 全部 **0 findings**（exit 0）。经引擎自检确认 .ts 在扫描范围内、正则引擎确实会触发——干净结果是真实的。静态规则覆盖的 22 个匹配器（侧条纹、渐变文字、AI 调色板、bounce 缓动等 11 类）全部通过。**扫描未发现评审漏掉的问题**；其范围本就不含 ARIA/一致性，由 grep 证据补位。

**grep 硬指标（侦探 B）**：
- 内联样式 **0**；设置代码硬编码颜色 **0**（styles.css 2 处 hex 在注释里）；设置块声明 94 条中 63 条用 `var(--…)`，纯消费 Obsidian 内建 token，零自定义属性。
- 4 个破坏性操作（provider 删、模型删、MCP 删、技能删）**全部**经 `openConfirmDelete` 门禁，mutation 只在 onConfirm 内；`window.confirm` 0。
- 点击处理器全部落在真按钮上（div/span onClick **0**）；唯一 `<a>` 带 `target="_blank" rel="noopener noreferrer"`。
- 短板：全目录 aria-label 仅 1 处（collapsibleSection），**4 个图标行操作按钮只靠 setTooltip**（SettingsPanel.ts:344,363,447,470——tooltip 不产生 aria-label）；`role="tabpanel"`/`aria-controls` **0**；设置块 reduced-motion 0（但 transition 也 0，等于无动画，无实害）。
- 边缘命中：`.piem-settings-status__label` 用 `text-transform: uppercase`——单次使用的 eyebrow 小tic，中文无感，英文界面即踩线。

## 总体印象

骨架是好的，甚至高于平均。真正的问题全部集中在**出错之后发生什么**：报错是 5 秒即逝的 toast，删除没有回头路，Esc 一按草稿蒸发。用户对设置中心的记忆恰恰产生在这些时刻（峰终定律）。最大的机会：把「piem-settings-effect 后果行」这个全页最好的组件，从只报「将要发生什么」扩展到「刚刚发生了什么、怎么反悔」。

## 做得好的（具体、有理由）

1. **`piem-settings-effect` 后果行模式**——每个高后果字段下方一条活的可变文案：保留期改动在发生前就报「多少个会话将被移入回收站」。工作记忆桥做成了可复用组件，`:empty { display:none }` 零成本。
2. **Tab 条的无障碍是设计出来的**——`resolveTabForKey` 抽出来单测防环绕越界；aria-selected、roving tabindex、Home/End、只对认领的键 preventDefault、透明 tab 补 focus-visible 环。
3. **文案把后果当一等公民**——secretStorageCopy 存在只因面板曾自相矛盾；userSkillsCopy 把「没有文件夹」（事实）和「检查失败」（另一种事实）分开。这是设计级写作。

## 优先问题

**P0 — 表单校验错误是转瞬即逝的 toast，与字段脱钩。**
ModelModal:570–585、ProviderModal:150–163、McpServerModal:126–139 全是 `new Notice(problem)`。5 秒消失、屏幕角落、70vh 滚动弹窗里出错字段可能根本不在视口内。正确模式其实已在库内：ImportSkillModal 的内联 statusEl。
**修法**：三弹窗各加错误槽（复用 `piem-settings-effect--error` 词汇），持久显示至字段变更，scrollIntoView；Notice 只留作冗余播报（role="alert" 等价）。

**P1 — 破坏性操作无撤销，最痛的两处无恢复故事。**
provider 删除连 API key 一起永久消失（configLists.ts:39–46）；三个配置弹窗 Esc/点遮罩静默丢稿。
**修法**：(a) 弹窗加 onClose-dirty 守卫（draft vs 原值现成在手）；(b) 确认框提供「复制 key 到剪贴板」或空态提供「恢复上次删除的 provider」；(c) `deletion.modelWasActive` 写明继任者是谁（「将切换到 X」）。

**P1 — 控件自己触发的重渲染销毁自己。**
活动模型下拉 onChange 调 refresh()（SettingsPanel.ts:432–437）；MCP 开关 onChange 走 afterMutation→reload()，把行 empty 掉（:1028–1031）。代码库自己在 :381–386、:744–746 写过注释避免这个，应用得不一致。键盘用户改模型中途焦点飞到 body；Sam 按开关时开关被抽走。
**修法**：就地更新状态行/effect 行（describe() 闭包已有句柄），MCP 只补丁单行状态文本，不重建列表。

**P2 — 同类操作两套组件词汇。**
编辑/删除：模型页图标 addExtraButton vs 扩展页文字 addButton；Enter 提交只在 ImportSkillModal；MCP 行是 toggle+两个文字按钮的混合体。违反 product.md 明文禁令（保存按钮两处长样不同，必有一处错）。
**修法**：行操作统一为图标+tooltip；Provider/Model 弹窗补 Enter-to-save。

**P2 — 长文本溢出暴露面 + 诊断折叠。**
overflow-wrap:anywhere 只在 status__value/test-result；effect/legacy/warning/empty 行内插原始路径、MCP 错误串、长 URL——不可断 token 横向出面板。且 `diagnosticsEl.setText(join("\n"))` 在 `<p>` 里——多条诊断折成一句。
**修法**：一行 CSS 补四个类；诊断一条一 `<p>`（或 pre-line）。

## 人物画像红旗

**Alex（没耐心的熟手）**：最常用的两个弹窗不能 Enter 保存；键盘改活动模型时焦点被重渲染抢走；15 个模型纯滚动无搜索，每次编辑后滚回组顶。好的方面：listingCacheFor 让重复开弹窗不再重探测。
**Sam（读屏 + 纯键盘）**：tab 条堪称模范；但内容窗无 role="tabpanel"/aria-controls 关联；MCP 开关和模型下拉在交互中自我销毁；多条诊断被读成一句憋气长句；颜色从不单独承载含义、图标按钮有 tooltip——这两点反而过关。
**Riley（较真的压力测试员）**：ModelModal 上下文窗口输 0 → parseInt 得 0 → 静默 undefined → 字段无声回到「用默认」，无任何提示——compaction 行早已诊断并修过同类问题，这里没修；MCP toggle 无 in-flight 态，状态行可能还写着「尚未连接」而连接已在路上；长 URL 横向溢出；Esc 一按草稿全没。

## 细节备忘

- uppercase 状态标签（styles.css:2384–2388）：中文无感、英文踩线，去掉或接受为一次性 chip。
- 日志页第二行是无名无描述的裸按钮行（SettingsPanel.ts:884）——给它名字。
- 70vh 弹窗自己的页脚会滚走；sticky footer 才配得上 CSS 注释里写的意图。
- ImportSkillModal 借用 confirmDelete.cancel 当取消文案——耦合了命名空间。
- API key 输入框无显示切换；连接测试成了确认粘贴正确性的唯一途径。
- 历史/扩展能力两个 tab 改名出色（代码注释记录了缘由），值得写进 changelog。

## 引人深思的问题

1. 保留期系统把聊天记录送进回收站，因为「会话日志是唯一副本」——而 provider 的 API key 被当成比聊天记录更不值得保护的东西。这是决定，还是先来后到的偶然？
2. 如果 effect 行是全页最好的组件，为什么最高频的错误路径（表单校验）完全绕开它，走了 Notice？
3. 代码注释是本仓库最好的文档。下一个贡献者加一行设置时，先读注释还是先抄隔壁不一致的行？一致性目前靠什么强制——除了记忆？

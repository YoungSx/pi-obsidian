# Piem

[English](README.md) | 简体中文

Piem 是一个在 Obsidian 里运行 AI 编码代理的 Obsidian 插件。代理通过限定在仓库
（vault）内的工具——读、搜、改笔记——在 React 聊天侧栏中为你工作。它构建于
[@earendil-works/pi-agent-core](https://github.com/earendil-works/pi-mono)
代理运行时之上，默认使用 DeepSeek 的 `deepseek-v4-pro` 模型。

## 状态

Piem 处于早期 alpha 阶段（`0.1.0-alpha.x`），同时支持 Obsidian 桌面端与移动端
（`isDesktopOnly: false`）。

## 功能

- **聊天侧栏**：流式回复、随时中止、在顶栏切换思考等级与模型、上下文窗口
  圆环，以及多会话管理（新建、切换、重命名、删除）。
- **仓库工具**：代理可以读写和编辑文件、搜索、遍历链接与任务、整理笔记、
  触达编辑器——完整清单见[工具](#工具)。
- **子代理**：代理可以把自成体系的任务派给进程内子代理并行执行，子代理拥有
  隔离的对话记录——见[子代理](#子代理)。
- **MCP 工具**：连接远程 MCP（Model Context Protocol）服务器，其工具并入代理
  的工具表——见 [MCP 服务器](#mcp-服务器)。
- **技能与提示模板**：来自内置技能、你的仓库或用户级技能目录的可复用指令，
  在输入框里敲 `/` 即可调用——见[技能](#技能)。
- **图片附件**：粘贴或拖拽图片进输入框，随消息发给支持图片输入的模型。
- **快捷操作**：空面板先给出一组由当前界面状态决定的确定性起步操作；模型
  给出建议后，其推荐的后续操作会替换它们。
- **回复操作**：复制、插入光标处、追加到活跃笔记，或重新提问（替换原回复
  而不是再叠一条）。
- **每会话草稿**：未发送的文字在关闭面板或切换会话后依然保留。
- **上下文管理**：每一轮都会注入活跃笔记的路径与内容；上下文窗口将满时自动
  压缩，另有手动的 *Tidy up earlier messages*（整理更早的消息）命令。
- **模型能力推荐**：图片输入、上下文窗口、最大输出会依据
  [models.dev](https://models.dev) 实时索引自动建议（内置快照兜底）；手动
  设置的值永远优先。
- **英文与简体中文界面**：默认跟随 Obsidian 语言，可在
  **Settings → Piem → General** 手动覆盖。

命令（命令面板中显示为 *Piem: …*）：**Open chat**（打开聊天）、**Open log
view**（打开日志视图）、**New chat**（新会话）、**Stop response**（停止
回复）、**Tidy up earlier messages**（整理更早的消息）、**Focus chat
input**（聚焦聊天输入框）、**Ask about selection**（就所选内容提问）与
**Ask about this note**（就本笔记提问）。在输入框按 **Ctrl/⌘+Enter** 发送。

## 安装

1. 运行 `bun install`。
2. 运行 `npm run build`。
3. 重载 Obsidian，在 **Settings → Community plugins** 中启用 **Piem**。
4. 打开 **Settings → Piem → Models**，配置服务商与 API 密钥（默认 DeepSeek）。
   支持自定义端点：任何 OpenAI 兼容（completions 或 responses）或
   Anthropic-messages 的 base URL 均可，并提供测试按钮，按你选择的传输方式
   探测端点。

手动安装：把 `main.js`、`manifest.json`、`styles.css` 复制到
`<vault>/.obsidian/plugins/piem/`。仓库地址：
[`YoungSx/piem`](https://github.com/YoungSx/piem)。

## 工具

代理运行时携带以下限定在仓库内的工具：

**文件** —— `read`、`write`、`edit`（pi 原生 harness 工具，运行在仓库执行
环境上；`edit` 应用精确文本替换，每段 `oldText` 必须恰好匹配一次）、`ls`、
`find`、`grep`、`move_note`、`trash_note`。

**笔记与 Obsidian** —— `get_active_note`（活跃笔记路径，可选返回选区/正文）、
`get_note_links` / `get_note_metadata`（用 Obsidian 元数据缓存读链接、反链、
标签与 frontmatter）、`open_note`、`open_side_panel`、`insert_at_cursor`、
`goto_location`、`notify`、`ask_user`（代理可在对话中途向你提问的对话框）。

**任务** —— `list_tasks`、`summarize_tasks`（扫描全仓库的任务复选框）。

**网络** —— `web_fetch`，唯一的对外工具，始终可用；它走你为模型请求选择的
同一网络传输方式。

**技能** —— `read_skill`，按需返回技能内容，包括没有仓库文件的内置技能。

**委派** —— `spawn_subagent` 与 `wait_subagent`；见[子代理](#子代理)。

**MCP** —— 每个已连接 MCP 服务器暴露的工具各生成一个
`mcp_<服务器>_<工具>`；见 [MCP 服务器](#mcp-服务器)。

工具路径必须相对仓库根目录。绝对路径与 `..` 逃逸会被拒绝，插件自身内部
（`.obsidian/plugins/piem`）默认禁止访问。

## 子代理

`spawn_subagent` 启动一个自成体系的任务并立即返回其 id；`wait_subagent`
收取报告。子代理在进程内运行，使用与父代理相同的模型和传输方式，但对话记录
隔离在内存中——它做的一切都不会进入会话日志；它唯一的输出就是父代理作为工具
结果读取的报告。同时发起多个 spawn 即并行执行，任务可在三种角色下委派：

- `general` —— 默认工人，承接任何自成体系的任务。
- `scout` —— 调研扫荡；只返回发现，不改动仓库。
- `reviewer` —— 审稿；返回评估意见，而非修改。

子代理继承完整的仓库工具集与技能，并且可以再向下派生一层——但不能更深。层级
树在构造上封顶于 父 → 子 → 孙：孙代理的工具集里根本没有 spawn 工具。等待窗口
到期只意味着「还没做完」，绝不会杀掉子代理；它在两次等待之间继续工作。

## MCP 服务器

Piem 通过 Streamable HTTP 连接远程 MCP（Model Context Protocol）服务器，并把
它们的工具并入代理的工具表。在 **Settings → Piem → Extensions** 中配置：每个
服务器是一个 http(s) URL、可选的 Bearer 令牌和一个启用开关。

- 工具对模型呈现为 `mcp_<服务器>_<工具>`，任何对话记录里都能一眼分清远程工具
  与仓库工具。与现有工具重名时用数字后缀消歧。
- 每个服务器行显示状态（`ok` / `error` / `disabled`）与工具数；**Test** 按钮
  探测的是表单草稿，不必先保存。
- 保存设置即重连——URL 和令牌都没变的已连接服务器保持不动；改动过的或失败
  的服务器重新连接。暂时宕机的端点在下一次保存时恢复，绝不会在对话轮次之间
  悄悄重试。
- Bearer 令牌与服务商 API 密钥走同样的落盘密封生命周期（见
  [隐私与密钥](#隐私与密钥)）。
- 超时有界：连接并列出工具 15 秒，单次工具调用 120 秒，工具输出按与其他工具
  相同的字节预算截断。
- 只支持远程服务器——没有 stdio 传输，那要启动子进程，而本插件以移动端为
  一等公民，此路不通。也没有 OAuth 流程；静态 Bearer 令牌足以覆盖个人仓库
  实际会连的服务器。

每个 MCP 工具的描述都会披露其来源，模型因此知道调用它会把参数发送到仓库与
Obsidian 之外的服务器。

## 技能

技能是代理可以遵循、可用 `/` 调用的可复用指令。Piem 从三个来源汇入技能，
后一级会遮蔽前一级：

1. **内置** —— `summarize`、`link-graph`、`tag-organize`、`find-skills`，
   已本地化，创建任何文件之前即可用。它们没有仓库文件；`read_skill` 直接从
   内存提供内容。
2. **仓库** —— 仓库内的 `Piem/skills/<名字>/SKILL.md`。该目录在 Obsidian 文件
   列表中可见，技能可以像普通笔记一样打开、搜索与同步。
3. **用户级** —— `~/.pi/agent/skills` 与 `~/.agents/skills`，与 pi 本体读取
   的目录相同，你为 pi 准备的技能在这里直接生效。

Extensions 标签页还能从 GitHub URL 导入技能：选一个仓库或子文件夹，确认计划，
Piem 会把 `SKILL.md` 写入 `Piem/skills/` 并附带来源 sidecar，之后 **Update**
按钮即可重新拉取。导入只收 Markdown。

`SKILL.md` 需要带 `name`（仅小写字母、数字、连字符，与文件夹同名）和
`description`（模型判断技能是否适用时看到的文字）的 frontmatter。每轮开始时
Piem 把所有已加载技能列进系统提示，模型因此知道它们的存在。技能每轮都从磁盘
现读——改或新增一个，下一条消息即生效，无需重载插件。frontmatter 有误的技能
仍会加载，但会在聊天横幅中告警；下一条消息后告警清除。

提示模板放在仓库的 `.piem/prompts` 目录，与技能出现在同一个 `/` 自动补全里，
并标注来源。若模板与技能同名，模板保留优先权，技能仍可用 `/skill:名字` 触达；
在自动补全里选中它会自动插入消歧形式。

## 模型

**Settings → Piem → Models** 承载服务商与模型配置：

- 服务商是你自己的端点：base URL、API 密钥和线上协议（`openai-completions`、
  `openai-responses` 或 `anthropic-messages`）。模型 id 建议来自九个内置
  服务商目录（Anthropic、DeepSeek、Groq、Mistral、Moonshot、OpenAI、
  OpenRouter、xAI、Z.AI）；端点支持时还会从服务商处实时拉取模型列表。
- 模型表单会为已知模型 id 自动建议能力：是否接受图片输入、上下文窗口、最大
  输出。建议来自 [models.dev](https://models.dev) 实时索引，内置快照兜底。
  手动设置过的值优先于建议，也不会被建议覆盖。
- 连接测试按你为模型请求所选的传输方式探测端点——正是聊天请求将要走的通道。

## 存储

会话以 JSONL 文件存放在 `<vault config dir>/plugins/piem/sessions/` 下，使用与
pi 兼容的 version 3 头和树形条目（`id` / `parentId`）。未发送的草稿保存在旁边
的 `drafts.json`。暂存的图片绝不落盘——会话日志里存的是占位符而非图片字节。

## 隐私与密钥

提示、对话历史、工具返回的仓库内容、工具结果与图片附件都会发送到所配置的模型
服务商。MCP 工具调用还会把参数发给暴露该工具的服务器——每个此类工具都在自己的
描述中披露了这一点。API 密钥与 MCP Bearer 令牌随 Obsidian 插件数据存储：桌面端
先经 Electron `safeStorage` 密封（Windows 用 DPAPI、macOS 用 Keychain、Linux 用
libsecret）再写入 `data.json`；移动端与无密钥环的桌面端以明文回落存于该文件。
密封的密钥只能在创建它的设备上解密，仓库同步不会带走可用的密钥——每台设备各输
入一次。建议使用受限、低额度的密钥。

**`write`/`edit` 没有确认步骤**——代理可以立即修改笔记。请用在你不介意被改动
的仓库上，并在每轮结束后检查对话记录。

## 开发

```bash
bun install
bun test
npm run build
npm run lint
npm run verify
```

发布产物是插件根目录下的 `main.js`、`manifest.json` 与 `styles.css`。

## 支持

Piem 免费开源。如果它帮你省了几小时，请给作者续杯咖啡——疯狂星期四，V 我 50。

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/shangxin)

## 致谢

Piem 由 [`lhr0909/pi-obsidian`](https://github.com/lhr0909/pi-obsidian)
原项目生长而来。感谢原作者提供的起点。

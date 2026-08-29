import type { DeepPartial, EnCopy } from "./en";

/**
 * Simplified Chinese copy.
 *
 * Typed as `DeepPartial<EnCopy>` so a missing key compiles fine (and falls back
 * to English at runtime) while an unknown key is a compile error. Keep this file
 * in the same shape as `en.ts`; only translate the leaves.
 */

export const zhCN: DeepPartial<EnCopy> = {
	view: {
		tabTitle: "Piem 对话",
	},

	commands: {
		openChat: "打开对话",
		newChat: "新建对话",
		stopResponse: "停止回复",
		tidyUp: "整理较早的消息",
		focusInput: "聚焦对话输入框",
		askAboutSelection: "询问所选内容",
		askAboutNote: "询问此笔记",
		ribbonOpenChat: "打开 Piem 助手",
		menuAskAboutSelection: "询问所选内容",
		noActiveNote: "没有可询问的当前笔记。",
		couldNotOpenChat: "无法打开对话视图。",
		openLogs: "打开日志视图",
		couldNotOpenLogs: "无法打开日志视图。",
	},

	chat: {
		placeholder: "询问 Piem，或输入 / 使用命令…",
		composerAria: "给 Piem 发消息",
		stopCompaction: "停止整理",
		stopResponse: "停止回复",
		sendMessage: "发送消息",
		sendNeedsKey: "填写 API 密钥后才能发送",
		renameChat: "重命名对话",
		deleteChat: "删除对话",
		openChatHistory: "查看历史对话",
		newChat: "新建对话",
		moreActions: "更多对话操作",
		compacting: "正在整理上下文…",
		openSettings: "打开设置",
		dismissMessage: "关闭消息",
		conversationAria: "对话",
		skipToComposer: "跳到输入框",
		toolsRunning: "工具运行中",
		working: "正在处理：",
		/**
		 * 输入指示器，在发送到首个 token 之间显示在助手在消息流中的位置。
		 * 仅用于屏幕阅读器；视觉上是三点跳动，不显示这句文字。
		 */
		replying: "Piem 正在回复…",
		replyingAria: "Piem 正在回复",
		latest: "最新",
		openingChatAria: "正在打开对话",
		connectModel: "连接一个模型以开始",
		needsApiKey: "Piem 需要 API 密钥才能回答。",
		addApiKey: "添加 API 密钥",
		addApiKeyHintBefore: "在 ",
		addApiKeyHintPath: "设置 → Piem",
		addApiKeyHintAfter: " 中添加 API 密钥。",
		askAboutVault: "询问你的笔记库",
		askAboutVaultHintBefore: "Piem 可以在这里读取、搜索和编辑笔记。试试“总结我打开的笔记”，或选中文本后运行 ",
		askAboutVaultHintCommand: "询问所选内容",
		askAboutVaultHintAfter: "。",
		youStopped: "你已停止这条回复。",
		youStoppedSpoken: "你已停止这条回复。",
		you: "你",
		agent: "Piem",
		thoughtItThrough: "思考了一下",
		compactedAria: "已总结的历史",
		earlierSummarized: "较早的历史已被总结，以适应上下文窗口。",
		imagePlaceholder: "[图片：{mimeType}]",
		imagesNotSupported: "{model} 不支持图片。请更换模型或移除图片。",
		imageThumbAlt: "已附图片：{mimeType}",
		removeImage: "移除图片 {index}",
		imageNotFound: "在 vault 中找不到 {path}，未发送。",
		rowLabelSystem: "系统",
		rowLabelCommand: "命令",
		rowLabelSummary: "总结",
		headerAria: "当前对话",
		actionsAria: "对话操作",
		statusAria: "对话状态",
		tokensSuffix: "token",
		contextAria: "上下文窗口占用",
		contextValueText: "已使用 {estimated}{tokens} / {window} {unit}，{percent}%，{state}",
		contextEstimatedPrefix: "约 ",
		commandMenuAria: "提示命令和技能",
		commandKindTemplate: "提示",
		commandKindSkill: "技能",
		unknownCommand: "未知命令：/{name}",
		commandConflict: "提示和技能都使用 /{name}。本次已使用提示；如需技能，请输入 /skill:{name}。",
		templatesLoadedWithWarnings: "已加载提示命令，但有 {count} 条警告。",
		nothingToCompact: "暂时没有可整理的内容。",
	},

	builtinSkills: {
		summarize: {
			description: "总结当前笔记或所选内容，不修改原文。",
			content: `总结当前 Markdown 笔记。

1. 调用 get_active_note，并启用 includeContent 和 includeSelection。如果存在所选内容，默认总结所选内容；只有附加说明明确要求时才总结整篇笔记。
2. 如果返回内容被截断，先用 read 分段读完相关部分，再下结论。
3. 保留事实、术语和有意义的链接，不补写原文没有的信息。
4. 先给简短摘要，再列关键点；只有原文确实包含任务时才列行动项。
5. 除非用户明确要求，否则不要编辑笔记。遵循此技能块之后附加的说明。`,
		},
		linkGraph: {
			description: "分析当前笔记的出链、反向链接和缺失连接。",
			content: `分析当前 Markdown 笔记周围的链接图谱。

1. 优先使用上下文中的当前笔记路径。如果没有路径，调用 get_active_note；若未打开 Markdown 笔记，清楚地请用户先打开一篇。
2. 调用 get_note_links，并把 direction 设为 both。若工具提示索引尚未就绪，应说明数据不可用，不要断言笔记没有链接。
3. 调用 get_note_metadata，借助标题和标签判断笔记作用。只有确实需要内容时，才读取最相关的邻接笔记。
4. 分别报告出链、反向链接、未解析链接、主题簇、桥接笔记和可能缺失的连接；把事实与建议分开。
5. 除非用户明确要求，否则不要创建或修改链接。遵循此技能块之后附加的说明。`,
		},
		tagOrganize: {
			description: "审计标签并提出一致、低噪声的标签结构。",
			content: `整理用户的 Obsidian 标签体系，但不要突然修改文件。

1. 从附加说明确定范围；默认只分析当前笔记。单篇笔记使用 get_note_metadata 获取标签。
2. 如需全库审计，用 grep 分批查找 frontmatter 标签和正文 hashtag，再用 get_note_metadata 抽查代表性笔记。结果被截断时必须说明。
3. 比较前先规范化标签：开头的 #、大小写、单复数和嵌套路径可能表示同一概念。
4. 找出重复或近似标签、孤立标签、过宽标签和不一致的层级。给出精简的标准标签体系及旧标签到新标签的映射。
5. 修改前先展示方案。只有得到明确同意后才编辑；保持 frontmatter 格式，并列出每篇被改动的笔记。`,
		},
		findSkills: {
			description: "查找可信的 agent skill，并说明如何加入 Piem。",
			content: `帮助用户从开放的 agent-skills 生态中查找技能。本流程基于 Vercel 的 MIT 许可 find-skills 技能，并按 Piem 只能操作 vault 的边界做了调整。

1. 先弄清领域和具体任务。只有常见且专业的重复任务才优先寻找可复用技能。
2. 如果有 web_fetch，检查 skills.sh 和源码仓库；如果没有，明确说明无法实时核验，只给出 skills.sh 地址，不编造结果。
3. 核验安装量、仓库所有者、GitHub 信誉、许可证、近期维护情况、完整 SKILL.md 和公开安全审计。不要只看搜索标题就推荐。
4. 给出简短候选列表，包含技能名、用途、来源、证据、链接和兼容限制。Piem 不能运行 npx，也不能安装到 vault 之外。
5. 只有用户明确要求安装时，才获取并审查完整 SKILL.md，然后写入 Piem/skills/<name>/SKILL.md。不要执行远程代码，不要复制隐藏脚本，覆盖已有 vault skill 前必须确认。`,
		},
	},

	chatStatus: {
		opening: "正在打开对话…",
		tidyingUp: "正在整理较早的消息…",
	},

	// 快捷键字形是键帽而非词语，各语言一律保持原样。
	modelSwitcher: {
		switchModel: "切换模型",
		buttonTitle: "{action} · {model}",
		modelWithProvider: "{model} · {provider}",
		withReasoning: "{model} · 推理：{level}",
		noModels: "还没有配置模型",
		manageModels: "管理模型…",
	},

	sendShortcut: {
		enter: "↵",
		modMac: "⌘↵",
		modOther: "Ctrl+↵",
		buttonTitle: "{action} · {chord}",
	},

	context: {
		nearlyFull: "上下文即将占满",
		filling: "正在填充",
		ok: "正常",
		meterHeuristic: "按消息大小估算，首次回复后更新。",
		meterMeasured: "接近 {percent}% 时自动整理较早的消息。",
		meterNoCompaction: "自动整理已关闭，占满前请手动整理较早的消息。",
		tidyWhileCompacting: "正在整理较早的消息…",
		tidyWhileStreaming: "回复结束后可整理较早的消息",
	},

	contextRow: {
		rowAria: "共享给 Piem 的笔记",
		followActive: "跟随当前笔记",
		openFollowed: "打开 {path}，自动跟随中",
		openPinned: "打开 {path}，已固定",
		pinToChat: "把 {name} 固定到此对话",
		stopFollowing: "停止跟随当前笔记",
		removeFromContext: "从上下文中移除 {name}",
	},

	replyActions: {
		label: "回复操作",
		copy: "复制回复",
		insert: "在光标处插入",
		append: "追加到笔记",
		regenerate: "重新回答",
		couldNotCopy: "无法复制到剪贴板。",
		needOpenNoteToInsert: "打开一个笔记以插入此回复。",
		needOpenNoteToAppend: "打开一个笔记以追加此回复。",
	},

	noteReference: {
		truncated: "所选文本较长，仅引用了其开头部分。",
	},

	session: {
		newChat: "新建对话",
		untitled: "未命名对话",
		searchPlaceholder: "搜索对话",
		searchInstructions: "输入以筛选对话列表。",
		renameChat: "重命名对话",
		deleteChat: "删除对话",
		cancel: "取消",
		save: "保存",
		delete: "删除",
		nameLabel: "名称",
		nameDesc: "留空则回退到开场消息。",
		pickerOpenHint: "打开对话",
		pickerDeleteHint: "删除对话",
		deleteRestorable: "对话记录会移入回收站，之后仍可从那里恢复。",
	},

	traceTool: {
		read: "读取了一条笔记",
		write: "写入了一条笔记",
		edit: "编辑了一条笔记",
		ls: "列出了一个文件夹",
		find: "查找了笔记",
		grep: "搜索了笔记库",
		getActiveNote: "查看了当前笔记",
		noteLinks: "跟随了链接",
		noteMetadata: "读取了笔记属性",
		listTasks: "列出了任务",
		summarizeTasks: "总结了任务",
		moveNote: "重命名或移动了一条笔记",
		trashNote: "把一条笔记移到了回收站",
		failed: "失败",
	},

	settings: {
		tabModels: "模型",
		tabChat: "对话",
		tabSessions: "历史",
		tabSkills: "技能",
		tabGeneral: "通用",
		tabLogs: "日志",

		logLevelHeading: "日志级别",
		logLevelDesc:
			"插件往日志里写多少内容。日常使用“警告”就够；排查问题时调成“调试”，看完再调回去。",

		languageHeading: "语言",
		languageDesc: "界面使用的语言。“自动”会跟随笔记库的语言。",

		statusActiveModel: "当前模型",
		providersHeading: "提供方",
		providersDesc: "请求可以发送到的端点。一个提供方包含基础 URL、请求协议和一把密钥。",
		addProvider: "添加提供方",
		noProviders: "还没有提供方。添加一个，即可将请求发送到你自己的端点或网关。",
		editProvider: "编辑提供方",
		deleteProvider: "删除提供方",
		modelsHeading: "模型",
		modelsDescWithProviders: "你可以选择的模型。每个模型指定一个提供方以及该提供方期望的模型 ID。",
		modelsDescNoProviders: "请先添加提供方——模型需要一个端点来提供服务。",
		addModel: "添加模型",
		noModels: "还没有模型。",
		activeModelHeading: "当前模型",
		activeModelDesc: "所有请求都会从这个模型发出。",
		missingBuiltinModel:
			"此版本不再内置 {provider}/{modelId}，请求将改为发往 {replacement}。若要继续使用，请在下方将其添加为提供方和模型。",
		editModel: "编辑模型",
		deleteModel: "删除模型",
		keySet: "已设置密钥",
		noKey: "无密钥",
		modelCount: "{count} 个模型",
		modelsCount: "{count} 个模型",
		providerMissing: "提供方缺失",
		activeSuffix: " · 当前",
		thinkingLevel: "思考级别",
		thinkingLevelDesc: "请求多少推理。当前模型不支持的级别会被隐藏。",
		showAgentDetails: "显示代理详情",
		showAgentDetailsDesc: "在对话面板中显示 token 数、花费和原始工具参数。",
		sendShortcut: "发送方式",
		sendShortcutDesc: "用哪个键发送消息。无论选哪项，Ctrl+回车 和 ⌘+回车 都能发送。",
		sendShortcutEnter: "回车（Shift+回车 换行）",
		sendShortcutModEnter: "Ctrl+回车 或 ⌘+回车（回车用于换行）",
		sendShortcutMobileNote: "在手机上回车一律换行——软键盘没有 Shift+回车——请用发送按钮。",
		networkHeading: "网络",
		networkHeadingDesc: "请求如何离开笔记库。",
		networkTransport: "网络传输",
		networkTransportDesc:
			"requestUrl 可在各处绕过浏览器限制，但会缓冲响应——token 会一次性出现。fetch 会增量流式返回，但可能被拦截。",
		// 这两项是配置里的字面值（"requestUrl" | "fetch"），保持原样以便和配置、日志对上。
		transportRequestUrl: "requestUrl（缓冲，各处可用）",
		transportFetch: "fetch（流式，可能被拦截）",
		webFetchName: "获取网页",
		webFetchDesc:
			"任务需要网页时，代理可以请求外部 URL。这些请求及其中的数据会离开笔记库和 Obsidian；上方的传输方式决定它们如何发出。",
		whatLeavesVault: "什么会离开笔记库",
		whatLeavesVaultDesc:
			"提示词、工具读取的笔记库内容以及工具结果，会发送给服务于当前模型的提供方。不会发送到任何其他地方。",
		chatLogsInVault:
			"聊天记录是笔记库里的文件，会随你的笔记一起同步和备份。它们包含对话内容，以及回答过程中读取的笔记原文。",
		apiKeysHeading: "API 密钥",
		restrictedKeyHint: "请使用受限、低限额的密钥：笔记库是一个普通文件夹，里面的密钥会随着该文件夹的每次备份和同步一起传播。",
	},

	skills: {
		heading: "技能",
		desc: "代理可以按需加载的指令。它们是笔记库里的文件——像普通笔记一样编辑，下一条消息就会生效。",
		import: "从 URL 导入",
		empty: "还没有技能。从 URL 导入一个，或在 Piem/skills 里建一个包含 SKILL.md 的文件夹。",
		importedFrom: "导入自 {url}",
		handAuthored: "在笔记库中手写。更新请直接修改文件。",
		rootFile: "单篇笔记充当的技能。像普通笔记一样编辑；无法从这里更新或删除。",
		open: "打开",
		update: "检查更新",
		delete: "删除",
		upToDate: "{name} 已经是最新版本。",
		updatedOne: "{name} 已更新：更改了 1 个文件。",
		updatedMany: "{name} 已更新：更改了 {count} 个文件。",
		conflict: "{name} 有本地修改，未覆盖任何内容。冲突的文件：{files}。",
		couldNotUpdate: "无法更新 {name}：{message}",
		couldNotDelete: "无法删除 {name}：{message}",
		userHeading: "用户级技能",
		userDesc: "自动从这台电脑上、笔记库之外的文件夹加载。下面列出了实际读取的文件夹。",
		userEmpty: "这台电脑上没有用户级技能。",
		userDirName: "额外的技能文件夹",
		userDirDesc:
			"除内置文件夹之外，再从这台电脑上的一个文件夹加载技能。请填写完整路径，或以 ~ 开头表示你的主目录。留空则只读取内置文件夹。",
		userDirProblemRelative:
			"请填写完整路径——以 / 或盘符开头，或用 ~ 表示你的主目录。像 'skills' 这样的普通名称不会被读取，因此不会加载任何额外文件夹。",
		userSearchedHeading: "已搜索的文件夹",
		userSearchedDesc:
			"上次加载技能时查找过的位置。你没有创建过的文件夹本来就不存在，这不是故障。你确实创建过的文件夹应当显示它包含多少个技能——如果没有，说明实际读取的路径不是你想要的那个。",
		userSearchedMissing: "此路径上没有文件夹。",
		userSearchedEmpty: "已读取，其中没有技能。",
		userSearchedFound: "已读取，加载了 {skills}。",
		// 检查本身失败了——文件夹既没有确认存在，也没有确认不存在。不并入「没有
		// 文件夹」：权限问题挡住了我们的读取时，说「这里没有文件夹」会把人引去
		// 完全错误的方向。
		userSearchedUnknown: "无法检查该文件夹。",
		userSkillOne: "1 个技能",
		userSkillMany: "{count} 个技能",
	},

	skillImport: {
		title: "导入技能",
		urlName: "技能 URL",
		urlDesc: "GitHub 的文件夹或文件，或任何公开的 .md 页面。",
		urlPlaceholder: "https://github.com/owner/repo/tree/main/skills",
		preview: "预览",
		fetching: "正在获取…",
		importOne: "导入 1 个技能",
		importMany: "导入 {count} 个技能",
		invalidUrl: "这看起来不像技能 URL。请使用 GitHub 文件夹、GitHub 文件或公开的 .md 链接。",
		fetchFailed: "获取失败：{message}",
		installFailed: "导入失败：{message}",
		noneFound: "那里没有找到技能。技能是一个包含 SKILL.md 的文件夹，或一篇带名称和描述的 .md 文件。",
		installed: "已导入 {count} 个。",
	},

	about: {
		version: "版本 {version}",
		sourceName: "源代码",
		sourceDesc: "本插件在 GitHub 上的仓库。",
		sourceLabel: "打开仓库",
		issuesName: "反馈问题",
		issuesDesc: "缺陷与功能建议请提交到问题追踪器。",
		issuesLabel: "打开问题列表",
		licenseName: "许可协议",
		licenseDesc: "本插件的分发条款。",
		licenseLabel: "阅读许可协议",
		sponsorName: "赞助我",
		sponsorDesc: "请我在 Ko-fi 上喝杯咖啡。",
		sponsorLabel: "疯狂星期四 V 我 50",
	},

	compaction: {
		groupLabel: "上下文整理",
		groupHint: "高级选项。在上下文占满之前，Piem 已经会自动总结较早的消息。",
		enabledName: "自动总结",
		enabledDesc: "上下文接近占满时，用一段总结替换较早的消息。关闭后将保留每一条消息，改为手动整理。",
		reserveName: "整理前预留的余量",
		reserveDesc: "为撰写总结而预留的 token。调高会更早整理，调低则先用掉更多窗口。默认 {default}。",
		keepName: "保留的近期消息",
		keepDesc: "总结时原样保留的近期对话 token 数。调高可原文保留更多往来内容。默认 {default}。",
		tokenFloor: "低于 {min} token 的值会被提升到该下限。",
	},

	sessions: {
		retentionName: "保留的对话数",
		retentionDesc: "创建新对话时，较早的对话会移到回收站，之后仍可从那里恢复。设为 0 则保留全部对话。",
		retentionFloor: "低于 {min} 的值会被提升到该下限。",
		retentionUnlimited: "保留全部对话。{stored}",
		retentionWillTrash: "{stored} 下一次新建对话会把最早的 {chats}移到回收站。",
		retentionSafe: "{stored} 达到上限前不会移入回收站。",
		storedNone: "尚未存储任何对话。",
		storedOne: "已存储 1 个对话。",
		storedMany: "已存储 {count} 个对话。",
		chatOne: "1 个对话",
		chatMany: "{count} 个对话",
		dirName: "对话文件夹",
		dirDesc: "笔记库内用于写入聊天记录的文件夹。其中的记录会随你的笔记一起同步和备份，Piem 自己的搜索工具也能读到它们。",
		dirRestartHint: "将在你下次新建对话时生效。",
		dirUnchanged: "新对话将写入 {dir}。",
		dirChanged: "新对话将写入 {next}。不会搬动任何文件：{current} 中的对话仍在磁盘上，但会从对话列表中消失，直到你把文件移过去。",
		dirProblemEmpty: "请填写笔记库内的一个文件夹。",
		dirProblemAbsolute: "请使用笔记库内的文件夹，而不是电脑上的路径。",
		dirProblemEscape: "文件夹不能用 '..' 跳出笔记库。",
		dirProblemUnusable: "这不是笔记库能容纳的文件夹。",
		legacyOne: "有 1 个来自旧版本的对话仍在 {dir}。把其中的 .jsonl 文件移到上面的文件夹，即可让它重新出现在对话列表中。",
		legacyMany: "有 {count} 个来自旧版本的对话仍在 {dir}。把其中的 .jsonl 文件移到上面的文件夹，即可让它们重新出现在对话列表中。",
	},

	connectionTest: {
		noKey: "此提供方还没有 API 密钥。",
		noModelId: "此模型还没有模型 ID。",
		requestFailed: "请求失败。",
		requestAborted: "请求已中止。",
		reached: "已连通 {target}{served}。",
		servedSuffix: " — 实际服务模型 {model}",
		unknownError: "未知错误",
		probedWith: "（探测所用模型：{model}）",
		listingNoModels: "已连通 {target}，但它未列出任何模型。",
		listingOneModel: "已连通 {target} — 它列出 1 个模型。",
		listingModels: "已连通 {target} — 它列出 {count} 个模型。",
		listingNeedsKey: "{target} 需要 API 密钥（{status}）。{relayed}",
		listingRejectedKey: "{target} 拒绝了该 API 密钥（{status}）。{relayed}",
		listingUnsupported: "已连通 {target}，但它不提供模型列表，因此无法验证密钥。请在此提供方下添加一个模型以测试真实请求。",
		listingStatus: "{target} 返回 {status}。{relayed}",
	},

	target: {
		customEndpoint: "自定义端点（{modelId}）",
		needsKeyToSend: "{target} 需要先在插件设置中填写 API 密钥，才能发送提示词。",
		needsKeyToCompact: "{target} 需要先在插件设置中填写 API 密钥，才能整理上下文。",
	},

	confirmDelete: {
		title: "删除{subject}？",
		cancel: "取消",
		delete: "删除",
		providerSubject: "提供方“{name}”",
		modelSubject: "模型“{name}”",
		skillSubject: "技能“{name}”",
	},

	deletion: {
		providerKeyRemoved: "基础 URL 和 API 密钥会从此笔记库的配置中移除。",
		providerOneModel: "由它提供服务的模型也会被移除：{names}。",
		providerManyModels: "由它提供服务的 {count} 个模型也会被移除：{names}。",
		modelProviderStays: "提供方及其密钥会保留，其他模型仍可正常使用。",
		modelWasActive: "它是当前模型，移除后会自动选择另一个。",
		skillFiles: "技能的文件会移入回收站，并不再对代理可用。",
	},

	test: {
		button: "测试",
		running: "测试中…",
		pending: "正在发送测试请求…",
	},

	secretStorage: {
		encrypted: "存储在此笔记库的插件配置中，并使用操作系统的钥匙串加密。",
		plaintext: "此设备没有可用的操作系统钥匙串，因此密钥以明文形式存储在此笔记库的插件配置中。",
		keyField: "仅发送给 {target}。{storage} 请使用受限、低限额的密钥。",
		providerTarget: "此提供方的基础 URL",
	},

	providerModal: {
		addTitle: "添加提供方",
		editTitle: "编辑提供方",
		name: "名称",
		nameDesc: "在列出该提供方的地方显示。可选——留空时使用基础 URL。",
		namePlaceholder: "我的网关",
		baseUrl: "基础 URL",
		baseUrlDesc: "API 的根地址，例如 https://api.example.com/v1",
		baseUrlPlaceholder: "https://api.example.com/v1",
		protocol: "协议",
		protocolDesc: "该端点使用的请求格式。第一个选项是网关和自托管服务器实现最广泛的一种。",
		apiKey: "API 密钥",
		apiKeyPlaceholder: "输入 API 密钥",
		connection: "连接",
		connectionDesc: "检查 URL、协议和密钥。该提供方下已有模型时用其中一个测试，否则询问端点它提供哪些模型。",
		cancel: "取消",
		add: "添加",
		save: "保存",
		baseUrlRequired: "基础 URL 是必填项。",
		baseUrlInvalid: "该基础 URL 不是有效的 URL。请包含协议，例如 https://api.example.com/v1",
		baseUrlScheme: "基础 URL 必须使用 http 或 https。",
		couldNotSave: "无法保存提供方：{message}",
	},

	modelModal: {
		addTitle: "添加模型",
		editTitle: "编辑模型",
		provider: "提供方",
		providerDesc: "哪个已配置的端点为此模型提供服务。",
		modelId: "模型 ID",
		modelIdDesc: "原样发送到服务器。开始输入可搜索已知模型 ID，或输入你自己的。",
		modelIdPlaceholder: "gpt-4o-mini",
		displayName: "显示名称",
		displayNameDesc: "在模型选择器中显示。留空则使用模型 ID。",
		displayNamePlaceholder: "我的模型",
		contextWindow: "上下文窗口",
		contextWindowDesc: "该模型接受的 token 数。整理会据此规划；留空则使用默认值。",
		contextWindowPlaceholder: "128000",
		supportsThinking: "支持思考",
		supportsThinkingDesc: "仅当该模型接受推理参数时启用。严格的服务器会直接拒绝它们。",
		connection: "连接",
		connectionDesc: "发送一个最小请求，以确认提供方、密钥和模型 ID 能协同工作。",
		cancel: "取消",
		add: "添加",
		save: "保存",
		chooseProvider: "请选择一个提供方。",
		providerMissing: "该提供方已不存在。",
		modelIdRequired: "模型 ID 是必填项。",
		added: "模型已添加。",
		saved: "模型已保存。",
		couldNotSave: "无法保存模型：{message}",
	},

	language: {
		auto: "自动",
		// Autonyms are shown from each language's own table and must not be
		// translated — the picker reads `language.en` from this table.
		en: "English",
		"zh-cn": "简体中文",
	},

	// 这些是各家 API 的产品名，保持原文以便用户对照自己端点的文档。
	wireProtocol: {
		openaiChat: "OpenAI Chat Completions",
		openaiResponses: "OpenAI Responses",
		anthropicMessages: "Anthropic Messages",
	},

	logView: {
		title: "Piem 日志",
		filter: {
			all: "全部级别",
			off: "关闭",
			debug: "调试",
			info: "信息",
			warn: "警告",
			error: "错误",
		},
		copy: "复制",
		clear: "清空",
		openFile: "打开日志文件",
		empty: "该级别下暂无日志。",
		dropped: "已有 {count} 条更早的记录被丢弃，以保证缓冲区不超限。",
		fileHint: "落盘日志：{path}",
	},
};

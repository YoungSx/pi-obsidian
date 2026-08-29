# Issue #45 · 用 Agent.transformContext 注入活跃笔记上下文（补全内容层）

> 2026-08-29 · 在 PR #50 的路径注入之上，把活跃笔记的**正文**也送进每轮请求。

## 背景

PR #50 已经接好 pi 的 `transformContext` 缝合点，但块里只有路径——模型知道「你在看哪个笔记」，却还是得先花一轮 `read` 才能干活。#45 的方案要的是内容：预算内全文，超了就截前 N 行并报总数，外加 mtime 告知新鲜度。

## 实现

- `contextInjection.ts`：`InjectedNote` 类型 + `MAX_ACTIVE_NOTE_CHARS = 20_000`（约 5k token）。截断按**行边界**切（切在词中间对模型读起来像损坏文件）；整条单行超预算才退到字符切片。正文包在 `<note-content>` 里，`</context>` 提前闭合的爆炸半径被限制在自己的标签内。
- `ObsidianAgentService.readActiveNote`：走 Obsidian 原生 `vault.getAbstractFileByPath` + `vault.cachedRead`（编辑器保温的缓存，不阻塞磁盘）。`instanceof TFile` + `.md` 守卫；读取失败降级为纯路径块，绝不炸掉整个请求。
- mtime 用文件 stat 渲染成固定 ISO——笔记不变则字节不变，缓存不破。

## 关键决策

1. **只有活跃笔记带正文，pin 依然只有路径**。pin 是用户点名要的、离模型只差一次 `read`；8 个 pin 各带全文就不是预算是泄漏。上限显式：最坏情况一份文档。
2. **每轮重读**而不是冻结快照。tool loop 里模型刚 `edit` 完笔记，下一轮请求看到的就是新的——这正是注入的意义。refs 照旧用 `activeRunContext` 冻结（切笔记不能中途改写用户的请求），内容和路径永远配对。
3. **path 匹配守卫**：快照的 path 必须等于 active ref 的 path 才渲染正文，防错配。

## 验证

- `contextInjection.test.ts` +9：全文/mtime、pin 不带正文、空笔记、行边界截断（按不变量断言，不手算切点）、单行字符切片、读取失败降级、path 错配忽略、字节稳定性。
- `ObsidianAgentService.test.ts` +3：请求级内容注入、超预算封顶、vault 里没有文件时退回纯路径块。
- `npm run verify` 全绿：build + check:bundle + check:copy + 987 tests + lint。

「不做什么」沿用 issue 约定：不写进 session log（transformContext 的产物 per-request）、不注入整个 vault、不加设置项。

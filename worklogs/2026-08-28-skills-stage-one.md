# Issue #46 · Skills 阶段一：从 vault 加载并拼进 system prompt

> 2026-08-28 · 接入 pi-agent-core 的 Skills 系统，让用户用 SKILL.md 打包可复用指令。

## 范围

issue #46 原分三阶段，本 PR 只做**阶段一**：

- ✅ 初始化时 `loadSkills` 从 vault 加载 skills
- ✅ 诊断信息展示给用户（走 notice 通道）
- ✅ skills 拼进 system prompt
- ⏳ 阶段二（`/` 触发的 slash command 调用入口）留作后续
- ⏳ 阶段三（内置 /summarize、/link-graph、/tag-organize）留作后续

「不做什么」沿用 issue 约定：skills 不持久化进 session（避免 #32 膨胀），每轮从 vault 动态加载；skills 不改变 agent 行为核心。

## 关键决策：`.piem/skills` → `Piem/skills`

issue 技术方案推荐 `.piem/skills`，实现时偏离，改用 `Piem/skills`。理由：

1. **Obsidian 不索引点目录**。`getAbstractFileByPath` / `getFolderByPath` 对点目录返回 null，pi 的 `loadSkills` 会静默返回空集——skills 永远加载不出来。
2. **用户在 Obsidian 里看不见也改不了点目录**。skills 是用户自己写的指令，落在看不见的地方等于不可用。
3. **先例**：`sessionDir.ts` 已经把聊天日志从插件内部挪到可见的 `Piem/chats`，论证过同样的用户所有权。skills 是同类用户内容。

## 接线

`src/agent/skillLoader.ts`（新建）：
- `loadVaultSkills(env, dir = "Piem/skills")` → 包 pi 的 `loadSkills(env, "/Piem/skills")`
- `formatSkillDiagnostics` → 一行一条 warning，喂 notice banner
- `composeSystemPrompt(base, skills)` → 唯一拼接点；空 skills 透传 base，字节不变

`src/agent/ObsidianAgentService.ts`：
- `reloadSkills()`：建 `VaultExecutionEnv`、加载、存 `this.skills`、诊断走 `setNotice`、给 live agent 重写 `state.systemPrompt`
- 挂在 `initializeAgent()` 开头 + `refreshConfiguration()` 里 tools 赋值之后
- `replaceAgent` 的 `initialState.systemPrompt` 用 `composeSystemPrompt(BASE, this.skills)`——reloadSkills 先于本方法跑，数组已填

**修了一个真 bug**：`sendPrompt` 原本在 `refreshConfiguration()` **之后**清 `noticeMessage`，把 `reloadSkills` 刚设的诊断擦掉。改为先清后 refresh，诊断才活得到用户眼里。

这个 bug 在 rebase 到多模态分支时**以新形式复活了一次**：那边为「missing-embed 通知要活过 run」在 `refreshConfiguration()` 之后又加了一次清空，两处叠起来诊断照样被擦。两处清空本是同一个意图（跑之前清掉过期横幅），合并成一处放在 refresh 之前即可 —— 两个需求指向同一个位置。回归测试是唯一发现它的东西，rebase 后的全量跑直接红了。

## 测试

- `skillLoader.test.ts`（8 例）：默认目录不以 `.` 开头、加载 SKILL.md、缺失目录=空、坏 name 仍加载且 warning、诊断拼接、compose 透传/追加
- `ObsidianAgentService.test.ts` 加 `vault skills` describe（4 例）：
  - skills 拼进模型实际收到的 system prompt（经 streamFn 捕获）
  - skill-less vault 的 prompt 与 base 常量逐字节相等
  - 诊断走 notice 且 sendPrompt 顺序不会擦掉它（回归守护）
  - 运行中 vault 新增 skill，下一条消息即生效（无需重载插件）

全套 830 pass / lint 净 / build 净。

## 踩过的坑

- `loadSkills` 的 `addIgnoreRules` 把 `joinPath` 失败当作 `file_info_failed` 诊断。fakeEnv 的 joinPath 早期实现去查文件系统，`.gitignore` 不存在就返回 not_found，平白多出 9 条假 warning。修复：joinPath 永远返回 ok（纯字符串拼接，和真实 `VaultExecutionEnv.joinPath` 一致）。
- pi 的 `validateName` 只推 warning 不拦截——坏 name 的 skill 仍加载，断言要按「两个都在」写。
- service 集成测试的 vault stub 必须 提供 `getAbstractFileByPath`：`VaultExecutionEnv.requireFile` 走的是它，不是 `getFileByPath`。漏了的话 skills 能 list 出来但读不到内容。

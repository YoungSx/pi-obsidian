# Issue #80 · Skill 管理器：URL 导入、版本更新、用户级继承 + 设置面板 6→5

> 2026-08-29 · PR #89。技能体系阶段四收口：从 GitHub 等导入、可从来源更新、继承系统用户级技能，顺带把设置面板冗余 Tab 整合掉。

## 背景

前三阶段已交付：vault 技能加载与三层合并、内置技能、`/skill:` 调用、`SKILL.md` 拼接（#46）。#80 剩四件事：URL 导入、版本管理、用户级继承、以及一个管理界面——界面顺手把面板上叠出来的六个 Tab 瘦身。

## 实现

- `skillImport.ts`：URL → `FetchedSource`（GitHub 文件夹/文件、公开 .md 皆可解析）；`SIDECAR_FILENAME = "piem-source.json"` 记来源；`UpdatePlan` 三态 up-to-date / changed / conflict（entries 带 action: update|add|remove|conflict）。拉取一律走 `createFetchForTransport`——用户选什么传输，GitHub 请求就走什么传输。
- `skillManager.ts`：把导入管线和 vault 写入合成一个门面——`list`（带 provenance）、`update`（冲突安全：有本地修改就整体不动）、`remove`（走 `trashOrDelete`，可恢复）。
- `ImportSkillModal.ts`：**两步**导入——先预览再落盘，按钮从「预览」变「导入 N 个」。抓取和写库分开是关键：一步到位的按钮没法区分「URL 打错了」和「装好了」。
- `SettingsPanel.ts`：新 Skills tab；每行 Open / Update / Delete；用户级技能只读展示；update 三态用 Notice（行会被重渲染，行内状态活不过下一帧）。
- 接线：`ObsidianAgentService.refreshSkills`——`refreshConfiguration` 的窄半边。技能是 vault 内容不是设置，导入删除不过 `saveSettings`，所以需要独立通道告诉运行中的 agent 系统 prompt 变了。

## 关键决策

1. **不加用户级继承开关**。`~/.pi/agent/skills` 的意义就是跨项目跟随用户，继承无条件；vault 同名技能仍然胜出。中途曾落过一个 `skillsInheritUser` schema 开关，收口时发现它没有任何 UI 入口——一个只有半个门的开关比没有开关更糟，拆掉，继承改为无条件，加载器挪到可注入选项后面保测试封闭性。
2. **删除文案说「移入回收站」**，因为实现就是 `FileManager.trashFile`（尊重用户偏好、可恢复）。文案跟着语义走。
3. **Tab 6→5**：Network 折进 Models 底部 collapsible（transport 和 web_fetch 都是「请求怎么离开笔记库」这一件事）；Language + About 合并成 General（language 是唯一的控件行，其余是散文）。每 Tab 一个主题，而不是每个功能一个 Tab。
4. **Bundle 上限重锚到 1.75 MiB**。skills 功能把原定 180 KiB 的余量吃光到 ~1.67 MiB——check-bundle 的哲学是「锚定测量而非口味」，门随测量走，而不是删代码凑数。全量 provider catalog 回归（~360 KiB 级别）仍然会撞线被拦。
5. **导入弹窗遵循 ProviderModal 模式**：draft 本地状态防键盘重渲染、成功才 close、失败 Notice。

## 验证

- `skillManager.test.ts` 9 例：来源解析、sidecar 往返、三态更新（含冲突保护）、回收站删除。
- `npm run verify` 全绿：1028 tests、bundle 1.67/1.75 MiB、check:copy、lint。
- 基于 master 最新 rebase（web_fetch 开关退役 #52 与 Network 组撞车一处：采纳 master 语义，行放进折叠组）。

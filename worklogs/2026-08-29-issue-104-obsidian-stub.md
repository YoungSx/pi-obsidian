# Issue #104 · 共享 obsidian 桩补齐：getAllTags / debounce / 模糊搜索

> 2026-08-29。#97 #99 #101 三个 issue 都要让生产代码开始运行时使用此前没用过的 `obsidian` 导出，而 `obsidian` 包只有类型没有 JS——先把共享桩补齐，再放三个 issue 并行。

## 背景

三个 issue 要碰同一片桩表面，其中 `debounce` 在 `pluginLoader.ts` 的现有桩是 `fn => fn`——没有 `cancel()` 也没有 `run()`，`DraftStore.flush()` 一调 `.run()` 就会 TypeError。详见 [#104](https://github.com/YoungSx/piem/issues/104)。

## 实现

- `obsidianStub.ts` 新增四个导出（纯函数，与 `mock` 机制解耦），并加进 `obsidianStub` 字面量：
  - `getAllTags`：严格按文档语义——"Combines all tags from frontmatter and note content into a single array"。正文标签原样（`TagCache.tag` 带 `#`）、frontmatter 标签原样（YAML 里不带 `#`）、去重、nullish cache 返回 `null`。**刻意不做前缀归一化**（见下）。
  - `debounce`：实现完整 `Debouncer` 契约——`run()` 立即执行待处理调用、`cancel()` 取消、`resetTimer` 二态（false=原定时不变但取最新参数；true=每次重置计时器）。
  - `prepareFuzzySearch`：大小写不敏感的有序子序列匹配，相邻命中合并为一个 range；评分是确定性替身（更短文本、更少 range 得分更高），注释明确声明**不是** Obsidian 真实评分，测试不得断言绝对分数。
  - `sortSearchResults`：原地按分数降序。
- `pluginLoader.ts` 复用同一批实现。两套桩表面保持分离（这套服务整包 smoke test，不走 `mock.module`），但语义不许漂移。
- `DraftStore.test.ts` 提前接上 `installObsidianStub()`：今天 `obsidian` 还是纯类型导入，但 #99 一切换成运行时导入就需要它——现在装好，让导入切换不可能悄悄弄坏测试。
- 新增 `obsidianStub.test.ts`（19 例）给桩自己立规矩：**桩错了，全世界的测试照样全绿**，所以桩的语义必须有自己的测活探针。

## 关键决策

1. **`getAllTags` 不做 `#` 归一化，留一个 ⚠ 注释**。真实 Obsidian 对前缀做了什么，官方文档只字未提；网上说法互相矛盾（有插件 mock 给 frontmatter 加 `#`，有插件消费端自己 strip）。#97 存在的全部意义就是替换一个可能 diverge 的手工合并——如果桩照着旧实现抄，等于把想消除的行为差异原样搬进桩里还盖上"全绿"。所以桩只做文档明确说的"合并"，归一化留给 #97 的真实行为验证（在 Obsidian 里手动验一次）后回填。
2. **防抖执行时读取最新参数**。第一版超时闭包捕获了首次调用的 args——被自己的测试当场抓住：`resetTimer=false` 语义是"定时不变、参数取最新"，捕获旧参数等于把这层语义做反了。测试先行在这里真起了作用。
3. **两套桩共享受实现而非复制**。`pluginLoader` 的字面量从 `obsidianStub.ts` import 四个纯函数，加注释说明为什么不干脆合成一套（服务对象不同：一个给 `mock.module`，一个给 bundle smoke test）。

## 验证

- `obsidianStub.test.ts` 19 例：getAllTags 两来源合并/去重/原样前缀/标量拆分/数组过滤/nullish；fuzzy 子序列（`org`→`tag-organize`、`lg` 不匹配）/大小写/range 合并/空 query；debounce 延后+最新参数/run 立即执行且返回值透传/cancel/resetTimer 二态/链式返回 this。
- `npm run verify` 全绿：1217 tests、check:bundle、check:copy、lint。
- 基于 origin/master 最新（4843d7b）开枝 `test/obsidian-stub-104`。

## 遗留

- `getAllTags` 的前缀归一化、`prepareFuzzySearch` 的真实评分，都需要在 Obsidian 里手动各验一次——桩不能替代这一步。验完更新或删除 `getAllTags` 头上的 ⚠ 注释。
- #97/#99/#101 现在可以并行开工；#99 动 `DraftStore.ts` 时本文件的桩已就位。

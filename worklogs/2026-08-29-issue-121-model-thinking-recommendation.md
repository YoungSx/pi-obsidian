# Issue #121 · 模型表单按内置目录推荐 thinking 设置

> 2026-08-29 · 添加模型时智能探测 thinking 支持并给出推荐设置。

## 背景

模型表单里「支持思考」的开关一直有（`ModelConfig.reasoning`，决定 pi-ai 里 `Model.reasoning`，进而决定 `getSupportedThinkingLevelOptions` 只给 `off` 还是给整档思考级别），但用户得自己猜：id 是手填的，目录认不认识、支不支持，界面上一个字都不说。#121 要的是「添加的时候智能探测并给出推荐设置」。

## 实现

- `ModelModal.ts` 新增纯函数 `findThinkingSupportHint`：按 id 查内置目录（与建议列表同一份数据源），返回 `{ supports, source }`。先精确匹配；网关常见的命名空间 id（OpenRouter 风格 `anthropic/claude-…`）用最后一段路径兜底，出处标成认得这一段的目录。
- 表单侧 `refreshThinkingRecommendation`：提示行永远跟着 id 走（是报告，不等人批准）；开关值只在用户没亲手动过时跟着推荐走——`reasoningTouched` 一旦置位就不再自动改，推荐被覆盖过的推荐不是推荐。编辑模式打开时只报告不覆盖已存的值。
- 提示行复用 `.piem-settings-effect`（retention 行同款可重写小字），空串即隐藏，零新 CSS。
- i18n en/zhCN 各两条：`thinkingHintSupported` / `thinkingHintUnsupported`，带 `{source}` 出处。

## 关键决策

1. **探测用目录数据，不发活体请求**。listing 响应不带能力位；唯一活体探测法是发一个真 thinking 请求读服务器的报错——按 provider 各说各话、烧 token、错得比快照多。所以探测离线，开关仍可改，兜住快照过时的网关。沿用 #41 以来的探针纪律：结构上选得起的探针才发。
2. **推荐可被一次手动翻转永久否决**，而不是每次改 id 都重新覆盖。用户比快照懂自己的网关。
3. **编辑模式打开不覆盖存量值**：存的值是上次的选择，报告即可；改了 id 才视为新问题，重新应用推荐。

## 验证

- 新增 `thinkingHint.test.ts` ×6：精确匹配、推荐 off、大小写、命名空间兜底（出处归认得尾段的目录）、未知 id 返 undefined、空白 id 返 undefined。全部读真实快照断言，不打 fixture。
- `npm run verify` 全绿：build + check:bundle (1.41/1.75 MiB) + check:copy + 1347 tests + lint。

「不做什么」：不加活体探测、不改 schema（`reasoning` 字段原样）、模型列表行不展示 thinking 态（#121 只点了表单）。

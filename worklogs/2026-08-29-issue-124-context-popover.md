# Issue #124 · 上下文占用 popover：蒸馏与打磨

> 2026-08-29。用 impeccable 的 distill + polish 思路审计 ContextGauge 的 popover，做一轮外科手术式的优化，不引入新仪器。详见 [#124](https://github.com/YoungSx/piem/issues/124)。

## 审计结论（改了什么、为什么）

1. **对比度违例（唯一的功能性缺陷）**：`.piem-chat__context-spend` 用 `--text-faint` 画 12px 文字——这正是本样式表自己在两处（顶部字号声明、context chips 注释）明文禁止的组合：faint 在 meta 档跌出 4.5:1，faint 只给图标用。改成 `--text-muted`。
2. **字号脱离阶梯**：popover 的数字行和状态行都靠继承（≈16px body），既不读自三个 token 之一（违反「每个尺寸必须读自 token」的承诺），又让读数和它的判定排版平权。现在：数字行 `--font-ui-medium`（read 档）、状态行 `--font-ui-small`（ui 档），加上原有的 note/spend `--font-ui-smaller`（meta 档），popover 内部正好是一条 15/13/12 的完整阶梯。
3. **文案蒸馏**：`meterMeasured` / `meterNoCompaction` 开头的「提供方报告的上下文占用 / Context use reported by the provider」从句砍掉——有没有波浪号已经说了这件事，而且在 11–16rem 的盒子里一个从句就是一整行。noCompaction 从「请使用「整理较早的消息」命令」改成直说动作「手动整理较早的消息」：整理按钮就在同一 popover 下一行，指名「命令」反而绕远。中文 heuristic 文案顺手收紧（「根据…；…后」→「按…，…后」）。
4. **aria 接线补全**：ring 按钮补 `aria-controls` 指向 popover `id`（`useId` 铸造——没有别的东西保证整个 workspace 只挂一个面板，稳定字面量会在两个面板并存时相撞）。

## 刻意不做

- **入场动画不加**。本样式表的两张浮面（command menu 和这个 popover）都是瞬时开合，唯一的动画全是状态脉冲（compaction/typing/skeleton/spin）。只给一张浮面加淡入是一次性的模式漂移；要加就得两张一起加，那是另一个议题。
- **不加阈值刻度条**。ring 刻意放弃了精度换取一眼可读，popover 里的阈值用文字陈述已经够用——为一个低频查阅的数值加一件新仪器是反向蒸馏。
- **五元素结构不动**。数值、判定、注脚、花费（门控）、动作——每个都挣到了自己的位置。

## 验证

- `headerCopy.test.ts` 同步：noCompaction 断言从 `toContain("Tidy up earlier messages")` 改为小写的 `toContain("tidy up earlier messages")`（新文案把命令名降格为动作短语），并加注释记录这个降格是故意的。
- 其余断言全部无损通过：`"Compaction starts near 98%"`、`"Automatic tidying is off"`、zh `"估算"`、`not.toContain("98%")`。
- `bun test` 1341/1341 全绿，`npm run lint` 干净。
- 对照实验：`ContextGauge.test.tsx` 里「dismisses a pressed popover on a press outside it」在干净工作树上同样会挂（90s+ 超时、单独跑即过）——既有的时序脆弱用例，与本次改动无关，留待单独修。

## 遗留

- popover 的实际观感（新阶梯在两种主题、mobile 的 reader 字号缩放下的表现）需要在 Obsidian 里手动验一次；静态审计替代不了这一步。
- 那个 flaky 用例值得单独开 issue。

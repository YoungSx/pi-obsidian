# 设置页整体重构 · 实施计划

> 2026-08-27 · 基于 impeccable critique（11/40，Critical 区间）+ 协议调研 + 设置项盘点。

## 0. 事实基础（都已验证，不是猜的）

| 事实 | 出处 |
|---|---|
| Anthropic Messages / OpenAI Responses 的完整实现**已在 bundle 里** | `main.js` 含 `anthropic-beta`×87、`x-api-key`×7、`previous_response_id`×4；esbuild 已把 pi-ai 的 lazy 动态 import 全部内联 |
| 运行时协议分派只认 `Model.api` 字段 | `streamFn.ts` → `models.streamSimple(model, …)`，pi-ai 按 `model.api` 派发 |
| 写死点只有两处 | `customEndpoint.ts:129`（`api: "openai-completions"`）、`streamFn.ts:77`（`openAICompletionsApi()`） |
| 面板吃字 bug | `settings.ts:199-203` 激活翻转时 `display()` → `containerEl.empty()`，正在输入的控件被销毁 |
| 加密承诺自相矛盾 | `settings.ts:171` 无条件承诺加密 vs `:353` 条件降级提示；自定义端点 key 行 `:228` 永远承诺加密 |
| 39 provider / 1312 模型全打包 | `main.js` 1.9MB；openrouter 一家 351 个模型进下拉框 |
| `setClass` 三个类名在 styles.css 零规则 | `pi-custom-endpoint` / `pi-provider-active` / `pi-model-inactive` 是死钩子 |
| 逐字符落盘 | 每次 `onChange` → `saveSettings()` → 写盘 + `refreshConfiguration()` |
| **`createProvider` 原生支持 api map 按 `model.api` 派发** | `models.js:443-453`：`api` 传对象即按协议分派，无匹配则报 stream error。**不需要自己写 switch** |
| **鉴权头由各协议官方 SDK 自己设置** | anthropic-messages 用 `@anthropic-ai/sdk` 的 `apiKey`/`authToken`（自动发 `x-api-key` + `anthropic-version`）；openai-* 用 `openai` SDK。**不需要 `authMethod` 字段** |
| **三个 compat 接口所有字段可选，pi-ai 从 baseUrl 自动探测** | `types.d.ts:458/517/536`。仅 openai-completions 需保留保守覆盖 |
| `uuidv7()` 由 pi-ai 导出 | `utils/uuid.d.ts`，不需引入 uuid 依赖 |

## 1. 数据结构：Provider 与模型解绑（核心）

### 1.1 新 settings schema

```ts
/** 协议类型。三选一，运行时已全部就绪。 */
export type WireProtocol = "openai-completions" | "openai-responses" | "anthropic-messages";

/** Provider = 只管连接与鉴权，不含模型。 */
export interface ProviderConfig {
	id: string;            // 稳定 id（用户自定义时生成 uuid；内置 provider 用其 slug）
	name: string;          // 展示名，如 "DeepSeek"
	baseUrl: string;
	protocol: WireProtocol;
	apiKey: string;        // 沿用现有 secretStore 编码（鉴权头由各协议 SDK 自己发，无需 authMethod）
}

/** 模型 = 业务实体，挂在一个 provider 下（数据上一对多）。 */
export interface ModelConfig {
	id: string;            // uuid（稳定引用，重命名不破坏会话）
	providerId: string;    // → ProviderConfig.id
	modelApiId: string;    // 真实发到服务端的模型 ID，如 "deepseek-v4-pro"
	displayName: string;   // 界面展示名，如 "DeepSeek V4 Pro"
	contextWindow?: number;
	reasoning: boolean;
}

export interface PiObsidianSettings {
	activeModelId?: string;          // 当前使用哪个 ModelConfig（替代 provider+modelId 二元组）
	providers: ProviderConfig[];     // 自定义 provider 列表
	models: ModelConfig[];
	thinkingLevel: ModelThinkingLevel;
	networkTransport: NetworkTransport;
	// ↓ 迁移期保留，迁移完成后删除
	providerApiKeys?: Record<string, string>;
	customEndpoint?: CustomEndpointConfig;
}
```

要点：

- **一对多在数据层天然成立**（`ModelConfig.providerId` 允许多个模型指向同一 provider），UI 先只做一对一选择——添加模型时下拉选 provider，满足你说的"先简单点"。fallback/forward 后续只是让"当前模型"变成有序列表，不需要再动 schema。
- `builtin` provider 不进 `providers[]`，沿用 pi-ai catalog（内置项走单独分支，见 §3）。
- `reasoning` 保留为模型级开关，替代现在 `buildCustomEndpointModel` 写死 `reasoning: false` 的做法。

### 1.2 构造 pi-ai Model

`buildCustomEndpointModel` 泛化为 `buildModelConfigModel(model, provider)`：`api` 字段直接写 `provider.protocol`，鉴权无需处理（SDK 自己发头）。compat 是条件类型（pi-ai `types.d.ts:715`），三协议形状不同，按 protocol 分支返回——只有 openai-completions 需要保守覆盖（`max_tokens` / 关 `store` / 关 developer role），另两个留空让 pi-ai 自动探测。

`streamFn.ts` 的 `createCustomEndpointProvider` 同理：`api` 字段从 map 派发（`openAICompletionsApi()` / `openAIResponsesApi()` / `anthropicMessagesApi()`，三个 lazy 入口 pi-ai 都有）。

### 1.3 迁移（一次性、单向）

`normalizeSettings` 里做：

1. 旧 `customEndpoint` 非空 → 生成一个 `ProviderConfig`（protocol 默认 `openai-completions`）+ 一个 `ModelConfig`，`activeModelId` 指向它。
2. 旧 `provider+modelId` 且来自内置 catalog → 记到 `legacyProviderId`，内置分支继续可用。
3. `providerApiKeys` 原样保留（内置 provider 仍按 slug 查 key）。
4. 迁移后字段不清除（防降级丢配置），下一版再删。

## 2. 协议支持：三个一起做，不开低优先级 issue

运行时代价为零（§0 第一行），成本全在类型层和两处写死。工作量归入 §1 一起交付：

- `WireProtocol` 枚举 + 一个 api 实例 map，**直接交给 `createProvider({ api: map })`**——pi-ai 内部按 `model.api` 派发（`models.js:443-453`），我们不写 switch。
- 鉴权：零工作量。三个协议各自的官方 SDK（`@anthropic-ai/sdk` / `openai`）在 `createClient` 里自己设置 `x-api-key` + `anthropic-version` 或 `Authorization`。
- URL 拼接与 compat 探测：pi-ai 已处理，只要不传错 compat 就行。
- **测试按钮**直接受益：三个协议各拼一个最小请求（如 `max_tokens: 1`），成功即亮绿。

## 3. Provider/模型列表 UI

**分层 + 分割线，自定义优先：**

```
┌─ 自定义 Provider（你的数据，永远置顶）─┐
  DeepSeek (my-deepseek)      [测试]
  添加 Provider…
├────────── 内置 Provider ──────────┤
  Anthropic / OpenAI / DeepSeek / … 39 个（可搜索，见下）
└──────────────────────────────┘
```

- 内置 39 个**用 Obsidian `AbstractInputSuggest` 搜索式输入**而不是 `<select>`——351 个模型的下拉是滚动地狱，suggest 框是标准解法（已确认 obsidian.d.ts 有该 API）。
- 添加模型：先选 provider（同 suggest），再填 `modelApiId`（suggest 预填该 provider catalog 的 id，可自由改）+ `displayName`。
- 每个 provider 行一个 **[测试]** 按钮；模型行同理。结果就地显示（成功/失败+原因），落 P0-3 的坑。
- 每行右侧菜单：编辑 / 删除 / 复制。删除 provider 时若仍有模型挂靠，就地警告并阻止。
- **订阅制/合作商扩展位**：`ProviderConfig` 预留 `source: "user" | "partner" | "subscription"` 字段（现在只写 `user`，UI 不渲染非 user 项的编辑入口），届时不用再动 schema。

## 4. 设置页整体重构：Tab 化

```
[ 模型 ]  [ 聊天 ]  [ 网络 ]  [ 关于 ]
```

- **模型**（主 Tab，默认打开）：provider 列表 + 模型列表 + 活跃模型选择 + 测试。最常用的 BYOK 配置放第一。
- **聊天**：thinking level（文案统一叫 "Thinking level"，与聊天头部对齐——修 P1-4 的一致性问题）、后续对话类设置。
- **网络**：transport、超时类设置。
- **关于**：版本号、manifest 链接、许可、GitHub 链接、以及首段那段隐私声明（§5-6）。
- Tab 用 Obsidian 原生模式：`containerEl` 顶部一排 tab 按钮 + 内容容器，手写即可，不引额外依赖。

### 补齐的设置项（盘点结果）

| 设置项 | 现状 | 去处 |
|---|---|---|
| 会话存储目录 | `ObsidianSessionManager` 写死 `.pi` | 网络 Tab |
| 会话保留数量 | 写死，无清理 | 网络 Tab |
| truncate 默认上限 | `truncate.ts` 写死字节常量 | 网络 Tab |
| compaction 触发阈值 | `DEFAULT_COMPACTION_SETTINGS` 默认值不可改 | 聊天 Tab（高级折叠） |
| 温度 / maxTokens | 代码写死 | 暂不暴露（不同模型语义差异大，容易造坑；issue 跟踪） |

## 5. P0 修复（不重做也会先修的三个，随重构自然落地）

1. **吃字 bug**：新架构下各 Tab 独立渲染、控件不再因激活翻转整体重建；provider 激活状态只影响 disabled 与提示文案，不触发 `display()`。
2. **加密文案统一**：抽一个 `describeSecretStorage(secretEnvironment)`，返回一句话（"已用系统钥匙串加密" / "此设备不支持加密，明文存于 vault 配置"），所有 key 行共用。关于页放完整声明。
3. **沉默终点**：每个配置块有测试按钮 + 就地结果；`describeModelTarget()` 上移到模型 Tab 顶部，随时可见"当前使用 X / 经 Y 发送"。

## 6. 顺带清理（本波一起）

- 删三个死 `setClass` 调用，替换为真实样式；设置页补 CSS（沿用 `pi-` 前缀，跟随 Obsidian CSS 变量）。
- 逐字符落盘改为防抖（如 800ms）+ 失焦即存；`refreshConfiguration` 只在协议相关字段变化时重建。
- placeholder 反引号去掉（`settings.ts:221`）。
- **bundle 体积（1.9MB / 39 provider / 1312 模型）本波不碰**——砍 catalog 要动 provider 注册，风险独立。开 issue 跟踪。

## 7. 分阶段交付

| 阶段 | 内容 | 交付物 |
|---|---|---|
| P1 | 数据结构 + 迁移 + 协议三分支 + streamFn/customEndpoint 泛化 | 新 schema 上线，旧配置无损迁移，三协议可用（先用现有 UI 驱动） |
| P2 | 设置页 Tab 化 + provider/model 列表 UI + 测试按钮 + suggest 搜索 | 完整新设置页 |
| P3 | P0 修复收尾 + CSS + 防抖 + 关于页 + 盘点出的新设置项 | critique 复测，目标 ≥ 30/40 |

每阶段独立可发布（bundle 门禁 `check-bundle.mjs` 全程跑，vitest 覆盖迁移函数与协议派发）。

---

### 待你拍板的遗留（此前问答的答复在会话迁移中丢了，我按推荐值先行）

1. **内置 catalog 是否保留"完整下拉"**：我按"suggest 搜索 + 保持全部 39 个"设计；若你想砍到 5-8 个常用，告诉我，P1 schema 不变。
2. **`providerApiKeys` 迁移时机**：我按"P1 保留、下版删"设计。
3. **compaction 高级设置是否本波暴露**：我按"聊天 Tab 折叠组暴露"设计，如果你觉得多余可以砍。

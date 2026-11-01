# 模型下拉与倍率实时同步 — 设计说明（v5 定稿 + 服务端倍率）

> 状态：设计稿，待用户确认后实现。
> 涉及两个仓库：`QMAI-main`（桌面客户端）、`QMAI-API`（网关 + 控制台）。

## 一、目标

1. 模型下拉按 v5 定稿重做：内置优先、自定义按提供方折叠、行高 36px / 边距 16px、自定义模型只显示名称。
2. 内置模型的倍率必须**与 console.qmai.work 的设置一致**，并且能**立即更新**——控制台改完倍率，软件下次打开下拉就是新值，不需要等发版。

## 二、现状（已核实）

| 层 | 现状 | 结论 |
|---|---|---|
| 控制台 `console/src/groups-api.ts` | `model_groups` 表已有 `ratio` / `tier` / `sort_order` / `enabled` | 倍率字段齐全，不需要新增 |
| 网关 `src/registry.ts::listPublicModels` | 读同一张表，但 `CACHE_TTL_MS = 60_000`（实例内存缓存） | 控制台改完**最长 60 秒**才生效 |
| 网关 `GET /v1/models` | **已经返回** `id / display_name / note / tier / ratio / base_ratio / active_rule / context_size / max_output` | 传输层已具备，客户端没读 |
| 客户端 `gateway-api.ts::gatewayListModels` | 只取 `id`，其余字段丢弃 | 需要改为解析完整对象 |
| 客户端 `catalog.ts` | 中文名、上下文全写死在本地；`savedModels` 只存 `name/model/description` | 需要把倍率等元数据随模型一起存下来 |
| 客户端同步时机 | 仅登录 / 注册 / 启动 / token 刷新（`auto-sync.ts`、`wire.ts`） | 需要增加「打开下拉时刷新」 |

## 三、倍率怎么做到「立即更新」

分三步，缺一不可：

### 1. 网关去掉 60 秒缓存（`QMAI-API/src/registry.ts`）

`GET /v1/models` 是低频请求，60 秒缓存换来的收益远小于「改了看不到」的困惑。做法：

- 去掉 `modelsCache` 的 TTL 短路，或把 TTL 降到 0 / 5 秒；
- 表里数据量极小（几十行），D1 读一次可忽略。

> 如果担心 D1 读次数，可加一个「控制台写库后打网关的失效接口」的方案，但那是跨 Worker 调用，复杂度高、失败率也高。建议直接去缓存，先观察用量。

### 2. 客户端新增一个「模型元数据」接口（`QMAI-API/account-worker` 或网关）

客户端读倍率有两种选择：

| 方案 | 做法 | 代价 |
|---|---|---|
| **A（推荐）** | 客户端用网关卡直接调 `GET relay.qmai.work/v1/models`，本地解析并在本地缓存 | 无服务端改动（只需去网关缓存），复用已有鉴权链路 |
| B | 在账号服务加 `GET /v1/model-catalog`，返回不带上游信息的模型元数据 | 多一份重复实现，且账号服务本身不具备网关数据 |

选 A：网关已经返回全部字段，客户端 `auto-sync` 本来就在调这个接口，只是把返回值从「字符串数组」升级为「对象数组」即可。

### 3. 客户端刷新策略

```
打开模型下拉（或悬停面板打开）时：
  ├─ 先渲染本地缓存（缓存来自上次同步，持久化在 savedModels.meta）
  └─ 后台静默拉一次 /v1/models：
       成功 → 比对倍率有变化 → 更新配置并重渲染（同一秒内看到新值）
       失败 → 保留缓存，不打断用户
```

再加兜底：

- 应用启动 / 登录 / token 刷新时同步一次（现有逻辑保留）；
- 下拉每次打开时最多每 30 秒触发一次网络请求（防止连点造成请求风暴）；
- 倍率变化时**不要**触发「默认模型被改」之类的副作用，只更新展示与计费。

## 四、数据落点（客户端）

`SavedModel` 增加一个可选元数据对象，内置模型写入，自定义模型不写：

```ts
export interface SavedModelRating {
  /** 当前生效倍率（已含时段规则），用于展示 */
  ratio: number
  /** 基础倍率（不含时段规则） */
  baseRatio?: number
  /** 当前命中的时段规则名，例如「夜间折扣」；无规则时为 null */
  rule?: string | null
  /** 等级：light / standard / pro / flagship（控制台定义） */
  tier?: string
  /** 元数据同步时间，用于判断缓存是否过旧 */
  syncedAt: number
}

export interface SavedModel {
  // …现有字段
  rating?: SavedModelRating
}
```

显示规则：

| 情形 | 显示 |
|---|---|
| 内置模型，`rating.ratio` 有值 | `0.08x`（保留两位小数，去掉多余零） |
| 内置模型，无 `rating`（旧缓存） | 显示 `—`，下次同步后补齐 |
| 自定义模型 | **不显示倍率**，也不占位 |
| 命中时段规则 | 倍率后追加小标签，如「夜间折扣」 |

## 五、界面定稿（v5）

结构：

```
青幕内置模型                        ← 吸顶小标题
  青幕标准版   推荐   0.08x  ✓      ← 行高 36px，边距 16px
  青幕长文版           0.33x
  …
────────────────────────
自定义模型                    [开关]  ← 吸顶
  ▾ ZIFEIYU                          ← 34px，右侧无数量
      glm-5.3                        ← 34px，左缩进 38px，只显示名称
      gemini-3.8-flash-high
  ▸ DGB
────────────────────────
＋ 添加模型
```

规则：

- 自定义区默认**收起**，开关状态记在本地；
- 每个提供方的展开状态也记在本地；
- 自定义模型行：**只有名称**——不显示 `provider/` 前缀、不显示倍率占位；
- 顶部不再出现「当前选中模型」条（列表选中态已足够）；
- 不显示「几个提供方 / 几个模型 / 第几个 / 定位」。

实现落点：`src/components/chat/chat-model-selector.tsx`。

## 六、落地记录（已实现）

### 服务端 `QMAI-API`

| 文件 | 改动 |
|---|---|
| `src/registry.ts` | 去掉 `listPublicModels` 的 60 秒实例缓存（`modelsCache` 一并删除）。控制台改完倍率，下一次 `GET /v1/models` 就是新值。路由表 `routeCache` 未动。 |
| `test/models.test.ts` | 新增用例：改 `ratio` 后同一进程的下一次请求必须立刻返回新倍率。 |

> 网关需要重新部署才会生效：`cd QMAI-API && npx wrangler deploy --config wrangler.toml`。

### 客户端 `QMAI-main`

| 文件 | 改动 |
|---|---|
| `src/stores/wiki-store.ts` | 新增 `SavedModelRating`；`SavedModel` 增加可选 `rating`（ratio / baseRatio / rule / tier / syncedAt）。 |
| `src/lib/builtin-models/gateway-api.ts` | 新增 `gatewayListModelCatalog()`（返回完整对象）与 `GatewayModelInfo`；`gatewayListModels()` 改为基于它取 id，老调用方行为不变。 |
| `src/lib/builtin-models/provider-bridge.ts` | 名称/备注/上下文优先取网关下发值；`savedModels` 写入 `rating`；`applyBuiltinModels` 接受 `catalog`。 |
| `src/lib/builtin-models/auto-sync.ts` | 改用 catalog；签名纳入**倍率与展示名**（只改倍率也会重写配置）；新增 `refreshBuiltinModels()`，30 秒节流，无登录态时直接跳过（不触发"清配置"副作用）。 |
| `src/components/chat/chat-model-selector.tsx` | 按 v5 重写渲染层；打开下拉时刷新倍率；自定义区开关与提供方折叠状态持久化。 |
| `src/i18n/zh.json` | 新增 `chat.customModels` / `chat.expandCustomModels` / `chat.collapseCustomModels`。 |
| `src/components/chat/chat-model-selector.spec.tsx` | 断言改成新尺寸与新结构，并补倍率格式化、折叠、只显示名称等用例。 |
| `src/lib/builtin-models/{auto-sync,gateway-api}.spec.ts` | 跟随新接口更新，补倍率解析、节流、倍率变更重写等用例。 |

### 与原计划的差异（及原因）

1. **没有改 `src/lib/llm-model-keys.ts`**：复核后发现 `isProviderAvailable` 已经在自定义分支之前拦掉了 `enabled === false`，停用的自定义提供方本来就不会出现在下拉里，不需要额外过滤。
2. **没有做「＋ 添加模型」底部按钮**：该位置没有明确的产品入口（添加模型在「设置 → 模型设置」），放一个点了只关闭下拉的按钮属于假功能，故删除。
3. **下拉最小宽度 280 → 320**：实测 280px 时「名称 + 优惠标签 + 倍率列」会把名称挤成省略号；320 也是「模型设置」悬停面板的宽度，两者一致。
4. **时段规则标签已实现**：网关下发 `active_rule` 时，在该行倍率左侧显示小标签（如「夜间折扣」），无规则时不渲染。

## 七、测试与验证

1. **网关**：`test/models.test.ts` 断言「改倍率 → 下一次请求即返回新值」；`QMAI-API` 全量 151 个用例通过。
2. **客户端解析**：`gateway-api.spec.ts` 覆盖完整字段解析、无规则时 `rule=null`、老网关只回字符串 id、按 id 去重。
3. **显示规则**：`formatModelRatio` 覆盖 `0.08x / 0.06x / 0.3x / 1x / 1.25x` 与「无倍率返回 null（不画占位）」。
4. **折叠**：spec 断言自定义默认收起、按提供方折叠、选中项在收起块内时自动展开。
5. **节流**：`auto-sync.spec.ts` 断言 30 秒内重复调用只拉一次；无登录态不动配置。
6. **真实渲染核对**：`preview/selector-real-render.html` / `.png` 是真实组件渲染结果（真实 DOM + 项目编译的 Tailwind），可直接目视核对间距与层级。
7. **客户端全量**：`10505 passed / 6 failed`，6 条失败均为本次改动之前就存在的陈旧用例（sdk 打包测试、字体换算、knowledge-tree 文案、ui-test 三栏入口旧文案等），与模型下拉无关。


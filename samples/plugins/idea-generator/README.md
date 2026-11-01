# 脑洞生成器（idea-generator）

一个**纯声明式（Tier 1）插件**样例：**没有 `index.js`、不启动任何进程、不执行一行第三方代码**，
整个插件就是一份 `plugin.json` + 一份灵感 JSON。它做三件事：

- **生成书名**（章节页工具栏）：填一句灵感 → 模型给 5 个书名 → 点「设为书名」写回项目
- **生成标签**（章节页工具栏）：选题材 + 填灵感 → 模型给 3-8 个平台可用标签 → 点「设为标签」写回项目
- **生成人设**（大纲页工具栏）：选角色定位与颗粒度 → 生成可直接落档的人物设定 → 写回项目
- **附一个灵感包**（右侧栏灵感库）：30 条网文开局钩子，按题材分类，可搜索 / 打标签 / 插入正文

表单、提示词、输出映射全在清单里，**渲染、调模型、写回都由宿主完成**，作者一行代码不写。

## 它示范了什么

这是插件平台 v3「声明式优先」的**端到端验收样例**。它刻意把下面这些契约点各踩一遍：

1. **纯声明式 = 零代码、零进程**：目录里没有 `index.js`，清单里**没有 `runtime`**，
   `tools` / `providers` / `hooks` 也全空 —— 没有任何可执行的东西。
   宿主据此把这个插件判为 `processState == "declarative"`：**启用时不 spawn、不占端口、不占内存**，
   真正的执行者是宿主自己（渲染表单、调模型、写回项目）。装 20 个这样的插件，进程表里仍然是 0 条。
   清单里的 `"kind": ["declarative"]` 就是把这层意图显式说出来（设计 §2.1）。
2. **`configSchema` + 宿主自动渲染设置表单**（设计 §6.3）：
   `defaultCount`（数字，1-10）、`titleStyle`（枚举，默认「爆点」）、`penName`（字符串，≤32 字）。
   宿主按 schema 画表单、校验、存盘；提示词里用 `{{config.titleStyle}}` 取值。
   `titleStyle` 被「生成书名」用、`penName` 被「生成人设」用；`defaultCount` 目前**不被任何提示词引用**
   —— 表单默认值是字面量、**不支持写 `{{config.*}}`**（宿主侧 `form.fields[].default` 只认常量），
   所以它先作为「一个设置项该长什么样」的示范留着，等宿主支持「表单默认值读配置」再接上。
   **要放密钥时**，字段加 `"x-qmai-secret": true` 即可（宿主不落明文，走与 provider token
   相同的内存策略）。本样例故意不放 secret 字段，保持简单。
3. **`actions` = 表单 + 提示词 + 输出映射**（设计 §3.1）：
   三个 action 覆盖了三种输出形态 —— `list + chips`（书名、标签）、`text + markdown`（人设）。
   表单字段只用了 `textarea` / `number` / `select` 三种，够说明「6 种字段类型」的用法。
4. **`contentPacks` 随包分发、离线可用**（设计 §4.4 / D4）：30 条灵感是插件目录里的一个 JSON，
   安装时落到磁盘，之后**不发任何网络请求**，因此内容包**不需要任何网络权限**。
   包级 `actions` 声明了条目上能做什么：**插入正文** / **设为简介**（`project-field: bookIntro`）/
   **据此生成书名**（`run-action` → 复用本插件自己的 `generate-titles`，设计 §4.1 的链式调用；
   跨插件 `run-action` 是禁止的，会形成隐式依赖）。
5. **`slots` 挂到 3 个插槽**（设计 §6.1）：`chapter-toolbar`（两个按钮）、`outline-toolbar`（一个人设按钮）、
   `inspiration-browser`（灵感库面板）。`requiresSlot` 显式声明依赖插槽 API 版本 1（D8）——
   插槽是宿主与插件之间最脆弱的耦合面，没有版本号的地方不允许对外暴露。
6. **`permissions` 与 `{{chapter.*}}` 的对应关系**（设计 §3.3）：
   - `generate-titles` / `generate-tags` 只用表单变量和 `{{config.*}}` → **不需要任何权限**
   - `generate-protagonist` 读了 `{{chapter.title}}`（只读标题，不读正文）→ 按设计**必须**声明
     `fs:project-read`，否则该 action 在校验阶段就被拒（不是运行时才失败）
   - 所以本插件 `permissions: ["fs:project-read"]`，**这一个权限是「示范怎么申请」**，
     不是「生成书名也要读你的稿子」——另外两个 action 完全碰不到项目内容
7. **`preview` 免执行发现**（设计 §8）：插件中心在**不启动插件**的前提下，就能显示
   「3 个动作 + 1 个内容包（30 条）」。`preview` 只用于展示，调用真源仍是运行期。

## 目录结构

```
idea-generator/
├── plugin.json                 # 全部声明：kind / slots / configSchema / actions / contentPacks
├── content/inspirations.json   # 灵感包数据（version + items）
├── prompts/README.md           # 提示词怎么改（提示词本体在 plugin.json 里）
└── README.md
```

**没有 `index.js`** —— 少了这个文件仍然功能完整，这是本样例最想说明的一件事。
清单里也没有 `runtime`：没有可执行的贡献点，宿主就不会为你 spawn 任何进程。

## 安装

### 本地目录（开发 / 试用）

设置 → 插件 → **从本地目录安装**，选中本目录即可。宿主侧对应
`src-tauri/src/plugins/installer.rs` 的 `install_local`：校验 `plugin.json` → 复制到插件根 → 落注册表。

装完在插件页点「启用」，然后：

- 章节编辑页工具栏出现「生成书名」「生成标签」
- 大纲页工具栏出现「生成人设」
- 右侧栏灵感库出现「网文开局钩子 30 例」

> 目录名必须等于清单里的 `id`（`idea-generator`），否则注册表与目录对不上。

> 启用后 **不会启动任何进程**：插件卡片的进程状态是 `declarative`（设计 D1）。
> 三个按钮与灵感库都只依赖清单，没有一行代码在跑。

### 推 GitHub

仓库根目录放 `plugin.json` + `content/` 即可（不要 `package.json`、不要构建产物），
然后在 QMAI 里用地址安装：

```
https://github.com/<owner>/<repo>          # 默认 main
https://github.com/<owner>/<repo>@v1.0.0   # 指定 tag / 分支
```

宿主只下载 zip 快照、**不跑** `npm install` 或任何构建脚本。纯声明式插件里没有可执行代码，
所以「推上去的必须能直接跑」这条约束对它来说天然成立。

## 怎么改成自己的

1. **换身份**：改 `id`（小写字母/数字/连字符，且必须等于安装目录名）、`name`、`description`、
   `version`（三段式 SemVer）、`author`。`id` 与 `name` 合计别超 64 字。
2. **换提示词**：改 `contributes.actions[].prompt.system` / `.user`（见 `prompts/README.md`）。
   提示词就是这类插件的全部业务逻辑，**改提示词 = 改产品**。
3. **换配置项**：改 `configSchema.properties`，提示词里用 `{{config.键名}}` 引用；
   数字用 `minimum` / `maximum`，枚举用 `enum`，字符串用 `maxLength`。
4. **换灵感**：改 `content/inspirations.json` 的 `items`（`id` / `title` / `body` / `tags`），
   `id` 必须唯一，条数不要超过清单里的 `maxItems`，单包上限 5MB / 5000 条。
5. **换插槽**：`slots` 与各 action 的 `slot` 只能取宿主白名单里的 6 个：
   `chapter-toolbar` `inspiration-browser` `editor-context-menu` `outline-toolbar`
   `analysis-toolbar` `plugin-center`。新增插槽要宿主评审，不是插件作者能决定的。
6. **权限**：能不留就不留。只有当提示词里出现 `{{project.*}}` / `{{chapter.*}}` / `{{selection}}`
   时，才必须声明 `fs:project-read`（用户还要在启用时勾选）。

### 常见改法：加一个新 action

想在章节工具栏再加一个「生成简介」，只需在 `contributes.actions` 数组里加一段，
**不用碰任何代码、不用改宿主**：

```json
{
  "id": "generate-intro",
  "title": "生成简介",
  "description": "把灵感扩写成 100 字以内的书籍简介",
  "slot": "chapter-toolbar",
  "form": {
    "fields": [
      { "key": "idea", "type": "textarea", "label": "你的灵感", "required": true, "rows": 3, "maxLength": 500 },
      { "key": "tone", "type": "select", "label": "语气", "options": [
        { "value": "悬念", "label": "悬念" }, { "value": "热血", "label": "热血" }
      ] }
    ]
  },
  "prompt": {
    "system": "你是中文网文的简介编辑，只写简介，不写正文、不写标题。",
    "user": "核心灵感：{{idea}}\n语气：{{tone}}\n\n要求：\n1. 100 字以内，一段话，不分点\n2. 第一句必须留一个钩子，最后一句不许把谜底说破\n3. 不要写「本书讲述」「一个关于」这类套话"
  },
  "output": {
    "mode": "text",
    "presentation": "plain",
    "targets": [
      { "kind": "project-field", "field": "bookIntro", "label": "设为简介", "confirm": true },
      { "kind": "clipboard", "label": "复制" }
    ]
  },
  "limits": { "timeoutMs": 60000, "maxOutputTokens": 400 }
}
```

要点：`id` 必须同插件内唯一且匹配 `^[a-z][a-z0-9-]{0,31}$`；`project-field` 的 `field` 只能取
宿主枚举（`bookTitle` / `bookTags` / `bookIntro` / `protagonist` / `setting`），
**不存在「写任意文件」的通道**（设计 D2/D9）。

## 本样例用到的清单能力（清单字段 → 设计条款）

一份 `plugin.json` 就把 v3 的 Tier 1 声明面走完了。逐项对照：

| 字段 | 本样例的值 | 设计条款 | 宿主怎么用它 |
|---|---|---|---|
| `kind` | `["declarative"]` | §2.1 | 声明「我不跑代码」。未知值只 warn 不拒装（老宿主也能装新清单） |
| `runtime` | **不写** | §2.3 / D1 | 无 `runtime` + 无可执行贡献 ⇒ `processState == "declarative"`，永不 spawn |
| `slots` / `requiresSlot` | 3 个插槽，版本 1 | §6.1 / D8 | 决定按钮与面板挂在哪；版本号让宿主升级插槽时能提示而不是静默打断 |
| `configSchema` | `defaultCount` / `titleStyle` / `penName` | §6.3 | 宿主自动渲染设置表单，填完的值以 `{{config.*}}` 进提示词 |
| `contributes.actions` | 3 个 action | §3.1 | 宿主渲染表单 → 插值 → 调当前模型 → 按 `output.mode` 解析 → 按 `targets` 写回 |
| `actions[].model` | `{strategy:"current", minContextTokens:8192}`（仅「生成书名」） | §3.1 | 用当前模型即可，但要求上下文窗口 ≥ 8192，避免长灵感被截断 |
| `actions[].limits` | `timeoutMs` / `maxOutputTokens` | §3.1 | 超时与输出预算，按 action 分别给（人设最贵，90s / 1200 tok） |
| `contributes.contentPacks` | 1 个包，30 条，`maxItems: 5000` | §4.1 / D4 | 宿主读盘、校验、缓存；单包上限 5MB / 5000 条，超限拒绝安装 |
| `contentPacks[].actions` | 插入正文 / 设为简介 / 据此生成书名 | §4.1 | 沿 `ContentPackMeta.actions` 送到前端，灵感库在**打开包之前**就知道条目能干什么 |
| `preview` | 3 个 action + 1 个包（30 条） | §8 | 免执行发现：插件中心不启动插件也能画卡片；调用真源仍是运行期 |
| `permissions` | `["fs:project-read"]` | §3.3 | 只因为「生成人设」读了 `{{chapter.title}}`；另两个 action 不需要任何权限 |

## 它**不是**什么

- 不是「能读你正文的 AI」：只有「生成人设」读了**当前章节标题**，其余两个 action 完全用不到项目内容。
- 不是「无限扩展的脚本插件」：声明式做不了多轮交互、条件分支、外部接口。真需要那些，
  是 Tier 2（子进程 / MCP 工具）的范畴，参加 `samples/plugins/chapter-metrics/`。
- 不是「联网抓灵感」：30 条灵感随包分发，离线可用，零网络权限。

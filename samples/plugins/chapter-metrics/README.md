# 章节体检（chapter-metrics）

一个**工具插件**样例：零依赖、零权限、纯本地字符串统计。
它给 AI 加一个工具 `analyze_chapter_text` —— 把整章正文丢进去，回一份体检报告：

- **字数**：汉字数 + 英文词数（分别报，再给合计）
- **对话占比**：`“”` 与 `""` 内的字数 / 总字数
- **句长分布**：句数、平均句长、最长句、≤10 字的短句占比
- **重复句**：出现 ≥2 次的句子，前 5 条

这些数字写手平时得靠人眼数或另开工具。整个插件不需要联网、不读文件、不要任何权限，
是 v1 扩展点「一个插件 = 给 AI 加一个工具」的最短可用路径。

## 口径与已知边界

统计是纯字符串计算，**口径必须说清**，否则作者会拿着数字做错误判断：

- **字数** = 汉字数 + 英文词数，标点不计。阿拉伯数字按 **1 个英文词**计（`2024` → 1）。
- 英文按 `\b\w+\b` 计词：`Don't` 会被拆成 `Don` + `t` **两个词**（撇号不是 `\w`）。
  中文正文里英文很少，影响通常可忽略；英文占比高的稿子要心里有数。
- **断句**只认 `。！？!?…`（末尾没有标点的残段也算一句）。英文句号 `.` **不**断句，
  否则「3.5 年」「Mr. Smith」会被切断 —— 代价是纯英文段落会被当成一句，
  且「句长」的单位其实是「汉字/英文词」而不是视觉上的字。
- **对话**只认中文弯引号 `“”` 与英文直双引号 `""`；`「」『』`、单引号不算。
  引号未闭合（只写了 `“` 没有 `”`）的那一段不算对话。嵌套引号只计一次（不会翻倍）。
- 段落如果**没写句末标点**，会和下一段并成一句 —— 这是「按标点断句」的直接后果。
- **重复句**只统计 ≥2 字的句子（避免「是。」这类碎片刷屏），归一时只去空白、
  **不去标点**：`他说。` 与 `他说？` 算两句。
- Markdown 只去掉标记（`#`、`*`、`` ` ``、`>`、列表符号、链接/图片的 URL），
  正文内容与汉字标点全部保留；代码块里的文字仍计入字数。

## 输出长什么样

输入 `他说：“走吧。”她没动。窗外的雨还在下。他沉默了。他沉默了。`：

```
## 章节体检

- 总字数：22（中文 22 字 / 英文 0 词）
- 对话占比：9.1%（2 字在引号内）
- 句数：5，平均句长 4.4 字
- 短句占比（≤10 字）：100.0%（5/5 句）
- 最长句（截断）：「窗外的雨还在下。」（7 字）

### 重复句（出现 ≥2 次，前 5）
1. ×2 「他沉默了。」

> 口径：字数 = 汉字数 + 英文词数（标点不计）；对话只算 “” 与 "" 内的内容；句长用同一字数口径。
```

## 安装

### 本地目录（开发 / 试用）

设置 → 插件 → **从本地目录安装**，选中本目录即可。宿主侧对应
`src-tauri/src/plugins/installer.rs` 的 `install_local`：校验 `plugin.json` → 复制到插件根 → 落注册表。

如果当前版本还没有这个入口，可以手工装（等价于安装器做的事）：

1. 把整个 `chapter-metrics/` 目录复制到插件根目录：
   - Windows：`%APPDATA%\com.qingmuai.writer\plugins\chapter-metrics\`
   - macOS：`~/Library/Application Support/com.qingmuai.writer/plugins/chapter-metrics/`
2. 在插件根的 `.registry.json` 里加一条（没有这个文件就新建）：

```json
{
  "version": 1,
  "plugins": {
    "chapter-metrics": {
      "id": "chapter-metrics",
      "version": "1.0.0",
      "enabled": true,
      "granted_permissions": [],
      "source": {
        "repo": "local:C:\\path\\to\\chapter-metrics",
        "ref": "local",
        "commit": "local",
        "zip_sha256": "",
        "installed_at": "2026-10-28T00:00:00Z"
      }
    }
  }
}
```

`source.repo` 的 `local:<绝对路径>` 形状与安装器写入的一致，方便日后追查这个插件是从哪来的
（插件页的「启用」按钮做的事就是把 `enabled` 置为 true；手工写成 true 就等于直接启用）。

3. 重启 App（或到插件页点「启用」）。装好后在对话里问模型「用章节体检分析一下这段正文」，
   或者直接让它调 `analyze_chapter_text`。

> 目录名必须等于清单里的 `id`（`chapter-metrics`）；注册表的键与条目里的 `id` 也必须一致，
> 否则宿主会拒绝加载整张注册表。

### 推 GitHub

仓库根目录放 `plugin.json` + `index.js` 即可，然后在 QMAI 里用地址安装：

```
https://github.com/<owner>/<repo>          # 默认 main
https://github.com/<owner>/<repo>@v1.0.0   # 指定 tag / 分支
```

宿主只下载 zip 快照、**不跑** `npm install` / 构建脚本，所以推上去的必须能直接跑。
本目录**刻意没有** `package.json` / `node_modules`：入口是 `runtime.entry` 指的文件，
宿主用 `node <entry>` 直接拉起来，不需要包管理器参与。

## 它示范了哪些契约点

1. **零权限也能有用**：`permissions: []`。用户装的时候不用逐项勾选，心理负担为零。
2. **stdout / stderr 严格分工**：`stdout` 只写 JSON-RPC 帧（一帧一行），所有日志走
   `process.stderr.write`。一句 `console.log` 就足以让宿主解析失败且只表现为「超时」。
   （清单里的 `inject: ["host.logger"]` 目前只做合法性校验与管理页展示，宿主还不会主动
   推送日志服务；本样例的日志全部走 stderr，不依赖它。）
3. **`isError` 与 JSON-RPC error 的分工**：
   - 参数缺失 / 类型错 / 文本超 200KB → `result.isError = true`，文案能到模型眼前，
     模型可以自己补参数或拆短文本重试；
   - 未知工具名 → JSON-RPC `-32602`；未知方法 → `-32601`（请求本身不合法）。
4. **`tools/list` 才是工具真源**：清单里的 `contributes.tools` 只用于安装前预览 / 管理页展示，
   宿主以运行期 `tools/list` 为准。两处必须一致（本目录里两处各写了一份，改的时候要同步）。
5. **常驻进程的正确退出**：`keepAlive: true`，stdin EOF（宿主关管道）时立即退出，不留孤儿进程。
6. **输入保护**：>200KB 直接回明确错误，而不是卡死或静默截断（截断会让统计数字错得没提示）。
7. **不依赖模块系统**：不用 `require` / `import`，所以在「插件目录（按 CJS 解释）」和
   「`"type": "module"` 的仓库里（按 ESM 解释）」两种情况下都能 `node index.js` 跑起来。
   这也是本目录不需要 `package.json` 的原因。

## 改造成你自己的插件

1. **换身份**：改 `plugin.json` 的 `id`（小写字母/数字/连字符，且必须等于安装目录名）、
   `name`、`description`、`version`（三段式 SemVer）、`author`。
2. **换工具**：改 `contributes.tools[0]` 的 `name` / `description` / `parameters`，
   并同步改 `index.js` 里的 `TOOL`（含 `inputSchema`）。
   - 工具名：小写开头，只含 `a-z0-9_`，3–64 字符；
   - `description` 是**给模型看的**，写清「什么时候该调用它、参数是什么」。
3. **换逻辑**：把 `analyze()` 换成你的实现。保持两条不变：`stdout` 只写协议帧、
   失败用 `isError` 带可读文案。
4. **权限**：真的需要再加。读项目文件要 `fs:project-read`（且用户要勾选），
   而 `data:write` 是自动授予的、不用声明。能留空就留空 —— 这是卖点。
5. **换入口名**：`runtime.entry` 可以是 `main.js` 等，但宿主要求它是插件目录内的相对路径。

## 自测（不需要启动 QMAI）

```powershell
$req1 = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
$req2 = '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"analyze_chapter_text","arguments":{"text":"他说：“走吧。”她没动。窗外的雨还在下。他沉默了。他沉默了。"}}}'
"$req1`n$req2" | node index.js
```

应当输出两行 JSON：第一行是工具清单，第二行是报告文本。再试三件事：

- `'not json'` 混在请求里 → 不崩，正常请求仍有响应；
- 不传 `text` → `isError: true` 且文案说明怎么补；
- 管道关闭后进程退出（不会留在任务管理器里）。

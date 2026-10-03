# AI 大纲输出协议

本协议用于 AI 大纲对话区。AI 生成任何大纲、章纲、人物、设定、伏笔内容时，必须同时给出可保存的结构化结果；系统解析后弹出确认，用户确认后才写入左侧大纲文件树。

## 1. 输出边界

- 本协议只服务 AI 大纲体系，不生成正文。
- AI 可以生成：题材卡、总纲、卷纲、章纲、人物小传、世界观、力量体系、势力、地图、伏笔、质量检查报告。
- 正文协作区后续可以读取已确认章纲，但不通过本协议直接写正文。

## 2. 必须返回的保存元信息

每次生成可保存内容时，AI 必须返回以下字段：

| 字段 | 说明 |
|---|---|
| `targetFolder` | 保存目标文件夹，例如 `大纲`、`章纲`、`人物小传` |
| `fileName` | 文件名，必须包含可排序编号或明确主题 |
| `fileType` | `outline`、`volume-outline`、`chapter-outline`、`character`、`setting`、`foreshadowing`、`quality-report` |
| `writeMode` | `create`、`append`、`replace`、`patch` |
| `referencedSkills` | 本次调用或遵循的 Skill 列表 |
| `sourceIntent` | 用户本轮意图摘要 |
| `content` | 实际保存内容，Markdown 格式 |

## 3. 标准结果块

AI 回复中必须包含一个 `outlineSaveRequest` 代码块（必须含完整 `content`）。系统优先读取此代码块，弹出确认后由用户决定是否写入；禁止静默落盘，禁止调用 `write_outline_node` 作为替代写入通道。

```json
{
  "outlineSaveRequest": {
    "targetFolder": "章纲",
    "fileName": "章纲-第001章.md",
    "fileType": "chapter-outline",
    "writeMode": "create",
    "referencedSkills": [
      "TicaiSkill/male-xuanhuan-xianxia",
      "ZhanggangSkill/chapter-outline-builder",
      "SheDingSkill/power-system"
    ],
    "sourceIntent": "用户要为男频玄幻长篇生成第001章章纲",
    "content": "# 章纲-第001章\n\n..."
  }
}
```

## 4. 多文件输出

当一次对话需要同时生成多个文件时，使用 `outlineSaveRequests` 数组。

```json
{
  "outlineSaveRequests": [
    {
      "targetFolder": "大纲",
      "fileName": "题材卡.md",
      "fileType": "outline",
      "writeMode": "create",
      "referencedSkills": ["TicaiSkill/male-urban-system"],
      "sourceIntent": "创建新书题材定位",
      "content": "# 题材卡\n\n..."
    },
    {
      "targetFolder": "设定/世界观",
      "fileName": "世界观-基础规则.md",
      "fileType": "setting",
      "writeMode": "create",
      "referencedSkills": ["SheDingSkill/world-rules"],
      "sourceIntent": "保存世界观基础规则",
      "content": "# 世界观-基础规则\n\n..."
    }
  ]
}
```

## 5. 写入模式规则

- `create`：新建文件。目标文件已存在时，系统应提示用户确认或自动追加序号。
- `append`：追加到文件末尾。适合伏笔记录、角色出场记录、设定更新记录。
- `replace`：整体替换文件。只用于用户明确要求重写时。
- `patch`：局部修改。必须说明要修改的标题段落或字段。

## 6. 文件命名规则

- 题材卡：`题材卡.md`
- 总纲：`总纲.md`
- 卷纲：`卷纲-第01卷.md`
- 章纲：`章纲-第001章.md`
- 人物小传：`角色-男主-角色名.md`、`角色-女主-角色名.md`、`角色-反派-角色名.md`
- 世界观：`世界观-主题.md`
- 力量体系：`力量体系-主题.md`
- 势力：`势力-组织名.md`
- 伏笔：`伏笔-主题.md`
- 质量报告：`质量检查-对象名.md`

## 7. 失败与澄清

如果 AI 无法判断保存目标，必须先输出澄清问题，不得默认乱存。

必须澄清的情况：

- 用户只说“完善一下”，但没有指定文件或内容对象。
- 同名文件存在且用户没有说明覆盖、追加或另存。
- 生成内容跨越大纲和正文边界。
- 题材、男频/女频、长篇/短篇冲突。

## 8. 质量门

输出保存请求前检查：

- 是否包含 `targetFolder`、`fileName`、`fileType`、`writeMode`、`referencedSkills`、`content`。
- 是否使用中文用户提示和中文文件名。
- 是否没有生成正文。
- 是否引用了题材、大纲/章纲、人物或设定 Skill。
- 是否符合 `OUTLINE_FOLDER_STORAGE_STANDARD.md` 的目标文件夹规则。

## 9. HTML 版本（系统自动渲染，AI 不要自己写 HTML）

保存时每个 `.md` 都可以有一份同名 `.html` 伴生文件（自包含、无脚本）。**HTML 由系统套技能目录下的模板渲染，AI 禁止自己写 HTML/CSS/标签**，只需按类型附上结构化数据：

| 类型 | 结构化数据（```json 围栏顶层字段） | 渲染模板 |
|---|---|---|
| 卷纲 | `volumeOutlineData` | `DagangSkill/juangangzhedieshu/template.html`（折叠树） |
| 章纲 | `chapterOutlineData` / 分批用 `chapterOutlineBatch` | `ZhanggangSkill/zhanggangjiegouhua/template.html`（卡片流） |
| 人物小传 | `characterProfileData`（多角色用 `characterProfiles`） | `JueseSkill/character-design/profile.html`（角色卡） |
| 组织势力 | `factionProfileData`（多势力用 `factionProfiles`） | `SheDingSkill/faction-system/profile.html`（势力卡） |
| 力量体系 | `powerProfileData`（多体系用 `powerProfiles`） | `SheDingSkill/power-system/profile.html`（体系卡：等级阶梯 / 代价矩阵） |
| 伏笔计划 | `foreshadowingProfileData`（多台账用 `foreshadowingProfiles`） | `SheDingSkill/foreshadowing-suspense/profile.html`（伏笔台账：伏笔线 / 状态徽章） |
| 金手指 | `goldenFingerProfileData`（多能力用 `goldenFingerProfiles`） | `SheDingSkill/power-system/golden-finger.html`（能力卡：系统面板） |
| 地理设定 | `geographyProfileData`（多区域用 `geographyProfiles`） | `SheDingSkill/map-progression/profile.html`（地理卡：区域块） |
| 地点设定 | `locationProfileData`（多地点用 `locationProfiles`） | `SheDingSkill/map-progression/location.html`（地点卡：空间规则 / 触发事件） |
| 背景设定 | `backgroundProfileData`（多设定用 `backgroundProfiles`） | `SheDingSkill/world-rules/background.html`（背景卡：历史时间线 / 规则块） |
| 其它未列类型（兜底） | `settingOutlineData` | `SheDingSkill/setting-cards/template.html`（卡片流） |

`characterProfileData` / `factionProfileData` / `powerProfileData` / `foreshadowingProfileData` / `goldenFingerProfileData` / `geographyProfileData` / `locationProfileData` / `backgroundProfileData` 结构相同：`{ name, tag, tagline, sections[] }`；每个 section 为 `{ kind: "kv"|"list"|"table", heading, items?/head?+rows? }`（关系网络/出场记录/外部关系/等级阶梯/代价/伏笔状态/已解锁能力/区域划分/重要地点/势力分布/空间规则/可触发事件/历史沿革/核心设定规则用 table）。

> 表格单元格若为常见状态枚举（未埋/已埋/推进中/已回收/已过期、高/中/低、已完成/进行中等），软件会渲染成彩色徽章——请严格使用这些取值。

⚠️ 力量体系 / 金手指 / 地理设定 / 地点设定 / 背景设定 共用 `fileType=setting`，软件按 `title → 正文标题 → 文件名 → sourceIntent` 判定子类型后再选模板。

`settingOutlineData` 结构：`{ title, intro, chips[], cards:[{ badge, title, subtitle, tags[], sections:[{ heading, items:[{ label, text }] }] }] }`；每个对象一张 card，写满该分项的分区。若系统未解析到结构化数据，会退回从 `content`（MD 正文）自动解析，因此 `content` 的标题/列表结构要规范。

保存确认对话框中，勾选「HTML 形式」才会写入 `.html`；未生成 HTML 时该选项不可用。


# AI 大纲输出协议

本协议用于 AI 大纲对话区。AI 生成任何大纲、章纲、人物、设定、伏笔内容时，必须同时给出可保存的结构化结果，便于系统自动写入左侧大纲文件树。

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

AI 回复中必须包含一个 `outlineSaveRequest` 代码块。系统优先读取此代码块完成自动保存。

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

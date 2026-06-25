# Skills 技能系统

本目录包含应用运行时需要的skill资源，包括角色视角skill和去AI味skill。

## 目录结构

```
skills/
├── soulskill/              # 角色视角skill（53个内置角色）
│   ├── cao-cao-perspective/
│   ├── elon-musk-perspective/
│   ├── paul-graham-perspective/
│   └── ...
│
└── de-ai-writing/          # 去AI味skill参考文档
    └── references/
        ├── ai-trace-index.md       # AI痕迹轻量索引
        ├── ai-trace-detector.md    # 24项AI痕迹检测详解
        └── translation-guardrails.md # 翻译护栏规则
```

## 角色视角skill（soulskill/）

基于SKILL框架的角色个性化系统。每个角色视角包含：
- 角色档案与核心设定
- 表达DNA（说话习惯、用词偏好、句式特征）
- 思维模式与决策风格
- 价值观与行为准则

### 内置角色列表（53个）

**历史人物**：秦始皇、李世民、曹操、诸葛亮、李白、苏轼、王阳明等

**文学角色**：孙悟空、哪吒、二郎神、林黛玉、王熙凤、张小凡、萧峰、花木兰等

**现代人物**：埃隆·马斯克、保罗·格雷厄姆、查理·芒格、费曼、乔布斯、Naval等

### 使用方式

1. 在拆书分析中绑定角色视角
2. 在章节生成时，系统自动注入对应角色的灵魂特征
3. 确保人物对话、思维、行为符合角色设定

## 去AI味skill（de-ai-writing/）

通用去AI味技能的参考文档，供深入了解去AI味规则使用。

### 核心文件

- **ai-trace-index.md** - AI痕迹Top 5-10优先清单
- **ai-trace-detector.md** - 24项AI痕迹检测详解（词汇层、句式层、叙事层、逻辑层、风格层）
- **translation-guardrails.md** - 翻译任务的结构保真规则

### 去AI味规则使用

应用使用 `de-ai-skill.md`（项目根目录）作为默认去AI味规则。用户可通过以下方式自定义：

1. 在项目根目录创建 `de-ai-skill.txt`
2. 写入自定义规则
3. 系统会优先使用自定义规则

详见：[去AI味升级说明.md](../去AI味升级说明.md)

## 自定义角色视角

应用支持创建自定义角色视角，存储在：
```
<项目>/.qmai/character-auras/<id>-<name>-perspective/
```

自定义角色与内置角色共存，可以随时创建、编辑、删除。

## 技术说明

- 内置角色视角在应用打包时会被复制到应用资源目录
- 便携版：skills 文件夹直接在 exe 旁边
- 安装版：skills 在安装目录的 _up_ 子目录中
- 运行时加载逻辑：项目目录 → exe目录 → 资源目录（多路径回退）

## 贡献

如需添加新的内置角色视角，请遵循现有的SKILL.md格式：

```markdown
---
name: character-name-perspective
description: |
  角色简介和灵魂定位
---

# 角色名 · 角色灵魂操作系统

## 角色扮演规则
...

## 核心心智模型
...

## 表达特征
...
```

---

**注意**：本目录的内容是应用运行时必需的资源，请勿删除或重命名。

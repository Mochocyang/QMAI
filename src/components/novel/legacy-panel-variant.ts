/**
 * 旧版面板的呈现模式：full 是旧版页面原样，embedded 用于嵌进新版页签。
 *
 * 约定（三个旧版面板共用，改动前先读完这段）：
 * 1. 本类型只描述**外壳**——重复的标题、卡片自身的内边距/边框/背景。
 * 2. 某个管理类控件是否渲染，只由**它自己的回调是否存在**决定（`{onX && <Button/>}`），
 *    与 variant 无关。这样漏传回调只会少一个按钮，而不会留下点了没反应的死按钮。
 *    用了本类型的组件：`BookAnalysisCharacterPanel`、`BookAnalysisStyleCard`。
 * 3. `StoryMapContent` **刻意不用本类型**：它没有需要剥离的外壳（每张卡片的边框属于内容），
 *    唯一的删除按钮已经由 `onDeleteStoryMap` 门控，再加一个 variant 只会多一套机制。
 *    看到两个兄弟组件有这个 prop、而它没有，是刻意的，不要"补齐"。
 */
export type LegacyPanelVariant = "full" | "embedded"

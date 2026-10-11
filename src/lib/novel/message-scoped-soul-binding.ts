/**
 * 「只对这一条消息生效」的角色灵魂绑定（丁-4）。
 *
 * ── 为什么必须是**真绑定**，而不是「把灵魂文本内联进本轮技能」──
 * `buildCharacterSoulContext` 只过滤 `store.bindings`：
 * 未出现在绑定表里的 aura，无论用什么参数、走哪个旁路存储或任务文本约定，
 * 都**不会**进入上下文（连 `options.fallbackAuraId` 也先过绑定表）。
 * 也就是说「按消息使用一条灵魂」在架构上**只有**一条可行路径：
 * 生成前把绑定写进 `.qmai/character-aura.json`，生成后再还原。
 *
 * ── 为什么不用「生成前写、生成后删」这种最朴素的写法 ──
 * 绑定表按 `characterName` **一对一**：`bindCharacterAura` 会用新 aura
 * **覆盖**同名人物原有的那一条。于是「用完就 unbind」有两个真实的数据损失面：
 *   1. 用户**本来就有**这条绑定（同人同灵魂）⇒ unbind 会把用户的绑定删掉；
 *   2. 用户**本来有另一条**绑定（同人不同灵魂）⇒ unbind 会把用户的绑定删掉，
 *      而它原本指向的灵魂已经找不回来了。
 * ⇒ 所以本模块在**写之前**先快照该人物原有的绑定，释放时按快照**精确还原**：
 *   没有原绑定 ⇒ unbind；有原绑定 ⇒ 把快照**完整**写回（**不论**原 aura 与临时的是不是同一条）。
 *
 * ⚠️ 「同一条就什么都不做」是**错的**（本模块曾经那样写，探针实测丢了 `aliases`）：
 * 临时写入那一步把 `{ characterName, auraId, aliases }` 覆盖成了
 * `{ characterName, auraId }`（`bindCharacterAura` 只透传它收到的字段），
 * 所以「同一条」时盘上已经不是原样了，「不动作」= 静默删掉用户的别名。
 * 详见图下 `releaseMessageScopedSoulBinding` 的注释。
 *
 * ── 与 UI 的边界 ──
 * 本模块是纯存储层：它**不**问用户、**不**决定绑给谁，人物名由调用方
 * （确认弹窗）给出。这样「确认交互」与「存储还原」可以各自单测。
 */
import {
  bindCharacterAura,
  getCharacterAuraBindings,
  unbindCharacterAura,
  type CharacterAuraBinding,
} from "./character-aura"

export interface MessageScopedSoulBinding {
  characterName: string
  auraId: string
  /**
   * 本次写入**之前**该项目里该人物已有的绑定；没有则为 `null`。
   *
   * ⚠️ 必须在**写之前**读：`bindCharacterAura` 覆盖同名绑定之后原值就没了
   * （绑定表里同一 `characterName` 只保留一条）。
   */
  previousBinding: CharacterAuraBinding | null
}

/**
 * 写入本条消息的临时绑定，并返回还原所需的快照。
 *
 * 失败时**不**留下任何写入：`bindCharacterAura` 自己会先校验 aura 是否存在、
 * 该人物是否有档案，两处校验都在 `saveCharacterAuraStore` 之前，
 * 所以它抛出「请选择有效的角色灵魂」/「请先在大纲中添加人物小传或人物设定，
 * 再绑定角色灵魂」时磁盘上什么都没变，调用方可以直接把这条消息原样交给用户。
 */
export async function beginMessageScopedSoulBinding(
  projectPath: string,
  input: { auraId: string; characterName: string },
): Promise<MessageScopedSoulBinding> {
  const characterName = input.characterName.trim()
  if (!characterName) throw new Error("请选择要把角色灵魂绑定到哪个小说人物")
  const bindings = await getCharacterAuraBindings(projectPath)
  const previousBinding = bindings.find((binding) => binding.characterName === characterName) ?? null
  await bindCharacterAura(projectPath, { characterName, auraId: input.auraId })
  return { characterName, auraId: input.auraId, previousBinding }
}

/**
 * 还原 `beginMessageScopedSoulBinding` 造成的写入。
 *
 * 两个分支各自对应一种原状态（见文件头注释），**没有任何一个分支会误删
 * 用户原有的绑定**：
 *   - 原本没有该人物的绑定 ⇒ 删掉临时那条；
 *   - 原本有绑定（同一条或另一条都一样）⇒ 用快照**完整**写回，`aliases` 一并还原。
 *
 * ⚠️ 「原本就是同一条」在这里**不是**一个可以跳过的分支，理由见下面那段注释：
 * 临时写入本身就会丢掉 `aliases`，所以「同一条」时盘上已经与原样不同了。
 *
 * ⚠️ 还原本身也可能失败（灵魂在生成期间被删、人物档案在生成期间被删）。
 * 这里**不吞**：抛出去由调用方报给用户，因为「临时绑定没还回去」
 * 与「用户的原有绑定丢了」都是用户必须知道的状态，静默吞掉会让人以为一切正常。
 */
export async function releaseMessageScopedSoulBinding(
  projectPath: string,
  binding: MessageScopedSoulBinding,
): Promise<void> {
  const previous = binding.previousBinding
  if (!previous) {
    await unbindCharacterAura(projectPath, binding.characterName, binding.auraId)
    return
  }
  /*
   * 有原绑定 ⇒ **一律**把快照写回，不设「看着没变就跳过」的短路。
   *
   * ⚠️ 这里曾经写成 `if (previous.auraId === binding.auraId) return`，那是错的
   * （探针实测）：`beginMessageScopedSoulBinding` 递进 `bindCharacterAura` 的只有
   * `{ characterName, auraId }`，而 `bindCharacterAura` 落盘的是
   * `{ ...binding, characterName }` —— 也就是说**临时写入这一步就已经把原绑定的
   * `aliases` 抹掉了**（盘上那条只剩 characterName + auraId）。
   * 所以「同一条灵魂」时盘上**并不是**原样：短路返回等于把用户的别名永久删掉。
   * 而 `buildCharacterSoulContext` 的匹配正是靠 `aliases` 认人的（别名命中会让
   * 这条灵魂进入上下文）⇒ 后果不只是界面显示，是上下文内容变了。
   * ⇒ 「按快照还原」必须是**写回**，而不是「看着一样就不动」。
   *
   * 代价是「本来就完全一致」时也写一次盘（内容不变）。这个多余写入是刻意的：
   * 少写一次的收益很小，而「靠比较猜是否一致」一旦漏掉某个字段就是又一次静默丢数据。
   */
  await bindCharacterAura(projectPath, previous)
}

/**
 * 确认弹窗里告诉用户这条灵魂的**影响范围**（风险 7：子串误匹配）。
 *
 * 措辞必须与 `buildCharacterSoulContext` 的匹配实现一致，不要写得更严格或更宽松：
 * 那里是 `matchingText.includes(binding.characterName)` 一类的**裸包含**判断
 * （外加同名拼音包含、简繁包含），所以
 *   - 名字比目标更长的人名也会命中（「李四」命中「李四光」）；
 *   - 同音词也会命中（拼音包含）；
 *   - 繁体/简体写法都会命中；
 *   - **没有**任何章节范围、场景或关系过滤。
 * 用户的决定只在「绑给谁」这一步，影响范围是这条绑定**固有**的性质，
 * 只能如实说出来，不能靠 UI 假装它更窄。
 */
export function describeSoulBlastRadius(characterName: string): string {
  const name = characterName.trim() || "该人物"
  return `绑定期间，只要本次任务或章纲文本里出现「${name}」，这条灵魂就会进入上下文。`
    + `匹配是包含式的（还包含拼音与简繁写法）：名字里含「${name}」的更长的词、以及同音词同样会命中；`
    + `也不会按章节范围过滤。`
}

/**
 * 确认弹窗里对「带人格规则的灵魂」的风险说明（风险 6）。
 *
 * ⚠️ 这**不是**预算结论，只是把失败模式提前说清楚：本批**没有**做预算预检
 * （做不了忠实的预检 —— 需要先把真正的 `contextPack` 建出来才能判断，
 * 而那正是生成阶段才会发生的事；用启发式猜一个「超预算」只会是又一条
 * 「宣称了代码产生不了的行为」）。这里如实说明「会停机、停机时提示什么、
 * 用户可以怎么处理」，与 `context-engine.ts` 的 fail-closed 断言逐字对应。
 *
 * ⚠️ 写作链上还有一处**等价的**停机（`deep-chapter-generation.ts` 的人格约束断言），
 * 它的文案不同（「角色人格规则没有完整进入写作请求，已停止生成…」）。
 * 这里不把那句话也抄进来：本弹窗说的是「预算装不下人格规则」这一类失败，
 * 两处文案各自成立，抄一半会让人以为只有一条路径会停。
 */
export function describePortablePersonalityRisk(): string {
  return "这条灵魂带有人格规则。人格规则不允许被静默裁剪："
    + "若本次上下文预算装不下它，生成会停下并提示「上下文预算不足，角色人格规则未完整保留」，"
    + "而不是悄悄丢掉这条灵魂。遇到它时请缩小本次章节范围或改用更大上下文的模型。"
}

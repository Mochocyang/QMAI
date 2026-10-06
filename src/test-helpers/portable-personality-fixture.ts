export const personality = {
  version: 1,
  summary: "求生与守底线并存。",
  scope: "仅为前期取样。",
  rules: [
    { id: "R1", field: "mentalModel", condition: "资料不足", tendency: "先提出假设，再核验；不能直接定罪", boundary: "允许试探，不允许把猜测当成事实", evidenceIds: ["E1"] },
    { id: "R2", field: "expressionDna", condition: "与亲近者相处", tendency: "嘴硬但用具体行动照顾对方", boundary: "紧迫危险中停止玩笑", evidenceIds: ["E2"] },
  ],
  evidence: [
    { id: "E1", chapterId: "c1", quote: "他以前是警察，这时先索取卷宗再作判断。" },
    { id: "E2", chapterId: "c2", quote: "他嘴上嫌弃，还是把仅有的盘缠交给妹妹。" },
  ],
}

export const portabilityApproval = {
  checks: ["summary", ...personality.rules.map((rule) => rule.id)].map((id) => ({
    id, portable: true, supported: true, reason: "倾向有依据且不要求原型知识。",
  })),
}

import type { FactRecord } from "./fact-model";

export const projectVerifiedEntries = (facts: FactRecord[]): FactRecord[] =>
  facts.filter((fact) => fact.canon_status === "verified");

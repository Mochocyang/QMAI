import type { FactRecord } from "./fact-model";

export interface ActiveGraphEdge {
  fact_id: string;
  source: string;
  relation: string;
  target: string;
  active: true;
}

export const projectActiveEdges = (facts: FactRecord[]): ActiveGraphEdge[] =>
  facts
    .filter((fact) => fact.canon_status === "verified")
    .map((fact) => ({
      fact_id: fact.fact_id,
      source: fact.subject_id,
      relation: fact.predicate,
      target: fact.object_id_or_value,
      active: true,
    }));

export type CanonStatus = "candidate" | "verified" | "rejected" | "pending_review";

export interface FactRecord {
  fact_id: string;
  fact_type: string;
  subject_id: string;
  predicate: string;
  object_id_or_value: string;
  time_scope: string;
  chapter_ref: string;
  evidence_anchor: string;
  confidence: number;
  canon_status: CanonStatus;
}

export const createFactRecord = (partial: Partial<FactRecord>): FactRecord => ({
  fact_id: partial.fact_id ?? "fact:test",
  fact_type: partial.fact_type ?? "event",
  subject_id: partial.subject_id ?? "entity:test",
  predicate: partial.predicate ?? "does",
  object_id_or_value: partial.object_id_or_value ?? "value:test",
  time_scope: partial.time_scope ?? "chapter",
  chapter_ref: partial.chapter_ref ?? "ch-1@v1",
  evidence_anchor: partial.evidence_anchor ?? "p1:s1",
  confidence: partial.confidence ?? 0.8,
  canon_status: partial.canon_status ?? "candidate",
});

export const canPromoteFactToGraph = (fact: FactRecord): boolean => fact.canon_status === "verified";

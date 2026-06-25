import type { CanonStatus } from "./fact-model";

export interface FactEvent {
  fact_id: string;
  from: CanonStatus;
  to: CanonStatus;
  fact_batch_id: string;
  at?: number;
}

export interface FactStore {
  append: (event: FactEvent) => void;
  timeline: (factId: string) => FactEvent[];
  batch: (factBatchId: string) => FactEvent[];
}

export const createInMemoryFactStore = (): FactStore => {
  const events: FactEvent[] = [];
  return {
    append(event) {
      events.push({ ...event, at: event.at ?? Date.now() });
    },
    timeline(factId) {
      return events.filter((event) => event.fact_id === factId);
    },
    batch(factBatchId) {
      return events.filter((event) => event.fact_batch_id === factBatchId);
    },
  };
};

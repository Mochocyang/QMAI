import { describe, expect, it, vi } from "vitest";

const { getStateMock } = vi.hoisted(() => ({
  getStateMock: vi.fn(),
}));

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: getStateMock,
  },
}));

import { resolveReviewModel } from "./review-model";

describe("resolveReviewModel", () => {
  it("returns trimmed review model from store", () => {
    getStateMock.mockReturnValue({
      novelConfig: { reviewModel: "  review-model-v1  " },
    });

    expect(resolveReviewModel()).toBe("review-model-v1");
  });

  it("returns empty string when review model is blank", () => {
    getStateMock.mockReturnValue({
      novelConfig: { reviewModel: "   " },
    });

    expect(resolveReviewModel()).toBe("");
  });
});

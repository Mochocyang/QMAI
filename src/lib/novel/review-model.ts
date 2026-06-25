import { useWikiStore } from "@/stores/wiki-store"

export function resolveReviewModel(): string {
  const reviewModel = useWikiStore.getState().novelConfig.reviewModel
  return reviewModel?.trim() || ""
}


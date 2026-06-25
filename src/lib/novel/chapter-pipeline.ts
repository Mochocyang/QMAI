import type { IngestResult } from "./chapter-ingest";
import { resolveReviewModel } from "./review-model";

export interface ChapterPipelineDeps {
  ingestChapter: (projectPath: string, chapterPath: string, reviewModel: string) => Promise<IngestResult>;
}

export type ChapterPipeline = (projectPath: string, chapterPath: string) => Promise<IngestResult>;

export const createChapterPipeline = (deps: ChapterPipelineDeps): ChapterPipeline => {
  return async (projectPath, chapterPath) => {
    const reviewModel = resolveReviewModel();
    return deps.ingestChapter(projectPath, chapterPath, reviewModel);
  };
};

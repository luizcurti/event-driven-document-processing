import { MergeResultsUseCase } from "../contexts/document-processing/application/use-cases/merge-results-use-case";
import { OcrResult, ThumbnailResult, ValidationResult } from "../shared/contracts/events";
import { withMetrics } from "../shared/infrastructure/metrics/metrics";

interface MergeEvent {
  documentId: string;
  ocr: OcrResult;
  thumbnail: ThumbnailResult;
  validation: ValidationResult;
}

const mergeResultsHandler = async (event: MergeEvent) => {
  const useCase = new MergeResultsUseCase();
  return useCase.execute(event);
};

export const handler = withMetrics("merge-results", mergeResultsHandler);

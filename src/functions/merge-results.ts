import { Handler } from "aws-lambda";
import { MergeResultsUseCase } from "../contexts/document-processing/application/use-cases/merge-results-use-case";
import { OcrResult, ThumbnailResult, ValidationResult } from "../shared/contracts/events";

interface MergeEvent {
  documentId: string;
  ocr: OcrResult;
  thumbnail: ThumbnailResult;
  validation: ValidationResult;
}

export const handler: Handler<MergeEvent> = async (event) => {
  const useCase = new MergeResultsUseCase();
  return useCase.execute(event);
};

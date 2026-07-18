import {
  MergedProcessingResult,
  OcrResult,
  ThumbnailResult,
  ValidationResult
} from "../../../../shared/contracts/events";

export class MergeResultsUseCase {
  execute(input: {
    documentId: string;
    ocr: OcrResult;
    thumbnail: ThumbnailResult;
    validation: ValidationResult;
  }): MergedProcessingResult {
    return {
      documentId: input.documentId,
      ocr: input.ocr,
      thumbnail: input.thumbnail,
      validation: input.validation,
      processedAt: new Date().toISOString()
    };
  }
}

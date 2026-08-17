import { OcrResult } from "../../../../shared/contracts/events";

export interface OcrExtractionInput {
  documentId: string;
  bucket: string;
  key: string;
  taskToken?: string;
}

export interface OcrProvider {
  /**
   * Starts text extraction. Returns the result directly when it could be resolved
   * synchronously (local mock, or a direct invocation with no task token to resume
   * later). Returns `null` when a real async Textract job was started and a task
   * token was handed off to be resolved later by the Textract-completion callback.
   */
  startExtraction(input: OcrExtractionInput): Promise<OcrResult | null>;
}

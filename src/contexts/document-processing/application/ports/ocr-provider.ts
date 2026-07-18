import { OcrResult } from "../../../../shared/contracts/events";

export interface OcrProvider {
  extractText(documentId: string, bucket: string, key: string): Promise<OcrResult>;
}

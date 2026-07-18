import { ProcessingRequest } from "../../../../shared/contracts/events";
import { OcrProvider } from "../ports/ocr-provider";

export class ProcessOcrUseCase {
  constructor(private readonly ocrProvider: OcrProvider) {}

  execute(request: ProcessingRequest) {
    return this.ocrProvider.extractText(request.documentId, request.bucket, request.key);
  }
}

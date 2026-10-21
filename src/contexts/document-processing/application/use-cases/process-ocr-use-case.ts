import { OcrResult } from "../../../../shared/contracts/events";
import { OcrExtractionInput, OcrProvider } from "../ports/ocr-provider";

export class ProcessOcrUseCase {
  constructor(private readonly ocrProvider: OcrProvider) {}

  execute(request: OcrExtractionInput): Promise<OcrResult | null> {
    return this.ocrProvider.startExtraction(request);
  }
}

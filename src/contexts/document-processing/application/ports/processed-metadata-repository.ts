import { MergedProcessingResult } from "../../../../shared/contracts/events";

export interface ProcessedMetadataRepository {
  save(result: MergedProcessingResult): Promise<void>;
  saveFailure(input: {
    documentId: string;
    errorMessage: string;
    failedAt: string;
  }): Promise<void>;
}

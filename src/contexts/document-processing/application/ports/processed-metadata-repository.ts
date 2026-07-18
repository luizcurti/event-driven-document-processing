import { MergedProcessingResult } from "../../../../shared/contracts/events";

export interface ProcessedMetadataRepository {
  save(result: MergedProcessingResult): Promise<void>;
}

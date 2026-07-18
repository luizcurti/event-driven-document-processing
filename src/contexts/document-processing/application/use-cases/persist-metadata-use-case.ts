import { MergedProcessingResult } from "../../../../shared/contracts/events";
import { ProcessedMetadataRepository } from "../ports/processed-metadata-repository";
import { QueuePublisher } from "../ports/queue-publisher";

export class PersistMetadataUseCase {
  constructor(
    private readonly repository: ProcessedMetadataRepository,
    private readonly queuePublisher: QueuePublisher
  ) {}

  async execute(payload: MergedProcessingResult): Promise<void> {
    await this.repository.save(payload);
    await this.queuePublisher.publish({
      type: "DOCUMENT_PROCESSED",
      documentId: payload.documentId,
      processedAt: payload.processedAt
    });
  }
}

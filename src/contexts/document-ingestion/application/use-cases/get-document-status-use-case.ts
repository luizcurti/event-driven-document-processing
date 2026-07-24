import { DocumentStatusRecord, MetadataRepository } from "../ports/metadata-repository";

export class GetDocumentStatusUseCase {
  constructor(private readonly metadataRepository: MetadataRepository) {}

  execute(documentId: string): Promise<DocumentStatusRecord | null> {
    return this.metadataRepository.findByDocumentId(documentId);
  }
}

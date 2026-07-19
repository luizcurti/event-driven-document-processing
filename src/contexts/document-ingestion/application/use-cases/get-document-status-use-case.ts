import { MetadataRepository } from "../ports/metadata-repository";

export class GetDocumentStatusUseCase {
  constructor(private readonly metadataRepository: MetadataRepository) {}

  async execute(documentId: string): Promise<
    | {
        documentId: string;
        status: string;
        createdAt?: string;
        updatedAt?: string;
        errorMessage?: string;
      }
    | null
  > {
    return this.metadataRepository.findByDocumentId(documentId);
  }
}

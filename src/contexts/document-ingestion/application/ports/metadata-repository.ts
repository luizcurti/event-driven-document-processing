import { Document } from "../../domain/entities/document";

export interface MetadataRepository {
  saveInitial(document: Document): Promise<void>;
  findByDocumentId(documentId: string): Promise<
    | {
        documentId: string;
        status: string;
        createdAt?: string;
        updatedAt?: string;
        errorMessage?: string;
      }
    | null
  >;
}

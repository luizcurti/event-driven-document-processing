import { Document } from "../../domain/entities/document";

export interface DocumentStatusRecord {
  documentId: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  errorMessage?: string;
}

export interface MetadataRepository {
  saveInitial(document: Document): Promise<void>;
  markProcessing(documentId: string): Promise<void>;
  findByDocumentId(documentId: string): Promise<DocumentStatusRecord | null>;
}

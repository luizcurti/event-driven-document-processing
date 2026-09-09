import { Document } from "../../domain/entities/document";

// Thrown by saveInitial when documentId (client-suppliable via the upload request
// body) collides with an existing document's metadata record — without this, a
// second upload reusing someone else's documentId would silently overwrite their
// record instead of being rejected.
export class DocumentIdConflictError extends Error {
  constructor(documentId: string) {
    super(`A document with id ${documentId} already exists`);
    this.name = "DocumentIdConflictError";
  }
}

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

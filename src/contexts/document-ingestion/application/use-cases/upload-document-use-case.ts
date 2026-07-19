import { Document } from "../../domain/entities/document";
import { DocumentStatus } from "../../../../shared/domain/document-status";
import { IdempotencyService } from "../ports/idempotency-service";
import { MetadataRepository } from "../ports/metadata-repository";
import { ObjectStorage } from "../ports/object-storage";
import { randomUUID } from "node:crypto";

export interface UploadDocumentCommand {
  requestId: string;
  fileName: string;
  contentType: string;
  bucket: string;
  documentId?: string;
}

export class UploadDocumentUseCase {
  constructor(
    private readonly metadataRepository: MetadataRepository,
    private readonly objectStorage: ObjectStorage,
    private readonly idempotencyService: IdempotencyService
  ) {}

  async execute(
    command: UploadDocumentCommand
  ): Promise<{ documentId: string; key: string; uploadUrl: string }> {
    await this.idempotencyService.markProcessed(command.requestId);

    const documentId = command.documentId?.trim() || randomUUID();
    const key = `${documentId}/${command.fileName}`;
    const document = Document.create({
      id: documentId,
      originalFileName: command.fileName,
      contentType: command.contentType,
      status: DocumentStatus.RECEIVED
    });

    await this.metadataRepository.saveInitial(document);

    const uploadUrl = await this.objectStorage.generateUploadUrl({
      bucket: command.bucket,
      key,
      contentType: command.contentType
    });

    return { documentId, key, uploadUrl };
  }
}

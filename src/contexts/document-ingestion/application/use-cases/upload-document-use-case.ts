import { Document } from "../../domain/entities/document";
import { DocumentStatus } from "../../../../shared/domain/document-status";
import { IdempotencyService } from "../ports/idempotency-service";
import { MetadataRepository } from "../ports/metadata-repository";
import { ObjectStorage } from "../ports/object-storage";

export interface UploadDocumentCommand {
  requestId: string;
  documentId: string;
  fileName: string;
  contentType: string;
  contentBase64: string;
  bucket: string;
}

export class UploadDocumentUseCase {
  constructor(
    private readonly metadataRepository: MetadataRepository,
    private readonly objectStorage: ObjectStorage,
    private readonly idempotencyService: IdempotencyService
  ) {}

  async execute(command: UploadDocumentCommand): Promise<{ key: string }> {
    await this.idempotencyService.ensureNotProcessed(command.requestId);

    const key = `${command.documentId}/${command.fileName}`;
    const document = Document.create({
      id: command.documentId,
      originalFileName: command.fileName,
      contentType: command.contentType,
      status: DocumentStatus.RECEIVED
    });

    await this.metadataRepository.saveInitial(document);

    await this.objectStorage.putObject({
      bucket: command.bucket,
      key,
      contentBase64: command.contentBase64,
      contentType: command.contentType
    });

    await this.idempotencyService.markProcessed(command.requestId);

    return { key };
  }
}

import { describe, expect, it, vi } from "vitest";
import {
  UploadDocumentCommand,
  UploadDocumentUseCase
} from "../src/contexts/document-ingestion/application/use-cases/upload-document-use-case";
import { GetDocumentStatusUseCase } from "../src/contexts/document-ingestion/application/use-cases/get-document-status-use-case";
import { ProcessOcrUseCase } from "../src/contexts/document-processing/application/use-cases/process-ocr-use-case";
import { ProcessThumbnailUseCase } from "../src/contexts/document-processing/application/use-cases/process-thumbnail-use-case";
import { ValidateDocumentUseCase } from "../src/contexts/document-processing/application/use-cases/validate-document-use-case";
import { MergeResultsUseCase } from "../src/contexts/document-processing/application/use-cases/merge-results-use-case";
import { PersistMetadataUseCase } from "../src/contexts/document-processing/application/use-cases/persist-metadata-use-case";
import { SendNotificationUseCase } from "../src/contexts/notification/application/use-cases/send-notification-use-case";
import {
  MergedProcessingResult,
  ProcessingRequest
} from "../src/shared/contracts/events";

describe("use cases", () => {
  it("returns the repository result for document status", async () => {
    const repository = {
      findByDocumentId: vi.fn(async (documentId: string) => ({
        documentId,
        status: "PROCESSED",
        createdAt: "2026-07-19T00:00:00.000Z"
      }))
    };

    const result = await new GetDocumentStatusUseCase(repository).execute("doc-12345");

    expect(result).toEqual({
      documentId: "doc-12345",
      status: "PROCESSED",
      createdAt: "2026-07-19T00:00:00.000Z"
    });
    expect(repository.findByDocumentId).toHaveBeenCalledWith("doc-12345");
  });

  it("persists metadata, stores the object, and marks idempotency on upload", async () => {
    const sequence: string[] = [];
    const metadataRepository = {
      saveInitial: vi.fn(async () => {
        sequence.push("saveInitial");
      })
    };
    const objectStorage = {
      generateUploadUrl: vi.fn(async () => {
        sequence.push("generateUploadUrl");
        return "https://example.local/upload-url";
      })
    };
    const idempotency = {
      ensureNotProcessed: vi.fn(async () => undefined),
      markProcessed: vi.fn(async () => {
        sequence.push("markProcessed");
      })
    };

    const useCase = new UploadDocumentUseCase(
      metadataRepository,
      objectStorage,
      idempotency
    );

    const command: UploadDocumentCommand = {
      requestId: "req-123",
      documentId: "doc-12345",
      fileName: "invoice.pdf",
      contentType: "application/pdf",
      bucket: "bucket-a"
    };

    const result = await useCase.execute(command);

    expect(result).toEqual({
      documentId: "doc-12345",
      key: "doc-12345/invoice.pdf",
      uploadUrl: "https://example.local/upload-url"
    });
    expect(metadataRepository.saveInitial).toHaveBeenCalledOnce();
    expect(objectStorage.generateUploadUrl).toHaveBeenCalledWith({
      bucket: "bucket-a",
      key: "doc-12345/invoice.pdf",
      contentType: "application/pdf"
    });
    expect(idempotency.markProcessed).toHaveBeenCalledWith("req-123");
    expect(sequence).toEqual(["markProcessed", "saveInitial", "generateUploadUrl"]);
  });

  it("generates a documentId when one is not provided", async () => {
    const metadataRepository = {
      saveInitial: vi.fn(async () => undefined)
    };
    const objectStorage = {
      generateUploadUrl: vi.fn(async () => "https://example.local/upload-url")
    };
    const idempotency = {
      ensureNotProcessed: vi.fn(async () => undefined),
      markProcessed: vi.fn(async () => undefined)
    };

    const useCase = new UploadDocumentUseCase(
      metadataRepository,
      objectStorage,
      idempotency
    );

    const result = await useCase.execute({
      requestId: "req-456",
      fileName: "contract.pdf",
      contentType: "application/pdf",
      bucket: "bucket-a"
    });

    expect(result).toEqual({
      documentId: expect.any(String),
      key: `${result.documentId}/contract.pdf`,
      uploadUrl: "https://example.local/upload-url"
    });
    expect(result.documentId).toHaveLength(36);
    expect(metadataRepository.saveInitial).toHaveBeenCalledOnce();
    expect(objectStorage.generateUploadUrl).toHaveBeenCalledWith({
      bucket: "bucket-a",
      key: result.key,
      contentType: "application/pdf"
    });
  });

  it("delegates OCR, thumbnail, and validation use cases to their providers", async () => {
    const request: ProcessingRequest = {
      documentId: "doc-12345",
      bucket: "bucket-a",
      key: "doc-12345/invoice.pdf"
    };

    const ocrProvider = {
      extractText: vi.fn(async () => ({ textPreview: "abc", confidence: 0.91 }))
    };
    const thumbnailProvider = {
      generate: vi.fn(async () => ({
        thumbnailKey: "thumbnails/doc-12345.png",
        width: 320,
        height: 200
      }))
    };
    const validatorProvider = {
      validate: vi.fn(async () => ({ valid: true, reasons: [] as string[] }))
    };

    const ocrResult = await new ProcessOcrUseCase(ocrProvider).execute(request);
    const thumbResult = await new ProcessThumbnailUseCase(thumbnailProvider).execute(request);
    const validationResult = await new ValidateDocumentUseCase(validatorProvider).execute(
      request
    );

    expect(ocrResult).toEqual({ textPreview: "abc", confidence: 0.91 });
    expect(thumbResult).toEqual({
      thumbnailKey: "thumbnails/doc-12345.png",
      width: 320,
      height: 200
    });
    expect(validationResult).toEqual({ valid: true, reasons: [] });

    expect(ocrProvider.extractText).toHaveBeenCalledWith(
      "doc-12345",
      "bucket-a",
      "doc-12345/invoice.pdf"
    );
    expect(thumbnailProvider.generate).toHaveBeenCalledWith(
      "doc-12345",
      "bucket-a",
      "doc-12345/invoice.pdf"
    );
    expect(validatorProvider.validate).toHaveBeenCalledWith(
      "doc-12345",
      "bucket-a",
      "doc-12345/invoice.pdf"
    );
  });

  it("creates a processing payload with timestamp when merging results", () => {
    const merged = new MergeResultsUseCase().execute({
      documentId: "doc-12345",
      ocr: { textPreview: "abc", confidence: 0.9 },
      thumbnail: { thumbnailKey: "thumbnails/doc-12345.png", width: 320, height: 200 },
      validation: { valid: true, reasons: [] }
    });

    expect(merged.documentId).toBe("doc-12345");
    expect(merged.ocr.textPreview).toBe("abc");
    expect(merged.validation.valid).toBe(true);
    expect(new Date(merged.processedAt).toString()).not.toBe("Invalid Date");
  });

  it("writes to the repository and publishes the queue event when persisting metadata", async () => {
    const repository = { save: vi.fn(async () => undefined) };
    const queue = { publish: vi.fn(async () => undefined) };

    const payload: MergedProcessingResult = {
      documentId: "doc-12345",
      ocr: { textPreview: "abc", confidence: 0.9 },
      thumbnail: { thumbnailKey: "thumbnails/doc-12345.png", width: 320, height: 200 },
      validation: { valid: true, reasons: [] },
      processedAt: new Date().toISOString()
    };

    await new PersistMetadataUseCase(repository, queue).execute(payload);

    expect(repository.save).toHaveBeenCalledWith(payload);
    expect(queue.publish).toHaveBeenCalledWith({
      type: "DOCUMENT_PROCESSED",
      documentId: "doc-12345",
      processedAt: payload.processedAt
    });
  });

  it("delegates notification sending to the sender", async () => {
    const sender = { send: vi.fn(async () => undefined) };
    const useCase = new SendNotificationUseCase(sender);

    await useCase.execute({
      documentId: "doc-12345",
      message: "Document processed successfully"
    });

    expect(sender.send).toHaveBeenCalledWith({
      documentId: "doc-12345",
      message: "Document processed successfully"
    });
  });

  it("keeps the same documentId end-to-end in an integration-like business flow", async () => {
    let persistedResult: MergedProcessingResult | null = null;
    let queueEvent: Record<string, unknown> | null = null;
    let notificationPayload: { documentId: string; message: string } | null = null;

    const upload = new UploadDocumentUseCase(
      {
        saveInitial: vi.fn(async () => undefined)
      },
      {
        generateUploadUrl: vi.fn(async () => "https://example.local/upload-url")
      },
      {
        ensureNotProcessed: vi.fn(async () => undefined),
        markProcessed: vi.fn(async () => undefined)
      }
    );

    const uploadResult = await upload.execute({
      requestId: "req-int-1",
      documentId: "doc-integration-0001",
      fileName: "payslip.pdf",
      contentType: "application/pdf",
      bucket: "bucket-int"
    });

    const request: ProcessingRequest = {
      documentId: uploadResult.key.split("/")[0] ?? "",
      bucket: "bucket-int",
      key: uploadResult.key
    };

    const ocr = await new ProcessOcrUseCase({
      extractText: vi.fn(async () => ({ textPreview: "texto", confidence: 0.95 }))
    }).execute(request);

    const thumbnail = await new ProcessThumbnailUseCase({
      generate: vi.fn(async () => ({
        thumbnailKey: "thumbnails/doc-integration-0001.png",
        width: 320,
        height: 200
      }))
    }).execute(request);

    const validation = await new ValidateDocumentUseCase({
      validate: vi.fn(async () => ({ valid: true, reasons: [] }))
    }).execute(request);

    const merged = new MergeResultsUseCase().execute({
      documentId: request.documentId,
      ocr,
      thumbnail,
      validation
    });

    await new PersistMetadataUseCase(
      {
        save: vi.fn(async (result: MergedProcessingResult) => {
          persistedResult = result;
        })
      },
      {
        publish: vi.fn(async (message: Record<string, unknown>) => {
          queueEvent = message;
        })
      }
    ).execute(merged);

    await new SendNotificationUseCase({
      send: vi.fn(async (payload: { documentId: string; message: string }) => {
        notificationPayload = payload;
      })
    }).execute({
      documentId: merged.documentId,
      message: "Document processed successfully"
    });

    expect(uploadResult.key).toBe("doc-integration-0001/payslip.pdf");
    expect(request.documentId).toBe("doc-integration-0001");
    expect(persistedResult?.documentId).toBe("doc-integration-0001");
    expect(queueEvent?.documentId).toBe("doc-integration-0001");
    expect(notificationPayload?.documentId).toBe("doc-integration-0001");
  });
});
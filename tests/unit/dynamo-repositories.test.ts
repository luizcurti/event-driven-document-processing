import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AwsDynamoMetadataRepository } from "../../src/contexts/document-ingestion/infrastructure/adapters/aws-dynamo-metadata-repository";
import { AwsDynamoProcessedMetadataRepository } from "../../src/contexts/document-processing/infrastructure/adapters/aws-dynamo-processed-metadata-repository";
import { Document } from "../../src/contexts/document-ingestion/domain/entities/document";
import { DocumentStatus } from "../../src/shared/domain/document-status";

// AwsDynamoMetadataRepository/AwsDynamoProcessedMetadataRepository wrap their injected
// client through DynamoDBDocumentClient.from(), which requires a real client's
// internal `.config`. Stubbing that static factory lets a plain in-memory fake stand
// in for DynamoDB without spinning up a real client or a network call.
let fromSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fromSpy = vi.spyOn(DynamoDBDocumentClient, "from");
});

afterEach(() => {
  fromSpy.mockRestore();
});

class FakeDocClient {
  private readonly items = new Map<string, Record<string, unknown>>();

  private itemKey(key: { pk: string; sk: string }): string {
    return `${key.pk}#${key.sk}`;
  }

  seed(key: { pk: string; sk: string }, item: Record<string, unknown>): void {
    this.items.set(this.itemKey(key), item);
  }

  async send(command: PutCommand | GetCommand | UpdateCommand): Promise<{ Item?: Record<string, unknown> }> {
    if (command instanceof PutCommand) {
      const item = command.input.Item as { pk: string; sk: string } & Record<string, unknown>;
      this.items.set(this.itemKey(item), item);
      return {};
    }

    if (command instanceof GetCommand) {
      const key = command.input.Key as { pk: string; sk: string };
      return { Item: this.items.get(this.itemKey(key)) };
    }

    if (command instanceof UpdateCommand) {
      const key = command.input.Key as { pk: string; sk: string };
      const itemKey = this.itemKey(key);
      const existing = this.items.get(itemKey) ?? { ...key };
      const values = command.input.ExpressionAttributeValues as Record<string, unknown>;
      this.items.set(itemKey, { ...existing, status: values[":status"], updatedAt: values[":now"] });
      return {};
    }

    throw new Error("Unsupported command in FakeDocClient");
  }

  asDocClient(): DynamoDBDocumentClient {
    return this as unknown as DynamoDBDocumentClient;
  }
}

describe("AwsDynamoMetadataRepository", () => {
  it("saves the initial upload metadata record", async () => {
    const client = new FakeDocClient();
    fromSpy.mockReturnValue(client.asDocClient());
    const repo = new AwsDynamoMetadataRepository("table");
    const document = Document.create({
      id: "doc-1",
      originalFileName: "invoice.pdf",
      contentType: "application/pdf",
      status: DocumentStatus.UPLOADED
    });

    await repo.saveInitial(document);

    const status = await repo.findByDocumentId("doc-1");
    expect(status?.status).toBe(DocumentStatus.UPLOADED);
  });

  it("returns null for a document that was never created", async () => {
    const client = new FakeDocClient();
    fromSpy.mockReturnValue(client.asDocClient());
    const repo = new AwsDynamoMetadataRepository("table");

    await expect(repo.findByDocumentId("does-not-exist")).resolves.toBeNull();
  });

  it("marks a document PROCESSING and reflects it via findByDocumentId", async () => {
    const client = new FakeDocClient();
    fromSpy.mockReturnValue(client.asDocClient());
    const repo = new AwsDynamoMetadataRepository("table");
    const document = Document.create({
      id: "doc-2",
      originalFileName: "invoice.pdf",
      contentType: "application/pdf",
      status: DocumentStatus.UPLOADED
    });
    await repo.saveInitial(document);

    await repo.markProcessing("doc-2");

    const status = await repo.findByDocumentId("doc-2");
    expect(status?.status).toBe(DocumentStatus.PROCESSING);
  });

  it("prioritizes the PROCESSING_RESULT record status over the initial METADATA record once both exist", async () => {
    const client = new FakeDocClient();
    client.seed(
      { pk: "DOCUMENT#doc-3", sk: "METADATA" },
      { status: "PROCESSING", createdAt: "2026-01-01T00:00:00.000Z" }
    );
    client.seed(
      { pk: "DOCUMENT#doc-3", sk: "PROCESSING_RESULT" },
      { status: "PROCESSED", updatedAt: "2026-01-01T00:05:00.000Z" }
    );
    fromSpy.mockReturnValue(client.asDocClient());
    const repo = new AwsDynamoMetadataRepository("table");

    const status = await repo.findByDocumentId("doc-3");

    expect(status).toEqual({
      documentId: "doc-3",
      status: "PROCESSED",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:05:00.000Z",
      errorMessage: undefined
    });
  });

  it("surfaces the errorMessage from a FAILED processing result", async () => {
    const client = new FakeDocClient();
    client.seed({ pk: "DOCUMENT#doc-4", sk: "METADATA" }, { status: "PROCESSING" });
    client.seed(
      { pk: "DOCUMENT#doc-4", sk: "PROCESSING_RESULT" },
      { status: "FAILED", errorMessage: "OCR failed" }
    );
    fromSpy.mockReturnValue(client.asDocClient());
    const repo = new AwsDynamoMetadataRepository("table");

    const status = await repo.findByDocumentId("doc-4");

    expect(status?.status).toBe("FAILED");
    expect(status?.errorMessage).toBe("OCR failed");
  });
});

describe("AwsDynamoProcessedMetadataRepository", () => {
  it("saves a successful processing result with status PROCESSED", async () => {
    const client = new FakeDocClient();
    fromSpy.mockReturnValue(client.asDocClient());
    const repo = new AwsDynamoProcessedMetadataRepository("table");

    await repo.save({
      documentId: "doc-5",
      ocr: { textPreview: "abc", confidence: 0.9 },
      thumbnail: { thumbnailKey: "thumbnails/doc-5.png", width: 320, height: 200 },
      validation: { valid: true, reasons: [] },
      processedAt: "2026-01-01T00:00:00.000Z"
    });

    const stored = await client.send(
      new GetCommand({ TableName: "table", Key: { pk: "DOCUMENT#doc-5", sk: "PROCESSING_RESULT" } })
    );
    expect(stored.Item?.status).toBe("PROCESSED");
    expect((stored.Item?.result as { documentId: string }).documentId).toBe("doc-5");
  });

  it("saves a failure record with status FAILED and the given errorMessage/failedAt", async () => {
    const client = new FakeDocClient();
    fromSpy.mockReturnValue(client.asDocClient());
    const repo = new AwsDynamoProcessedMetadataRepository("table");

    await repo.saveFailure({
      documentId: "doc-6",
      errorMessage: "Workflow execution failed",
      failedAt: "2026-01-01T00:10:00.000Z"
    });

    const stored = await client.send(
      new GetCommand({ TableName: "table", Key: { pk: "DOCUMENT#doc-6", sk: "PROCESSING_RESULT" } })
    );
    expect(stored.Item).toEqual({
      pk: "DOCUMENT#doc-6",
      sk: "PROCESSING_RESULT",
      entityType: "DOCUMENT_PROCESSING_RESULT",
      status: "FAILED",
      errorMessage: "Workflow execution failed",
      updatedAt: "2026-01-01T00:10:00.000Z"
    });
  });
});

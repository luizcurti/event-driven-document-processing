import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const saveInitialMock = vi.fn(async () => undefined);
const markProcessingMock = vi.fn(async () => undefined);
const generateUploadUrlMock = vi.fn(async () => "https://example.local/upload-url");
const withIdempotencyMock = vi.fn(async (_key: string, work: () => Promise<unknown>) => work());
const findByDocumentIdMock = vi.fn();

vi.mock("../../src/contexts/document-ingestion/infrastructure/adapters/aws-dynamo-metadata-repository", () => ({
  AwsDynamoMetadataRepository: vi.fn().mockImplementation(() => ({
    saveInitial: saveInitialMock,
    markProcessing: markProcessingMock,
    findByDocumentId: findByDocumentIdMock
  }))
}));

vi.mock("../../src/contexts/document-ingestion/infrastructure/adapters/aws-s3-object-storage", () => ({
  AwsS3ObjectStorage: vi.fn().mockImplementation(() => ({
    generateUploadUrl: generateUploadUrlMock
  }))
}));

vi.mock("../../src/contexts/document-ingestion/infrastructure/adapters/aws-dynamo-idempotency-service", () => ({
  AwsDynamoIdempotencyService: vi.fn().mockImplementation(() => ({
    withIdempotency: withIdempotencyMock
  }))
}));

function baseEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /documents",
    rawPath: "/documents",
    rawQueryString: "",
    headers: {},
    requestContext: {
      requestId: "req-fallback-id",
      http: { method: "POST", path: "/documents" }
    } as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    ...overrides
  } as APIGatewayProxyEventV2;
}

describe("uploadHandler", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    withIdempotencyMock.mockImplementation(async (_key: string, work: () => Promise<unknown>) => work());
    generateUploadUrlMock.mockResolvedValue("https://example.local/upload-url");
    process.env = { ...originalEnv, DOCUMENTS_METADATA_TABLE: "documents-metadata", DOCUMENTS_BUCKET: "documents-bucket" };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 500 with a ConfigurationError message when DOCUMENTS_METADATA_TABLE is missing", async () => {
    delete process.env.DOCUMENTS_METADATA_TABLE;
    const { uploadHandler } = await import(
      "../../src/contexts/document-ingestion/infrastructure/http/upload-handler"
    );

    const response = await uploadHandler(
      baseEvent({ body: JSON.stringify({ fileName: "a.pdf", contentType: "application/pdf" }) })
    );

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body as string).message).toContain("DOCUMENTS_METADATA_TABLE");
  });

  it("returns 400 for malformed JSON body", async () => {
    const { uploadHandler } = await import(
      "../../src/contexts/document-ingestion/infrastructure/http/upload-handler"
    );

    const response = await uploadHandler(baseEvent({ body: "{not-json" }));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body as string).message).toContain("must be valid JSON");
  });

  it("returns 400 when fileName is missing", async () => {
    const { uploadHandler } = await import(
      "../../src/contexts/document-ingestion/infrastructure/http/upload-handler"
    );

    const response = await uploadHandler(baseEvent({ body: JSON.stringify({ contentType: "application/pdf" }) }));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body as string).message).toContain("fileName is required");
  });

  it("returns 200 with documentId/uploadUrl/key on success and defaults contentType to application/pdf", async () => {
    const { uploadHandler } = await import(
      "../../src/contexts/document-ingestion/infrastructure/http/upload-handler"
    );

    const response = await uploadHandler(
      baseEvent({
        headers: { "x-idempotency-key": "req-abc" },
        body: JSON.stringify({ fileName: "invoice.pdf" })
      })
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body as string);
    expect(body.documentId).toEqual(expect.any(String));
    expect(body.key).toBe(`${body.documentId}/invoice.pdf`);
    expect(body.uploadUrl).toBe("https://example.local/upload-url");
    expect(withIdempotencyMock).toHaveBeenCalledWith("req-abc", expect.any(Function));
  });

  it("prefers the x-idempotency-key header over requestContext.requestId", async () => {
    const { uploadHandler } = await import(
      "../../src/contexts/document-ingestion/infrastructure/http/upload-handler"
    );

    await uploadHandler(
      baseEvent({
        headers: { "x-idempotency-key": "explicit-key" },
        requestContext: { requestId: "should-not-be-used", http: { method: "POST", path: "/documents" } } as never,
        body: JSON.stringify({ fileName: "a.pdf" })
      })
    );

    expect(withIdempotencyMock).toHaveBeenCalledWith("explicit-key", expect.any(Function));
  });

  it("falls back to requestContext.requestId when no idempotency header is present", async () => {
    const { uploadHandler } = await import(
      "../../src/contexts/document-ingestion/infrastructure/http/upload-handler"
    );

    await uploadHandler(
      baseEvent({
        requestContext: { requestId: "fallback-request-id", http: { method: "POST", path: "/documents" } } as never,
        body: JSON.stringify({ fileName: "a.pdf" })
      })
    );

    expect(withIdempotencyMock).toHaveBeenCalledWith("fallback-request-id", expect.any(Function));
  });

  it("returns 400 when the use case throws a plain business error", async () => {
    generateUploadUrlMock.mockRejectedValueOnce(new Error("bucket policy denied"));
    const { uploadHandler } = await import(
      "../../src/contexts/document-ingestion/infrastructure/http/upload-handler"
    );

    const response = await uploadHandler(baseEvent({ body: JSON.stringify({ fileName: "a.pdf" }) }));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body as string).message).toBe("bucket policy denied");
  });
});

describe("getDocumentStatusHandler", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, DOCUMENTS_METADATA_TABLE: "documents-metadata" };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 500 when DOCUMENTS_METADATA_TABLE is not configured", async () => {
    delete process.env.DOCUMENTS_METADATA_TABLE;
    const { getDocumentStatusHandler } = await import(
      "../../src/contexts/document-ingestion/infrastructure/http/get-document-status-handler"
    );

    const response = await getDocumentStatusHandler(
      baseEvent({ pathParameters: { documentId: "doc-1" } })
    );

    expect(response.statusCode).toBe(500);
  });

  it("returns 400 when documentId path parameter is missing", async () => {
    const { getDocumentStatusHandler } = await import(
      "../../src/contexts/document-ingestion/infrastructure/http/get-document-status-handler"
    );

    const response = await getDocumentStatusHandler(baseEvent({ pathParameters: {} }));

    expect(response.statusCode).toBe(400);
  });

  it("returns 404 when the document does not exist", async () => {
    findByDocumentIdMock.mockResolvedValueOnce(null);
    const { getDocumentStatusHandler } = await import(
      "../../src/contexts/document-ingestion/infrastructure/http/get-document-status-handler"
    );

    const response = await getDocumentStatusHandler(
      baseEvent({ pathParameters: { documentId: "doc-unknown" } })
    );

    expect(response.statusCode).toBe(404);
  });

  it("returns 200 with the document status on success, including a PROCESSING document", async () => {
    findByDocumentIdMock.mockResolvedValueOnce({
      documentId: "doc-2",
      status: "PROCESSING",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    const { getDocumentStatusHandler } = await import(
      "../../src/contexts/document-ingestion/infrastructure/http/get-document-status-handler"
    );

    const response = await getDocumentStatusHandler(
      baseEvent({ pathParameters: { documentId: "doc-2" } })
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body as string).status).toBe("PROCESSING");
  });
});

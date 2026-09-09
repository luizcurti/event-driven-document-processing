import { afterEach, describe, expect, it, vi } from "vitest";
import { Block } from "@aws-sdk/client-textract";
import {
  AwsOcrProvider,
  summarizeTextractBlocks
} from "../../src/contexts/document-processing/infrastructure/adapters/aws-ocr-provider";

describe("summarizeTextractBlocks", () => {
  it("returns an empty preview and zero confidence for no blocks", () => {
    expect(summarizeTextractBlocks([])).toEqual({ textPreview: "", confidence: 0 });
  });

  it("ignores non-LINE blocks and LINE blocks without text", () => {
    const blocks: Block[] = [
      { BlockType: "PAGE" },
      { BlockType: "LINE" },
      { BlockType: "WORD", Text: "ignored", Confidence: 99 }
    ];

    expect(summarizeTextractBlocks(blocks)).toEqual({ textPreview: "", confidence: 0 });
  });

  it("joins up to the first three LINE texts and averages confidence (0-1 scale)", () => {
    const blocks: Block[] = [
      { BlockType: "LINE", Text: "one", Confidence: 90 },
      { BlockType: "LINE", Text: "two", Confidence: 80 },
      { BlockType: "LINE", Text: "three", Confidence: 100 },
      { BlockType: "LINE", Text: "four (excluded from preview but counted in avg)", Confidence: 50 }
    ];

    const result = summarizeTextractBlocks(blocks);

    expect(result.textPreview).toBe("one two three");
    expect(result.confidence).toBe(0.8); // (90+80+100+50)/4/100
  });

  it("treats a missing Confidence as 0", () => {
    const blocks: Block[] = [{ BlockType: "LINE", Text: "solo" }];
    expect(summarizeTextractBlocks(blocks)).toEqual({ textPreview: "solo", confidence: 0 });
  });

  it("truncates the preview to 500 characters", () => {
    const longText = "x".repeat(600);
    const blocks: Block[] = [{ BlockType: "LINE", Text: longText, Confidence: 100 }];
    expect(summarizeTextractBlocks(blocks).textPreview).toHaveLength(500);
  });
});

describe("AwsOcrProvider", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  function clearAwsEnv(): void {
    delete process.env.AWS_EXECUTION_MODE;
    delete process.env.LOCALSTACK_ENABLED;
    delete process.env.AWS_ENDPOINT_URL;
    delete process.env.TEXTRACT_ROLE_ARN;
    delete process.env.TEXTRACT_TOPIC_ARN;
    delete process.env.DOCUMENTS_METADATA_TABLE;
  }

  it("returns a mock result without calling Textract in local mode", async () => {
    clearAwsEnv();
    process.env.AWS_EXECUTION_MODE = "local";
    const fakeClient = { send: vi.fn() };
    const provider = new AwsOcrProvider(fakeClient as never);

    const result = await provider.startExtraction({
      documentId: "doc-1",
      bucket: "bucket-a",
      key: "doc-1/file.pdf"
    });

    expect(result).toEqual({
      textPreview: "OCR local mock for bucket-a/doc-1/file.pdf",
      confidence: 0.99
    });
    expect(fakeClient.send).not.toHaveBeenCalled();
  });

  it("falls back to the synchronous Textract API when there is no task token (cloud mode)", async () => {
    clearAwsEnv();
    const fakeClient = {
      send: vi.fn(async () => ({
        Blocks: [{ BlockType: "LINE", Text: "hello", Confidence: 95 }]
      }))
    };
    const provider = new AwsOcrProvider(fakeClient as never);

    const result = await provider.startExtraction({
      documentId: "doc-2",
      bucket: "bucket-a",
      key: "doc-2/file.pdf"
    });

    expect(result).toEqual({ textPreview: "hello", confidence: 0.95 });
    expect(fakeClient.send).toHaveBeenCalledOnce();
  });

  it("starts an async job, stores the task token, and returns null when a task token is present (cloud mode)", async () => {
    clearAwsEnv();
    process.env.TEXTRACT_ROLE_ARN = "arn:aws:iam::000:role/textract";
    process.env.TEXTRACT_TOPIC_ARN = "arn:aws:sns:us-east-1:000:textract-completion";
    const fakeClient = { send: vi.fn(async () => ({ JobId: "job-123" })) };
    const fakeTaskTokenStore = { save: vi.fn(async () => undefined), consume: vi.fn() };
    const provider = new AwsOcrProvider(fakeClient as never, fakeTaskTokenStore as never);

    const result = await provider.startExtraction({
      documentId: "doc-3",
      bucket: "bucket-a",
      key: "doc-3/file.pdf",
      taskToken: "task-token-abc"
    });

    expect(result).toBeNull();
    expect(fakeTaskTokenStore.save).toHaveBeenCalledWith("job-123", {
      documentId: "doc-3",
      taskToken: "task-token-abc"
    });
  });

  it("throws when Textract does not return a JobId for the async job", async () => {
    clearAwsEnv();
    process.env.TEXTRACT_ROLE_ARN = "arn:aws:iam::000:role/textract";
    process.env.TEXTRACT_TOPIC_ARN = "arn:aws:sns:us-east-1:000:textract-completion";
    const fakeClient = { send: vi.fn(async () => ({})) };
    const provider = new AwsOcrProvider(fakeClient as never, { save: vi.fn(), consume: vi.fn() } as never);

    await expect(
      provider.startExtraction({
        documentId: "doc-4",
        bucket: "bucket-a",
        key: "doc-4/file.pdf",
        taskToken: "task-token-abc"
      })
    ).rejects.toThrow("Textract did not return a JobId");
  });

  it("throws a ConfigurationError when TEXTRACT_ROLE_ARN is missing for the async path", async () => {
    clearAwsEnv();
    process.env.TEXTRACT_TOPIC_ARN = "arn:aws:sns:us-east-1:000:textract-completion";
    const fakeClient = { send: vi.fn() };
    const provider = new AwsOcrProvider(fakeClient as never, { save: vi.fn(), consume: vi.fn() } as never);

    await expect(
      provider.startExtraction({
        documentId: "doc-5",
        bucket: "bucket-a",
        key: "doc-5/file.pdf",
        taskToken: "task-token-abc"
      })
    ).rejects.toThrow("TEXTRACT_ROLE_ARN");
  });
});

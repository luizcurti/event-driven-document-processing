import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { GetDocumentTextDetectionCommand, TextractClient } from "@aws-sdk/client-textract";
import { SendTaskFailureCommand, SendTaskSuccessCommand, SFNClient } from "@aws-sdk/client-sfn";
import { TextractTaskTokenStore } from "../../src/contexts/document-processing/infrastructure/adapters/textract-task-token-store";

// Same fake used by textract-task-token-store.test.ts: TextractTaskTokenStore always
// goes through DynamoDBDocumentClient.from(), so stubbing that static factory lets a
// plain in-memory map stand in for DynamoDB for both the seeding store and the one the
// handler constructs internally (they end up sharing the same fake data).
class FakeDocClient {
  private readonly items = new Map<string, Record<string, unknown>>();

  private itemKey(key: { pk: string; sk: string }): string {
    return `${key.pk}#${key.sk}`;
  }

  async send(command: PutCommand | DeleteCommand): Promise<{ Attributes?: Record<string, unknown> }> {
    if (command instanceof PutCommand) {
      const item = command.input.Item as { pk: string; sk: string } & Record<string, unknown>;
      this.items.set(this.itemKey(item), item);
      return {};
    }

    if (command instanceof DeleteCommand) {
      const key = this.itemKey(command.input.Key as { pk: string; sk: string });
      const existing = this.items.get(key);
      this.items.delete(key);
      return { Attributes: existing };
    }

    throw new Error("Unsupported command in FakeDocClient");
  }

  asDocClient(): DynamoDBDocumentClient {
    return this as unknown as DynamoDBDocumentClient;
  }
}

function snsEvent(notification: Record<string, unknown>) {
  return {
    Records: [
      {
        Sns: { Message: JSON.stringify(notification) }
      }
    ]
  };
}

describe("ocrCallbackHandler", () => {
  const originalEnv = { ...process.env };
  let fromSpy: MockInstance<typeof DynamoDBDocumentClient.from>;
  let textractSendSpy: MockInstance<typeof TextractClient.prototype.send>;
  let sfnSendSpy: MockInstance<typeof SFNClient.prototype.send>;
  let fakeClient: FakeDocClient;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DOCUMENTS_METADATA_TABLE = "documents-metadata";

    fakeClient = new FakeDocClient();
    fromSpy = vi.spyOn(DynamoDBDocumentClient, "from").mockReturnValue(fakeClient.asDocClient());
    textractSendSpy = vi.spyOn(TextractClient.prototype, "send");
    sfnSendSpy = vi.spyOn(SFNClient.prototype, "send").mockResolvedValue({} as never);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fromSpy.mockRestore();
    textractSendSpy.mockRestore();
    sfnSendSpy.mockRestore();
  });

  async function invoke(notification: Record<string, unknown>) {
    const { handler } = await import("../../src/functions/ocr-callback");
    return handler(snsEvent(notification) as never);
  }

  async function seedTaskToken(jobId: string, taskToken: string, documentId = "doc-1") {
    const store = new TextractTaskTokenStore("documents-metadata");
    await store.save(jobId, { documentId, taskToken });
  }

  it("resolves the waiting Step Functions task with the Textract summary on SUCCEEDED", async () => {
    await seedTaskToken("job-1", "token-1");
    textractSendSpy.mockResolvedValueOnce({
      Blocks: [{ BlockType: "LINE", Text: "hello world", Confidence: 90 }]
    } as never);

    await invoke({ JobId: "job-1", Status: "SUCCEEDED" });

    expect(textractSendSpy).toHaveBeenCalledWith(expect.any(GetDocumentTextDetectionCommand));
    expect(sfnSendSpy).toHaveBeenCalledOnce();
    const command = sfnSendSpy.mock.calls[0]![0] as SendTaskSuccessCommand;
    expect(command).toBeInstanceOf(SendTaskSuccessCommand);
    expect(command.input.taskToken).toBe("token-1");
    expect(JSON.parse(command.input.output as string)).toEqual({ textPreview: "hello world", confidence: 0.9 });
  });

  it("fails the waiting Step Functions task without calling Textract when the job status is not SUCCEEDED", async () => {
    await seedTaskToken("job-2", "token-2");

    await invoke({ JobId: "job-2", Status: "FAILED", StatusMessage: "corrupted document" });

    expect(textractSendSpy).not.toHaveBeenCalled();
    const command = sfnSendSpy.mock.calls[0]![0] as SendTaskFailureCommand;
    expect(command).toBeInstanceOf(SendTaskFailureCommand);
    expect(command.input.taskToken).toBe("token-2");
    expect(command.input.error).toBe("OcrJobFailed");
    expect(command.input.cause).toBe("corrupted document");
  });

  it("fails the waiting Step Functions task when fetching the Textract result throws", async () => {
    await seedTaskToken("job-3", "token-3");
    textractSendSpy.mockRejectedValueOnce(new Error("Textract throttled"));

    await invoke({ JobId: "job-3", Status: "SUCCEEDED" });

    const command = sfnSendSpy.mock.calls[0]![0] as SendTaskFailureCommand;
    expect(command).toBeInstanceOf(SendTaskFailureCommand);
    expect(command.input.taskToken).toBe("token-3");
    expect(command.input.error).toBe("OcrResultFetchFailure");
    expect(command.input.cause).toBe("Textract throttled");
  });

  it("ignores a duplicate SNS delivery for a JobId whose task token was already consumed", async () => {
    await seedTaskToken("job-4", "token-4");

    await invoke({ JobId: "job-4", Status: "SUCCEEDED" });
    sfnSendSpy.mockClear();
    textractSendSpy.mockClear();

    await invoke({ JobId: "job-4", Status: "SUCCEEDED" });

    expect(textractSendSpy).not.toHaveBeenCalled();
    expect(sfnSendSpy).not.toHaveBeenCalled();
  });

  it("ignores a notification for a JobId that was never registered", async () => {
    await invoke({ JobId: "unknown-job", Status: "SUCCEEDED" });

    expect(textractSendSpy).not.toHaveBeenCalled();
    expect(sfnSendSpy).not.toHaveBeenCalled();
  });
});

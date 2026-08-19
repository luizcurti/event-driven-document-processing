import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DynamoDBDocumentClient, DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { TextractTaskTokenStore } from "../../src/contexts/document-processing/infrastructure/adapters/textract-task-token-store";

// TextractTaskTokenStore wraps its injected client through DynamoDBDocumentClient.from(),
// which requires a real client's internal `.config`. Stubbing that static factory lets a
// plain in-memory fake stand in for DynamoDB without a real client or network call.
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

  async send(command: PutCommand | DeleteCommand): Promise<{ Attributes?: Record<string, unknown> }> {
    if (command instanceof PutCommand) {
      const item = command.input.Item as { pk: string; sk: string } & Record<string, unknown>;
      const key = this.itemKey(item);
      if (command.input.ConditionExpression === "attribute_not_exists(pk)" && this.items.has(key)) {
        const error = new Error("The conditional request failed");
        error.name = "ConditionalCheckFailedException";
        throw error;
      }
      this.items.set(key, item);
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

describe("TextractTaskTokenStore", () => {
  it("saves a task token and consumes it exactly once (delete-to-consume)", async () => {
    const client = new FakeDocClient();
    fromSpy.mockReturnValue(client.asDocClient());
    const store = new TextractTaskTokenStore("table");

    await store.save("job-1", { documentId: "doc-1", taskToken: "token-1" });

    const first = await store.consume("job-1");
    expect(first).toEqual({ documentId: "doc-1", taskToken: "token-1" });

    const second = await store.consume("job-1");
    expect(second).toBeNull();
  });

  it("returns null when consuming a JobId that was never saved", async () => {
    const client = new FakeDocClient();
    fromSpy.mockReturnValue(client.asDocClient());
    const store = new TextractTaskTokenStore("table");

    await expect(store.consume("unknown-job")).resolves.toBeNull();
  });

  it("rejects saving the same JobId twice (duplicate Textract start)", async () => {
    const client = new FakeDocClient();
    fromSpy.mockReturnValue(client.asDocClient());
    const store = new TextractTaskTokenStore("table");

    await store.save("job-2", { documentId: "doc-2", taskToken: "token-2" });

    await expect(store.save("job-2", { documentId: "doc-2", taskToken: "token-2b" })).rejects.toThrow(
      "conditional request failed"
    );
  });
});

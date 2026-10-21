import { describe, expect, it } from "vitest";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  AwsDynamoIdempotencyService,
  runIdempotent,
  withIdempotency
} from "../src/contexts/document-ingestion/infrastructure/adapters/aws-dynamo-idempotency-service";

/**
 * In-memory stand-in for DynamoDBDocumentClient covering exactly the three commands
 * withIdempotency issues (Put with a ConditionExpression, Get, Update), so the
 * atomic-claim / cache / fall-through-on-crash behavior can be tested without a real
 * DynamoDB.
 */
class FakeDocClient {
  private readonly items = new Map<string, Record<string, unknown>>();
  private nextPutError: Error | null = null;
  // Test hook for the "still genuinely in flight" scenario: after this many GetCommand
  // reads of a given item, the next read flips it to COMPLETED with completeWith.
  private completeAfterGets: { itemKey: string; getsRemaining: number; result: unknown } | null = null;

  private itemKey(key: { pk: string; sk: string }): string {
    return `${key.pk}#${key.sk}`;
  }

  async send(command: PutCommand | GetCommand | UpdateCommand): Promise<{
    Item?: Record<string, unknown>;
  }> {
    if (command instanceof PutCommand) {
      if (this.nextPutError) {
        const error = this.nextPutError;
        this.nextPutError = null;
        throw error;
      }
      const input = command.input;
      const item = input.Item as { pk: string; sk: string } & Record<string, unknown>;
      const itemKey = this.itemKey(item);
      if (input.ConditionExpression === "attribute_not_exists(pk)" && this.items.has(itemKey)) {
        const error = new Error("The conditional request failed");
        error.name = "ConditionalCheckFailedException";
        throw error;
      }
      this.items.set(itemKey, item);
      return {};
    }

    if (command instanceof GetCommand) {
      const key = command.input.Key as { pk: string; sk: string };
      const itemKey = this.itemKey(key);

      if (this.completeAfterGets && this.completeAfterGets.itemKey === itemKey) {
        this.completeAfterGets.getsRemaining -= 1;
        if (this.completeAfterGets.getsRemaining <= 0) {
          this.items.set(itemKey, {
            ...key,
            status: "COMPLETED",
            result: this.completeAfterGets.result
          });
          this.completeAfterGets = null;
        }
      }

      return { Item: this.items.get(itemKey) };
    }

    if (command instanceof UpdateCommand) {
      const key = command.input.Key as { pk: string; sk: string };
      const itemKey = this.itemKey(key);
      const existing = this.items.get(itemKey) ?? { ...key };
      const values = command.input.ExpressionAttributeValues as Record<string, unknown>;
      this.items.set(itemKey, {
        ...existing,
        status: values[":completed"],
        result: values[":result"]
      });
      return {};
    }

    throw new Error("Unsupported command in FakeDocClient");
  }

  // Test hook: simulates a previous attempt that claimed the key but crashed before
  // ever reaching the UpdateCommand that marks it COMPLETED.
  seedInProgress(key: { pk: string; sk: string }): void {
    this.items.set(this.itemKey(key), { ...key, status: "IN_PROGRESS" });
  }

  // Test hook: the key is IN_PROGRESS now, but the genuinely-concurrent original
  // caller finishes and marks it COMPLETED after `afterGets` more polling reads.
  seedInProgressThenCompleteAfter(key: { pk: string; sk: string }, afterGets: number, result: unknown): void {
    this.seedInProgress(key);
    this.completeAfterGets = { itemKey: this.itemKey(key), getsRemaining: afterGets, result };
  }

  throwOnNextPut(error: Error): void {
    this.nextPutError = error;
  }

  asDocClient(): DynamoDBDocumentClient {
    return this as unknown as DynamoDBDocumentClient;
  }
}

describe("withIdempotency", () => {
  it("claims a new key, runs the work once, and caches the result", async () => {
    const client = new FakeDocClient();
    let callCount = 0;

    const result = await withIdempotency(client.asDocClient(), "table", "event-1", async () => {
      callCount += 1;
      return { done: true };
    });

    expect(result).toEqual({ done: true });
    expect(callCount).toBe(1);
  });

  it("returns the cached result for a duplicate of an already-completed event, without re-running the work", async () => {
    const client = new FakeDocClient();
    let callCount = 0;

    const work = async () => {
      callCount += 1;
      return { attempt: callCount };
    };

    const first = await withIdempotency(client.asDocClient(), "table", "event-2", work);
    const second = await withIdempotency(client.asDocClient(), "table", "event-2", work);

    expect(first).toEqual({ attempt: 1 });
    expect(second).toEqual({ attempt: 1 });
    expect(callCount).toBe(1);
  });

  it("re-runs the work for a retry that arrives while the original attempt never completed (crash before COMPLETED)", async () => {
    const client = new FakeDocClient();
    client.seedInProgress({ pk: "IDEMPOTENCY#event-3", sk: "REQUEST" });
    let callCount = 0;

    const result = await withIdempotency(client.asDocClient(), "table", "event-3", async () => {
      callCount += 1;
      return { recovered: true };
    });

    // This is the regression test for the bug where a Step Functions retry after a
    // real transient failure returned a fabricated success instead of actually
    // retrying the operation. The record stays IN_PROGRESS for every poll in the
    // grace period (nothing ever completes it), so this also exercises the "grace
    // period fully exhausted" path added for the race below.
    expect(result).toEqual({ recovered: true });
    expect(callCount).toBe(1);
  });

  it("waits for a genuinely concurrent duplicate to finish and returns its cached result, without re-running work", async () => {
    const client = new FakeDocClient();
    // Regression test for a race: a naive read-then-decide on a losing claim would
    // see IN_PROGRESS and re-run `work` immediately, even though the winning call is
    // still actively running (not crashed) and about to publish a COMPLETED result.
    // Two concurrent duplicate requests must converge on one shared result, never two.
    client.seedInProgressThenCompleteAfter(
      { pk: "IDEMPOTENCY#event-6", sk: "REQUEST" },
      2,
      { wonTheRace: true }
    );
    let callCount = 0;

    const result = await withIdempotency(client.asDocClient(), "table", "event-6", async () => {
      callCount += 1;
      return { wonTheRace: false };
    });

    expect(result).toEqual({ wonTheRace: true });
    expect(callCount).toBe(0);
  });

  it("returns a legitimately undefined cached result without re-running work", async () => {
    const client = new FakeDocClient();
    // Regression test: a losing claimant must not mistake "completed with an
    // undefined result" for "not completed yet" and re-run already-finished work.
    client.seedInProgressThenCompleteAfter({ pk: "IDEMPOTENCY#event-7", sk: "REQUEST" }, 1, undefined);
    let callCount = 0;

    const result = await withIdempotency(client.asDocClient(), "table", "event-7", async () => {
      callCount += 1;
      return undefined;
    });

    expect(result).toBeUndefined();
    expect(callCount).toBe(0);
  });

  it("does not cache a result when the work throws (business/transient errors are not silently converted to success)", async () => {
    const client = new FakeDocClient();

    await expect(
      withIdempotency(client.asDocClient(), "table", "event-4", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    let secondCallRan = false;
    await expect(
      withIdempotency(client.asDocClient(), "table", "event-4", async () => {
        secondCallRan = true;
        return { ok: true };
      })
    ).resolves.toEqual({ ok: true });
    expect(secondCallRan).toBe(true);
  });

  it("propagates unexpected DynamoDB errors from the claim attempt instead of treating them as a duplicate", async () => {
    const client = new FakeDocClient();
    client.throwOnNextPut(Object.assign(new Error("throttled"), { name: "ProvisionedThroughputExceededException" }));

    await expect(
      withIdempotency(client.asDocClient(), "table", "event-5", async () => ({ ok: true }))
    ).rejects.toThrow("throttled");
  });
});

describe("AwsDynamoIdempotencyService", () => {
  it("delegates to withIdempotency using the injected doc client", async () => {
    const client = new FakeDocClient();
    const service = new AwsDynamoIdempotencyService("table", client.asDocClient());

    const result = await service.withIdempotency("service-event-1", async () => ({ ok: true }));

    expect(result).toEqual({ ok: true });
  });
});

describe("runIdempotent", () => {
  it("wires AwsDynamoIdempotencyService for handlers that don't go through the ports/DI wiring", async () => {
    const client = new FakeDocClient();
    let callCount = 0;

    const result = await runIdempotent(
      "table",
      "handler-event-1",
      async () => {
        callCount += 1;
        return { handled: true };
      },
      client.asDocClient()
    );

    expect(result).toEqual({ handled: true });
    expect(callCount).toBe(1);
  });
});

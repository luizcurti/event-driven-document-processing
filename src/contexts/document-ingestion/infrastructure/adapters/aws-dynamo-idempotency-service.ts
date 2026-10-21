import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { IdempotencyService } from "../../application/ports/idempotency-service";
import { getAwsClientConfig } from "../../../../shared/infrastructure/aws/aws-client-config";

function idempotencyKey(key: string) {
  return { pk: `IDEMPOTENCY#${key}`, sk: "REQUEST" };
}

// A losing claimant polls for this long before assuming the winner crashed. A single
// immediate read-then-decide (the pattern the idempotency spec explicitly warns
// against) would let two genuinely concurrent duplicate requests both observe
// IN_PROGRESS and both run `work` — producing two different results (e.g. two
// different documentIds) instead of one shared, cached one. Polling first gives the
// winner a real chance to finish and publish its COMPLETED result before this call
// gives up and treats the record as abandoned.
const DUPLICATE_POLL_ATTEMPTS = 6;
const DUPLICATE_POLL_INTERVAL_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PollOutcome<T> = { completed: true; result: T } | { completed: false };

// Returns a discriminated result rather than `T | undefined`: `work()` returning
// `undefined` is a legitimate result, and collapsing "completed with an undefined
// result" and "still not completed" into the same sentinel would make a losing
// claimant re-run already-finished work.
async function waitForCompletedResult<T>(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  key: string
): Promise<PollOutcome<T>> {
  for (let attempt = 0; attempt < DUPLICATE_POLL_ATTEMPTS; attempt += 1) {
    const existing = await docClient.send(
      new GetCommand({ TableName: tableName, Key: idempotencyKey(key) })
    );

    if (existing.Item?.status === "COMPLETED") {
      return { completed: true, result: existing.Item.result as T };
    }

    if (attempt < DUPLICATE_POLL_ATTEMPTS - 1) {
      await sleep(DUPLICATE_POLL_INTERVAL_MS);
    }
  }

  return { completed: false };
}

/**
 * Claims `key` atomically (PutItem + ConditionExpression, never a read-then-decide
 * race) before running `work`, and stores the result once `work` succeeds. A
 * duplicate call with a key that already finished returns the stored result without
 * re-running `work`. A duplicate call that arrives while the original attempt is
 * still genuinely in flight waits (briefly) for it to finish and returns its cached
 * result instead of re-running `work`. Only once that grace period elapses with the
 * record still `IN_PROGRESS` (the original attempt died before completing) does this
 * call fall through and re-run `work` itself — this is what makes Step
 * Functions/SQS retries after a genuine transient failure actually retry, instead of
 * returning a fabricated success.
 */
export async function withIdempotency<T>(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  key: string,
  work: () => Promise<T>
): Promise<T> {
  const claimed = await tryClaim(docClient, tableName, key);

  if (!claimed) {
    const outcome = await waitForCompletedResult<T>(docClient, tableName, key);

    if (outcome.completed) {
      return outcome.result;
    }
    // Still IN_PROGRESS after the grace period (or the record vanished): the
    // original attempt likely crashed, so fall through and actually do the work
    // instead of faking success.
  }

  const result = await work();

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: idempotencyKey(key),
      UpdateExpression: "SET #status = :completed, #result = :result, completedAt = :now",
      ExpressionAttributeNames: { "#status": "status", "#result": "result" },
      ExpressionAttributeValues: {
        ":completed": "COMPLETED",
        ":result": result,
        ":now": new Date().toISOString()
      }
    })
  );

  return result;
}

async function tryClaim(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  key: string
): Promise<boolean> {
  try {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...idempotencyKey(key),
          entityType: "IDEMPOTENCY",
          status: "IN_PROGRESS",
          createdAt: new Date().toISOString()
        },
        ConditionExpression: "attribute_not_exists(pk)"
      })
    );
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return false;
    }
    throw error;
  }
}

export class AwsDynamoIdempotencyService implements IdempotencyService {
  constructor(
    private readonly tableName: string,
    private readonly docClient: DynamoDBDocumentClient = DynamoDBDocumentClient.from(
      new DynamoDBClient(getAwsClientConfig("dynamodb"))
    )
  ) {}

  withIdempotency<T>(key: string, work: () => Promise<T>): Promise<T> {
    return withIdempotency(this.docClient, this.tableName, key, work);
  }
}

/**
 * Lambda-handler convenience wrapper around `withIdempotency` that owns its own
 * DynamoDB client, for the event-consuming Lambdas (OCR, Thumbnail, Validation,
 * Notification) that don't go through the ports/DI wiring used by the upload use case.
 * `docClient` is only ever overridden in tests; handlers call this with 3 arguments.
 */
export function runIdempotent<T>(
  tableName: string,
  eventId: string,
  work: () => Promise<T>,
  docClient?: DynamoDBDocumentClient
): Promise<T> {
  return new AwsDynamoIdempotencyService(tableName, docClient).withIdempotency(eventId, work);
}

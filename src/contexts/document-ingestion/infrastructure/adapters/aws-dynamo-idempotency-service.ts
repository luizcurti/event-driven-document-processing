import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { IdempotencyService } from "../../application/ports/idempotency-service";
import { getAwsClientConfig } from "../../../../shared/infrastructure/aws/aws-client-config";

function idempotencyKey(key: string) {
  return { pk: `IDEMPOTENCY#${key}`, sk: "REQUEST" };
}

/**
 * Claims `key` atomically (PutItem + ConditionExpression, never a read-then-decide
 * race) before running `work`, and stores the result once `work` succeeds. A
 * duplicate call with a key that already finished returns the stored result without
 * re-running `work`. A duplicate call that arrives while the original attempt is
 * still `IN_PROGRESS` (still running, or died before completing) re-runs `work` —
 * this is what makes Step Functions/SQS retries after a genuine transient failure
 * actually retry, instead of returning a fabricated success.
 */
export async function withIdempotency<T>(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  key: string,
  work: () => Promise<T>
): Promise<T> {
  const claimed = await tryClaim(docClient, tableName, key);

  if (!claimed) {
    const existing = await docClient.send(
      new GetCommand({ TableName: tableName, Key: idempotencyKey(key) })
    );

    if (existing.Item?.status === "COMPLETED") {
      return existing.Item.result as T;
    }
    // status is IN_PROGRESS (or the record vanished): the original attempt never
    // finished, so fall through and actually do the work instead of faking success.
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

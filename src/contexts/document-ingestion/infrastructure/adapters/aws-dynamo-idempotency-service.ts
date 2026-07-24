import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  AlreadyProcessedError,
  IdempotencyService
} from "../../application/ports/idempotency-service";
import { getAwsClientConfig } from "../../../../shared/infrastructure/aws/aws-client-config";

export class AwsDynamoIdempotencyService implements IdempotencyService {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    ddbClient = new DynamoDBClient(getAwsClientConfig("dynamodb"))
  ) {
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
  }

  async markProcessed(key: string): Promise<void> {
    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: `IDEMPOTENCY#${key}`,
            sk: "REQUEST",
            entityType: "IDEMPOTENCY",
            createdAt: new Date().toISOString()
          },
          ConditionExpression: "attribute_not_exists(pk)"
        })
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "ConditionalCheckFailedException"
      ) {
        throw new AlreadyProcessedError(key);
      }
      throw error;
    }
  }
}

/**
 * Marks an event as processed and reports whether it is new.
 * Consolidates the markProcessed/AlreadyProcessedError try-catch that was
 * duplicated across every event-consuming Lambda (OCR, Thumbnail, Validation,
 * Notification).
 */
export async function isNewEvent(tableName: string, eventId: string): Promise<boolean> {
  try {
    await new AwsDynamoIdempotencyService(tableName).markProcessed(eventId);
    return true;
  } catch (error) {
    if (error instanceof AlreadyProcessedError) {
      return false;
    }
    throw error;
  }
}

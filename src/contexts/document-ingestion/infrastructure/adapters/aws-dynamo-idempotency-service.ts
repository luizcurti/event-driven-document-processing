import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { IdempotencyService } from "../../application/ports/idempotency-service";
import { getAwsClientConfig } from "../../../../shared/infrastructure/aws/aws-client-config";

export class AwsDynamoIdempotencyService implements IdempotencyService {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    ddbClient = new DynamoDBClient(getAwsClientConfig("dynamodb"))
  ) {
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
  }

  async ensureNotProcessed(_key: string): Promise<void> {
    // Deprecated by atomic markProcessed (conditional put).
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
        throw new Error("Request already processed");
      }
      throw error;
    }
  }
}

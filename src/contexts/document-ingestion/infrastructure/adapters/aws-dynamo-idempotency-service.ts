import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { IdempotencyService } from "../../application/ports/idempotency-service";

export class AwsDynamoIdempotencyService implements IdempotencyService {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    ddbClient = new DynamoDBClient({})
  ) {
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
  }

  async ensureNotProcessed(key: string): Promise<void> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `IDEMPOTENCY#${key}`,
          sk: "REQUEST"
        }
      })
    );

    if (result.Item) {
      throw new Error("Request already processed");
    }
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

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { MergedProcessingResult } from "../../../../shared/contracts/events";
import { ProcessedMetadataRepository } from "../../application/ports/processed-metadata-repository";
import { getAwsClientConfig } from "../../../../shared/infrastructure/aws/aws-client-config";

export class AwsDynamoProcessedMetadataRepository implements ProcessedMetadataRepository {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    ddbClient = new DynamoDBClient(getAwsClientConfig("dynamodb"))
  ) {
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
  }

  async save(result: MergedProcessingResult): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `DOCUMENT#${result.documentId}`,
          sk: "PROCESSING_RESULT",
          entityType: "DOCUMENT_PROCESSING_RESULT",
          status: "PROCESSED",
          result,
          updatedAt: new Date().toISOString()
        }
      })
    );
  }

  async saveFailure(input: {
    documentId: string;
    errorMessage: string;
    failedAt: string;
  }): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `DOCUMENT#${input.documentId}`,
          sk: "PROCESSING_RESULT",
          entityType: "DOCUMENT_PROCESSING_RESULT",
          status: "FAILED",
          errorMessage: input.errorMessage,
          updatedAt: input.failedAt
        }
      })
    );
  }
}

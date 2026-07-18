import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { MetadataRepository } from "../../application/ports/metadata-repository";
import { Document } from "../../domain/entities/document";

export class AwsDynamoMetadataRepository implements MetadataRepository {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    ddbClient = new DynamoDBClient({})
  ) {
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
  }

  async saveInitial(document: Document): Promise<void> {
    const payload = document.toPrimitives();

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `DOCUMENT#${payload.id}`,
          sk: "METADATA",
          entityType: "DOCUMENT_METADATA",
          documentId: payload.id,
          originalFileName: payload.originalFileName,
          contentType: payload.contentType,
          status: payload.status,
          createdAt: payload.createdAt,
          updatedAt: payload.createdAt
        }
      })
    );
  }
}

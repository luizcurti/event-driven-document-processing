import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DocumentStatusRecord, MetadataRepository } from "../../application/ports/metadata-repository";
import { Document } from "../../domain/entities/document";
import { getAwsClientConfig } from "../../../../shared/infrastructure/aws/aws-client-config";

export class AwsDynamoMetadataRepository implements MetadataRepository {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    ddbClient = new DynamoDBClient(getAwsClientConfig("dynamodb"))
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

  async findByDocumentId(documentId: string): Promise<DocumentStatusRecord | null> {
    const [metadataResult, processingResult] = await Promise.all([
      this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: `DOCUMENT#${documentId}`,
            sk: "METADATA"
          }
        })
      ),
      this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: `DOCUMENT#${documentId}`,
            sk: "PROCESSING_RESULT"
          }
        })
      )
    ]);

    if (!metadataResult.Item && !processingResult.Item) {
      return null;
    }

    const status =
      (processingResult.Item?.status as string | undefined) ??
      (metadataResult.Item?.status as string | undefined) ??
      "UNKNOWN";

    return {
      documentId,
      status,
      createdAt: metadataResult.Item?.createdAt as string | undefined,
      updatedAt:
        (processingResult.Item?.updatedAt as string | undefined) ??
        (metadataResult.Item?.updatedAt as string | undefined),
      errorMessage: processingResult.Item?.errorMessage as string | undefined
    };
  }
}

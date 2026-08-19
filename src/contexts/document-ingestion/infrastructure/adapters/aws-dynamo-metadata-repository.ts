import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { DocumentStatusRecord, MetadataRepository } from "../../application/ports/metadata-repository";
import { Document } from "../../domain/entities/document";
import { DocumentStatus } from "../../../../shared/domain/document-status";
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

  async markProcessing(documentId: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: `DOCUMENT#${documentId}`,
          sk: "METADATA"
        },
        UpdateExpression: "SET #status = :status, updatedAt = :now",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": DocumentStatus.PROCESSING,
          ":now": new Date().toISOString()
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

    return this.mergeStatusRecord(documentId, metadataResult.Item, processingResult.Item);
  }

  /**
   * The processing-result record reflects the latest known state once the pipeline
   * has produced one, so it takes priority over the initial upload metadata record.
   */
  private mergeStatusRecord(
    documentId: string,
    metadataItem: Record<string, unknown> | undefined,
    processingItem: Record<string, unknown> | undefined
  ): DocumentStatusRecord {
    return {
      documentId,
      status: (processingItem?.status as string) ?? (metadataItem?.status as string) ?? "UNKNOWN",
      createdAt: metadataItem?.createdAt as string | undefined,
      updatedAt:
        (processingItem?.updatedAt as string | undefined) ??
        (metadataItem?.updatedAt as string | undefined),
      errorMessage: processingItem?.errorMessage as string | undefined
    };
  }
}

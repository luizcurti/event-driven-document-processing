import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getAwsClientConfig } from "../../../../shared/infrastructure/aws/aws-client-config";

function taskTokenKey(jobId: string) {
  return { pk: `TEXTRACT_JOB#${jobId}`, sk: "TASK_TOKEN" };
}

/**
 * Bridges an async Textract job (JobId) back to the Step Functions task token that is
 * waiting for it. `consume` is an atomic delete-and-return: the SNS notification that
 * gets there first wins the task token, and any duplicate delivery for the same JobId
 * (SNS at-least-once redelivery) finds nothing left to consume and is a safe no-op —
 * so the pipeline never calls SendTaskSuccess/Failure twice for the same job.
 */
export class TextractTaskTokenStore {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    ddbClient = new DynamoDBClient(getAwsClientConfig("dynamodb"))
  ) {
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
  }

  async save(jobId: string, input: { documentId: string; taskToken: string }): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...taskTokenKey(jobId),
          entityType: "TEXTRACT_TASK_TOKEN",
          documentId: input.documentId,
          taskToken: input.taskToken,
          createdAt: new Date().toISOString()
        },
        ConditionExpression: "attribute_not_exists(pk)"
      })
    );
  }

  async consume(jobId: string): Promise<{ documentId: string; taskToken: string } | null> {
    const result = await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: taskTokenKey(jobId),
        ReturnValues: "ALL_OLD"
      })
    );

    if (!result.Attributes) {
      return null;
    }

    return {
      documentId: result.Attributes.documentId as string,
      taskToken: result.Attributes.taskToken as string
    };
  }
}

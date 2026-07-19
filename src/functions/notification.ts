import { Handler, SQSEvent } from "aws-lambda";
import { SendNotificationUseCase } from "../contexts/notification/application/use-cases/send-notification-use-case";
import { AwsSnsNotificationSender } from "../contexts/notification/infrastructure/adapters/aws-sns-notification-sender";
import { AwsDynamoIdempotencyService } from "../contexts/document-ingestion/infrastructure/adapters/aws-dynamo-idempotency-service";

export const handler: Handler<SQSEvent> = async (event) => {
  const notificationTopicArn = process.env.NOTIFICATION_TOPIC_ARN ?? "";
  const metadataTable = process.env.DOCUMENTS_METADATA_TABLE ?? "";

  if (!notificationTopicArn || !metadataTable) {
    throw new Error("Lambda missing NOTIFICATION_TOPIC_ARN or DOCUMENTS_METADATA_TABLE");
  }

  const useCase = new SendNotificationUseCase(
    new AwsSnsNotificationSender(notificationTopicArn)
  );
  const idempotencyService = new AwsDynamoIdempotencyService(metadataTable);

  for (const record of event.Records) {
    try {
      await idempotencyService.markProcessed(`notification#${record.messageId}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already processed")) {
        continue;
      }
      throw error;
    }

    const body = JSON.parse(record.body);
    await useCase.execute({
      documentId: body.documentId,
      message: "Document processed successfully"
    });
  }

  return { ok: true };
};


import { Handler, SQSEvent } from "aws-lambda";
import { SendNotificationUseCase } from "../contexts/notification/application/use-cases/send-notification-use-case";
import { AwsSnsNotificationSender } from "../contexts/notification/infrastructure/adapters/aws-sns-notification-sender";
import { requireEnv } from "../shared/infrastructure/aws/aws-client-config";
import { isNewEvent } from "../contexts/document-ingestion/infrastructure/adapters/aws-dynamo-idempotency-service";

export const handler: Handler<SQSEvent> = async (event) => {
  const errorMessage = "Lambda missing NOTIFICATION_TOPIC_ARN or DOCUMENTS_METADATA_TABLE";
  const notificationTopicArn = requireEnv(process.env.NOTIFICATION_TOPIC_ARN, errorMessage);
  const metadataTable = requireEnv(process.env.DOCUMENTS_METADATA_TABLE, errorMessage);

  const useCase = new SendNotificationUseCase(
    new AwsSnsNotificationSender(notificationTopicArn)
  );

  for (const record of event.Records) {
    if (!(await isNewEvent(metadataTable, `notification#${record.messageId}`))) {
      continue;
    }

    const body = JSON.parse(record.body);
    await useCase.execute({
      documentId: body.documentId,
      message: "Document processed successfully"
    });
  }

  return { ok: true };
};


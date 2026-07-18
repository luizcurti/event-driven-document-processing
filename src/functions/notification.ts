import { Handler, SQSEvent } from "aws-lambda";
import { SendNotificationUseCase } from "../contexts/notification/application/use-cases/send-notification-use-case";
import { AwsSnsNotificationSender } from "../contexts/notification/infrastructure/adapters/aws-sns-notification-sender";

export const handler: Handler<SQSEvent> = async (event) => {
  const notificationTopicArn = process.env.NOTIFICATION_TOPIC_ARN ?? "";

  if (!notificationTopicArn) {
    throw new Error("Lambda missing NOTIFICATION_TOPIC_ARN");
  }

  const useCase = new SendNotificationUseCase(
    new AwsSnsNotificationSender(notificationTopicArn)
  );

  for (const record of event.Records) {
    const body = JSON.parse(record.body);
    await useCase.execute({
      documentId: body.documentId,
      message: "Documento processado com sucesso"
    });
  }

  return { ok: true };
};


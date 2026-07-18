import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { NotificationSender } from "../../application/ports/notification-sender";

export class AwsSnsNotificationSender implements NotificationSender {
  constructor(
    private readonly topicArn: string,
    private readonly snsClient = new SNSClient({})
  ) {}

  async send(payload: { documentId: string; message: string }): Promise<void> {
    await this.snsClient.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Subject: `Documento ${payload.documentId} processado`,
        Message: payload.message,
        MessageAttributes: {
          documentId: {
            DataType: "String",
            StringValue: payload.documentId
          }
        }
      })
    );
  }
}

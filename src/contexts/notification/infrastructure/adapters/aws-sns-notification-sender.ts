import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { NotificationSender } from "../../application/ports/notification-sender";
import { getAwsClientConfig } from "../../../../shared/infrastructure/aws/aws-client-config";

export class AwsSnsNotificationSender implements NotificationSender {
  constructor(
    private readonly topicArn: string,
    private readonly snsClient = new SNSClient(getAwsClientConfig("sns"))
  ) {}

  async send(payload: { documentId: string; message: string }): Promise<void> {
    await this.snsClient.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Subject: `Document ${payload.documentId} processed`,
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

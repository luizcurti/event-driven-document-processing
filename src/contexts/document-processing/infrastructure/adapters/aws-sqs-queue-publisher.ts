import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { QueuePublisher } from "../../application/ports/queue-publisher";
import { getAwsClientConfig } from "../../../../shared/infrastructure/aws/aws-client-config";

export class AwsSqsQueuePublisher implements QueuePublisher {
  constructor(
    private readonly queueUrl: string,
    private readonly sqsClient = new SQSClient(getAwsClientConfig("sqs"))
  ) {}

  async publish(message: Record<string, unknown>): Promise<void> {
    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message)
      })
    );
  }
}

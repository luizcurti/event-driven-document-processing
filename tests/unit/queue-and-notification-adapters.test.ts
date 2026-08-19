import { describe, expect, it, vi } from "vitest";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { PublishCommand } from "@aws-sdk/client-sns";
import { AwsSqsQueuePublisher } from "../../src/contexts/document-processing/infrastructure/adapters/aws-sqs-queue-publisher";
import { AwsSnsNotificationSender } from "../../src/contexts/notification/infrastructure/adapters/aws-sns-notification-sender";

describe("AwsSqsQueuePublisher", () => {
  it("publishes a JSON-serialized message body to the configured queue", async () => {
    const fakeClient = { send: vi.fn(async () => ({})) };
    const publisher = new AwsSqsQueuePublisher("queue-url", fakeClient as never);

    await publisher.publish({ type: "DOCUMENT_PROCESSED", documentId: "doc-1" });

    expect(fakeClient.send).toHaveBeenCalledOnce();
    const command = fakeClient.send.mock.calls[0][0] as SendMessageCommand;
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command.input.QueueUrl).toBe("queue-url");
    expect(JSON.parse(command.input.MessageBody as string)).toEqual({
      type: "DOCUMENT_PROCESSED",
      documentId: "doc-1"
    });
  });

  it("propagates errors from the SQS client instead of swallowing them", async () => {
    const fakeClient = { send: vi.fn(async () => { throw new Error("queue unavailable"); }) };
    const publisher = new AwsSqsQueuePublisher("queue-url", fakeClient as never);

    await expect(publisher.publish({ documentId: "doc-2" })).rejects.toThrow("queue unavailable");
  });
});

describe("AwsSnsNotificationSender", () => {
  it("publishes with the documentId as a message attribute", async () => {
    const fakeClient = { send: vi.fn(async () => ({})) };
    const sender = new AwsSnsNotificationSender("topic-arn", fakeClient as never);

    await sender.send({ documentId: "doc-3", message: "Document processed successfully" });

    expect(fakeClient.send).toHaveBeenCalledOnce();
    const command = fakeClient.send.mock.calls[0][0] as PublishCommand;
    expect(command).toBeInstanceOf(PublishCommand);
    expect(command.input.TopicArn).toBe("topic-arn");
    expect(command.input.Message).toBe("Document processed successfully");
    expect(command.input.MessageAttributes?.documentId).toEqual({
      DataType: "String",
      StringValue: "doc-3"
    });
  });

  it("propagates errors from the SNS client instead of swallowing them", async () => {
    const fakeClient = { send: vi.fn(async () => { throw new Error("topic not found"); }) };
    const sender = new AwsSnsNotificationSender("topic-arn", fakeClient as never);

    await expect(sender.send({ documentId: "doc-4", message: "x" })).rejects.toThrow("topic not found");
  });
});

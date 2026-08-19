import { SNSEvent } from "aws-lambda";
import { GetDocumentTextDetectionCommand, TextractClient } from "@aws-sdk/client-textract";
import { SendTaskFailureCommand, SendTaskSuccessCommand, SFNClient } from "@aws-sdk/client-sfn";
import { summarizeTextractBlocks } from "../contexts/document-processing/infrastructure/adapters/aws-ocr-provider";
import { TextractTaskTokenStore } from "../contexts/document-processing/infrastructure/adapters/textract-task-token-store";
import { getAwsClientConfig, requireEnv } from "../shared/infrastructure/aws/aws-client-config";
import { withMetrics } from "../shared/infrastructure/metrics/metrics";

interface TextractJobNotification {
  JobId: string;
  Status: "SUCCEEDED" | "FAILED" | "PARTIAL_SUCCESS";
  StatusMessage?: string;
}

const textractClient = new TextractClient(getAwsClientConfig("textract"));
const sfnClient = new SFNClient(getAwsClientConfig("sfn"));

const ocrCallbackHandler = async (event: SNSEvent) => {
  const metadataTable = requireEnv(
    process.env.DOCUMENTS_METADATA_TABLE,
    "Lambda missing DOCUMENTS_METADATA_TABLE"
  );
  const taskTokenStore = new TextractTaskTokenStore(metadataTable);

  for (const record of event.Records) {
    const notification = JSON.parse(record.Sns.Message) as TextractJobNotification;

    // Atomic delete-to-consume: a duplicate SNS delivery for the same JobId finds
    // nothing left to consume and is safely ignored (never resolves the same task
    // token twice).
    const claim = await taskTokenStore.consume(notification.JobId);
    if (!claim) {
      continue;
    }

    if (notification.Status !== "SUCCEEDED") {
      await sfnClient.send(
        new SendTaskFailureCommand({
          taskToken: claim.taskToken,
          error: "OcrJobFailed",
          cause:
            notification.StatusMessage ??
            `Textract job ended with status ${notification.Status}`
        })
      );
      continue;
    }

    try {
      const detection = await textractClient.send(
        new GetDocumentTextDetectionCommand({ JobId: notification.JobId })
      );
      const result = summarizeTextractBlocks(detection.Blocks ?? []);

      await sfnClient.send(
        new SendTaskSuccessCommand({
          taskToken: claim.taskToken,
          output: JSON.stringify(result)
        })
      );
    } catch (error) {
      await sfnClient.send(
        new SendTaskFailureCommand({
          taskToken: claim.taskToken,
          error: "OcrResultFetchFailure",
          cause: error instanceof Error ? error.message : "unknown"
        })
      );
    }
  }

  return { ok: true };
};

export const handler = withMetrics("ocr-callback", ocrCallbackHandler);

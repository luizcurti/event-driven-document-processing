import { Handler } from "aws-lambda";
import { ProcessOcrUseCase } from "../contexts/document-processing/application/use-cases/process-ocr-use-case";
import { AwsOcrProvider } from "../contexts/document-processing/infrastructure/adapters/aws-ocr-provider";
import { ProcessingRequest } from "../shared/contracts/events";
import { SendTaskFailureCommand, SendTaskSuccessCommand, SFNClient } from "@aws-sdk/client-sfn";
import { getAwsClientConfig } from "../shared/infrastructure/aws/aws-client-config";
import { AwsDynamoIdempotencyService } from "../contexts/document-ingestion/infrastructure/adapters/aws-dynamo-idempotency-service";

type OcrRequest = ProcessingRequest & { taskToken?: string };

const sfnClient = new SFNClient(getAwsClientConfig("sfn"));

export const handler: Handler<OcrRequest> = async (event) => {
  const metadataTable = process.env.DOCUMENTS_METADATA_TABLE ?? "";
  if (!metadataTable) {
    throw new Error("Lambda missing DOCUMENTS_METADATA_TABLE");
  }

  const eventId = event.eventId ?? `ocr#${event.documentId}#${event.key}`;
  const idempotencyService = new AwsDynamoIdempotencyService(metadataTable);
  try {
    await idempotencyService.markProcessed(eventId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already processed")) {
      const dedupedResult = { textPreview: "", confidence: 0 };
      if (event.taskToken) {
        await sfnClient.send(
          new SendTaskSuccessCommand({
            taskToken: event.taskToken,
            output: JSON.stringify(dedupedResult)
          })
        );
      }
      return dedupedResult;
    }
    throw error;
  }

  const useCase = new ProcessOcrUseCase(new AwsOcrProvider());
  const result = await useCase.execute(event);

  if (event.taskToken) {
    try {
      await sfnClient.send(
        new SendTaskSuccessCommand({
          taskToken: event.taskToken,
          output: JSON.stringify(result)
        })
      );
      return { accepted: true };
    } catch (error) {
      await sfnClient.send(
        new SendTaskFailureCommand({
          taskToken: event.taskToken,
          error: "OcrCallbackFailure",
          cause: error instanceof Error ? error.message : "unknown"
        })
      );
      throw error;
    }
  }

  return result;
};

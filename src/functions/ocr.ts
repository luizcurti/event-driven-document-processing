import { ProcessOcrUseCase } from "../contexts/document-processing/application/use-cases/process-ocr-use-case";
import { AwsOcrProvider } from "../contexts/document-processing/infrastructure/adapters/aws-ocr-provider";
import { ProcessingRequest } from "../shared/contracts/events";
import { SendTaskSuccessCommand, SFNClient } from "@aws-sdk/client-sfn";
import { getAwsClientConfig, requireEnv } from "../shared/infrastructure/aws/aws-client-config";
import { runIdempotent } from "../contexts/document-ingestion/infrastructure/adapters/aws-dynamo-idempotency-service";
import { withMetrics } from "../shared/infrastructure/metrics/metrics";

type OcrRequest = ProcessingRequest & { taskToken?: string };

const sfnClient = new SFNClient(getAwsClientConfig("sfn"));

const ocrHandler = async (event: OcrRequest) => {
  const metadataTable = requireEnv(
    process.env.DOCUMENTS_METADATA_TABLE,
    "Lambda missing DOCUMENTS_METADATA_TABLE"
  );

  const eventId = event.eventId ?? `ocr#${event.documentId}#${event.key}`;

  return runIdempotent(metadataTable, eventId, async () => {
    const useCase = new ProcessOcrUseCase(new AwsOcrProvider());
    const result = await useCase.execute(event);

    if (result === null) {
      // Real async Textract job started; the ocr-callback Lambda resolves the task
      // token via SNS once the job completes. Nothing more to do in this invocation.
      return { accepted: true, resolved: false };
    }

    if (event.taskToken) {
      await sfnClient.send(
        new SendTaskSuccessCommand({
          taskToken: event.taskToken,
          output: JSON.stringify(result)
        })
      );
      return { accepted: true, resolved: true };
    }

    // Direct invocation outside the Step Functions pipeline (e.g. local manual
    // testing): return the result as-is, there is no task token to resolve.
    return result;
  });
};

export const handler = withMetrics("ocr", ocrHandler);

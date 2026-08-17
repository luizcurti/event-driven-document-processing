import { Handler } from "aws-lambda";
import { ProcessThumbnailUseCase } from "../contexts/document-processing/application/use-cases/process-thumbnail-use-case";
import { AwsThumbnailProvider } from "../contexts/document-processing/infrastructure/adapters/aws-thumbnail-provider";
import { ProcessingRequest, ThumbnailResult } from "../shared/contracts/events";
import { requireEnv } from "../shared/infrastructure/aws/aws-client-config";
import { runIdempotent } from "../contexts/document-ingestion/infrastructure/adapters/aws-dynamo-idempotency-service";

export const handler: Handler<ProcessingRequest> = async (event) => {
  const metadataTable = requireEnv(
    process.env.DOCUMENTS_METADATA_TABLE,
    "Lambda missing DOCUMENTS_METADATA_TABLE"
  );

  const eventId = event.eventId ?? `thumbnail#${event.documentId}#${event.key}`;

  return runIdempotent<ThumbnailResult>(metadataTable, eventId, () => {
    const useCase = new ProcessThumbnailUseCase(new AwsThumbnailProvider());
    return useCase.execute(event);
  });
};

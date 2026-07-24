import { Handler } from "aws-lambda";
import { ProcessThumbnailUseCase } from "../contexts/document-processing/application/use-cases/process-thumbnail-use-case";
import { AwsThumbnailProvider } from "../contexts/document-processing/infrastructure/adapters/aws-thumbnail-provider";
import { ProcessingRequest } from "../shared/contracts/events";
import { requireEnv } from "../shared/infrastructure/aws/aws-client-config";
import { isNewEvent } from "../contexts/document-ingestion/infrastructure/adapters/aws-dynamo-idempotency-service";

export const handler: Handler<ProcessingRequest> = async (event) => {
  const metadataTable = requireEnv(
    process.env.DOCUMENTS_METADATA_TABLE,
    "Lambda missing DOCUMENTS_METADATA_TABLE"
  );

  const eventId = event.eventId ?? `thumbnail#${event.documentId}#${event.key}`;

  if (!(await isNewEvent(metadataTable, eventId))) {
    return {
      thumbnailKey: `thumbnails/${event.documentId}.json`,
      width: 320,
      height: 200
    };
  }

  const useCase = new ProcessThumbnailUseCase(new AwsThumbnailProvider());
  return useCase.execute(event);
};

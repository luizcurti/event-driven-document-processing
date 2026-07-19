import { Handler } from "aws-lambda";
import { ProcessThumbnailUseCase } from "../contexts/document-processing/application/use-cases/process-thumbnail-use-case";
import { AwsThumbnailProvider } from "../contexts/document-processing/infrastructure/adapters/aws-thumbnail-provider";
import { ProcessingRequest } from "../shared/contracts/events";
import { AwsDynamoIdempotencyService } from "../contexts/document-ingestion/infrastructure/adapters/aws-dynamo-idempotency-service";

export const handler: Handler<ProcessingRequest> = async (event) => {
  const metadataTable = process.env.DOCUMENTS_METADATA_TABLE ?? "";
  if (!metadataTable) {
    throw new Error("Lambda missing DOCUMENTS_METADATA_TABLE");
  }

  const eventId = event.eventId ?? `thumbnail#${event.documentId}#${event.key}`;
  const idempotencyService = new AwsDynamoIdempotencyService(metadataTable);
  try {
    await idempotencyService.markProcessed(eventId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already processed")) {
      return {
        thumbnailKey: `thumbnails/${event.documentId}.json`,
        width: 320,
        height: 200
      };
    }
    throw error;
  }

  const useCase = new ProcessThumbnailUseCase(new AwsThumbnailProvider());
  return useCase.execute(event);
};

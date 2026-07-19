import { Handler } from "aws-lambda";
import { ValidateDocumentUseCase } from "../contexts/document-processing/application/use-cases/validate-document-use-case";
import { AwsValidatorProvider } from "../contexts/document-processing/infrastructure/adapters/aws-validator-provider";
import { ProcessingRequest } from "../shared/contracts/events";
import { AwsDynamoIdempotencyService } from "../contexts/document-ingestion/infrastructure/adapters/aws-dynamo-idempotency-service";

export const handler: Handler<ProcessingRequest> = async (event) => {
  const metadataTable = process.env.DOCUMENTS_METADATA_TABLE ?? "";
  if (!metadataTable) {
    throw new Error("Lambda missing DOCUMENTS_METADATA_TABLE");
  }

  const eventId = event.eventId ?? `validation#${event.documentId}#${event.key}`;
  const idempotencyService = new AwsDynamoIdempotencyService(metadataTable);
  try {
    await idempotencyService.markProcessed(eventId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already processed")) {
      return { valid: true, reasons: [] };
    }
    throw error;
  }

  const useCase = new ValidateDocumentUseCase(new AwsValidatorProvider());
  const result = await useCase.execute(event);

  if (!result.valid) {
    const error = new Error(result.reasons.join("; ") || "Invalid document");
    error.name = "ValidationError";
    throw error;
  }

  return result;
};

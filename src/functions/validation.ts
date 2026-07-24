import { Handler } from "aws-lambda";
import { ValidateDocumentUseCase } from "../contexts/document-processing/application/use-cases/validate-document-use-case";
import { AwsValidatorProvider } from "../contexts/document-processing/infrastructure/adapters/aws-validator-provider";
import { ProcessingRequest } from "../shared/contracts/events";
import { requireEnv } from "../shared/infrastructure/aws/aws-client-config";
import { isNewEvent } from "../contexts/document-ingestion/infrastructure/adapters/aws-dynamo-idempotency-service";

export const handler: Handler<ProcessingRequest> = async (event) => {
  const metadataTable = requireEnv(
    process.env.DOCUMENTS_METADATA_TABLE,
    "Lambda missing DOCUMENTS_METADATA_TABLE"
  );

  const eventId = event.eventId ?? `validation#${event.documentId}#${event.key}`;

  if (!(await isNewEvent(metadataTable, eventId))) {
    return { valid: true, reasons: [] };
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

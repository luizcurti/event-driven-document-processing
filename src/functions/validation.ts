import { ValidateDocumentUseCase } from "../contexts/document-processing/application/use-cases/validate-document-use-case";
import { AwsValidatorProvider } from "../contexts/document-processing/infrastructure/adapters/aws-validator-provider";
import { ProcessingRequest, ValidationResult } from "../shared/contracts/events";
import { requireEnv } from "../shared/infrastructure/aws/aws-client-config";
import { runIdempotent } from "../contexts/document-ingestion/infrastructure/adapters/aws-dynamo-idempotency-service";
import { withMetrics } from "../shared/infrastructure/metrics/metrics";

const validationHandler = async (event: ProcessingRequest) => {
  const metadataTable = requireEnv(
    process.env.DOCUMENTS_METADATA_TABLE,
    "Lambda missing DOCUMENTS_METADATA_TABLE"
  );

  const eventId = event.eventId ?? `validation#${event.documentId}#${event.key}`;

  return runIdempotent<ValidationResult>(metadataTable, eventId, async () => {
    const useCase = new ValidateDocumentUseCase(new AwsValidatorProvider());
    const result = await useCase.execute(event);

    if (!result.valid) {
      const error = new Error(result.reasons.join("; ") || "Invalid document");
      error.name = "ValidationError";
      throw error;
    }

    return result;
  });
};

export const handler = withMetrics("validation", validationHandler);

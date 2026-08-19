import { PersistMetadataUseCase } from "../contexts/document-processing/application/use-cases/persist-metadata-use-case";
import { AwsDynamoProcessedMetadataRepository } from "../contexts/document-processing/infrastructure/adapters/aws-dynamo-processed-metadata-repository";
import { AwsSqsQueuePublisher } from "../contexts/document-processing/infrastructure/adapters/aws-sqs-queue-publisher";
import { MergedProcessingResult } from "../shared/contracts/events";
import { requireEnv } from "../shared/infrastructure/aws/aws-client-config";
import { withMetrics } from "../shared/infrastructure/metrics/metrics";

interface FailedProcessingEvent {
  documentId: string;
  status: "FAILED";
  errorMessage?: string;
}

type MetadataEvent = MergedProcessingResult | FailedProcessingEvent;

function isFailedEvent(event: MetadataEvent): event is FailedProcessingEvent {
  return "status" in event && event.status === "FAILED";
}

const metadataHandler = async (event: MetadataEvent) => {
  const errorMessage = "Lambda missing DOCUMENTS_METADATA_TABLE or NOTIFICATION_QUEUE_URL";
  const metadataTable = requireEnv(process.env.DOCUMENTS_METADATA_TABLE, errorMessage);
  const queueUrl = requireEnv(process.env.NOTIFICATION_QUEUE_URL, errorMessage);

  const repository = new AwsDynamoProcessedMetadataRepository(metadataTable);

  if (isFailedEvent(event)) {
    await repository.saveFailure({
      documentId: event.documentId,
      errorMessage: event.errorMessage ?? "Workflow execution failed",
      failedAt: new Date().toISOString()
    });
    return { ok: true, status: "FAILED_RECORDED" };
  }

  const useCase = new PersistMetadataUseCase(repository, new AwsSqsQueuePublisher(queueUrl));

  await useCase.execute(event);
  return { ok: true };
};

export const handler = withMetrics("metadata", metadataHandler);

import { Handler } from "aws-lambda";
import { PersistMetadataUseCase } from "../contexts/document-processing/application/use-cases/persist-metadata-use-case";
import { AwsDynamoProcessedMetadataRepository } from "../contexts/document-processing/infrastructure/adapters/aws-dynamo-processed-metadata-repository";
import { AwsSqsQueuePublisher } from "../contexts/document-processing/infrastructure/adapters/aws-sqs-queue-publisher";
import { MergedProcessingResult } from "../shared/contracts/events";
import { requireEnv } from "../shared/infrastructure/aws/aws-client-config";

type MetadataEvent =
  | MergedProcessingResult
  | {
      documentId: string;
      status: "FAILED";
      errorMessage?: string;
    };

export const handler: Handler<MetadataEvent> = async (event) => {
  const errorMessage = "Lambda missing DOCUMENTS_METADATA_TABLE or NOTIFICATION_QUEUE_URL";
  const metadataTable = requireEnv(process.env.DOCUMENTS_METADATA_TABLE, errorMessage);
  const queueUrl = requireEnv(process.env.NOTIFICATION_QUEUE_URL, errorMessage);

  const repository = new AwsDynamoProcessedMetadataRepository(metadataTable);

  if ((event as { status?: string }).status === "FAILED") {
    await repository.saveFailure({
      documentId: event.documentId,
      errorMessage:
        (event as { errorMessage?: string }).errorMessage ?? "Workflow execution failed",
      failedAt: new Date().toISOString()
    });
    return { ok: true, status: "FAILED_RECORDED" };
  }

  const useCase = new PersistMetadataUseCase(repository, new AwsSqsQueuePublisher(queueUrl));

  await useCase.execute(event as MergedProcessingResult);
  return { ok: true };
};

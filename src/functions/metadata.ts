import { Handler } from "aws-lambda";
import { PersistMetadataUseCase } from "../contexts/document-processing/application/use-cases/persist-metadata-use-case";
import { AwsDynamoProcessedMetadataRepository } from "../contexts/document-processing/infrastructure/adapters/aws-dynamo-processed-metadata-repository";
import { AwsSqsQueuePublisher } from "../contexts/document-processing/infrastructure/adapters/aws-sqs-queue-publisher";
import { MergedProcessingResult } from "../shared/contracts/events";

export const handler: Handler<MergedProcessingResult> = async (event) => {
  const metadataTable = process.env.DOCUMENTS_METADATA_TABLE ?? "";
  const queueUrl = process.env.NOTIFICATION_QUEUE_URL ?? "";

  if (!metadataTable || !queueUrl) {
    throw new Error("Lambda missing DOCUMENTS_METADATA_TABLE or NOTIFICATION_QUEUE_URL");
  }

  const useCase = new PersistMetadataUseCase(
    new AwsDynamoProcessedMetadataRepository(metadataTable),
    new AwsSqsQueuePublisher(queueUrl)
  );

  await useCase.execute(event);
  return { ok: true };
};

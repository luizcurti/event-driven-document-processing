import { Handler } from "aws-lambda";
import { ProcessThumbnailUseCase } from "../contexts/document-processing/application/use-cases/process-thumbnail-use-case";
import { AwsThumbnailProvider } from "../contexts/document-processing/infrastructure/adapters/aws-thumbnail-provider";
import { ProcessingRequest } from "../shared/contracts/events";

export const handler: Handler<ProcessingRequest> = async (event) => {
  const useCase = new ProcessThumbnailUseCase(new AwsThumbnailProvider());
  return useCase.execute(event);
};

import { Handler } from "aws-lambda";
import { ProcessOcrUseCase } from "../contexts/document-processing/application/use-cases/process-ocr-use-case";
import { AwsOcrProvider } from "../contexts/document-processing/infrastructure/adapters/aws-ocr-provider";
import { ProcessingRequest } from "../shared/contracts/events";

export const handler: Handler<ProcessingRequest> = async (event) => {
  const useCase = new ProcessOcrUseCase(new AwsOcrProvider());
  return useCase.execute(event);
};

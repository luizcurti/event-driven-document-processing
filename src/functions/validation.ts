import { Handler } from "aws-lambda";
import { ValidateDocumentUseCase } from "../contexts/document-processing/application/use-cases/validate-document-use-case";
import { AwsValidatorProvider } from "../contexts/document-processing/infrastructure/adapters/aws-validator-provider";
import { ProcessingRequest } from "../shared/contracts/events";

export const handler: Handler<ProcessingRequest> = async (event) => {
  const useCase = new ValidateDocumentUseCase(new AwsValidatorProvider());
  return useCase.execute(event);
};

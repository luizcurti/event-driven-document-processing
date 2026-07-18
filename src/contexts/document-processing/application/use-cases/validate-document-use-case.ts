import { ProcessingRequest } from "../../../../shared/contracts/events";
import { ValidatorProvider } from "../ports/validator-provider";

export class ValidateDocumentUseCase {
  constructor(private readonly validatorProvider: ValidatorProvider) {}

  execute(request: ProcessingRequest) {
    return this.validatorProvider.validate(request.documentId, request.bucket, request.key);
  }
}

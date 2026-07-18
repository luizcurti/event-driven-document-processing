import { ValidationResult } from "../../../../shared/contracts/events";

export interface ValidatorProvider {
  validate(documentId: string, bucket: string, key: string): Promise<ValidationResult>;
}

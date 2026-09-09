import { ProcessingRequest } from "../../../../shared/contracts/events";
import { ThumbnailProvider } from "../ports/thumbnail-provider";

export class ProcessThumbnailUseCase {
  constructor(private readonly thumbnailProvider: ThumbnailProvider) {}

  execute(request: ProcessingRequest) {
    return this.thumbnailProvider.generate(request.documentId, request.bucket, request.key);
  }
}

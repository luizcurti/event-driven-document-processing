import { ThumbnailResult } from "../../../../shared/contracts/events";

export interface ThumbnailProvider {
  generate(documentId: string, bucket: string, key: string): Promise<ThumbnailResult>;
}

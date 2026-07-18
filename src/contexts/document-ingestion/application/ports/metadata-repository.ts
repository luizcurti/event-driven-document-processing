import { Document } from "../../domain/entities/document";

export interface MetadataRepository {
  saveInitial(document: Document): Promise<void>;
}

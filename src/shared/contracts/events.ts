export interface ProcessingRequest {
  documentId: string;
  bucket: string;
  key: string;
}

export interface OcrResult {
  textPreview: string;
  confidence: number;
}

export interface ThumbnailResult {
  thumbnailKey: string;
  width: number;
  height: number;
}

export interface ValidationResult {
  valid: boolean;
  reasons: string[];
}

export interface MergedProcessingResult {
  documentId: string;
  ocr: OcrResult;
  thumbnail: ThumbnailResult;
  validation: ValidationResult;
  processedAt: string;
}

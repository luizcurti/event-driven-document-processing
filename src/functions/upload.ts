import { uploadHandler } from "../contexts/document-ingestion/infrastructure/http/upload-handler";
import { withMetrics } from "../shared/infrastructure/metrics/metrics";

export const handler = withMetrics("upload", uploadHandler);

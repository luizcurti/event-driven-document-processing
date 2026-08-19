import { getDocumentStatusHandler } from "../contexts/document-ingestion/infrastructure/http/get-document-status-handler";
import { withMetrics } from "../shared/infrastructure/metrics/metrics";

export const handler = withMetrics("get-document", getDocumentStatusHandler);

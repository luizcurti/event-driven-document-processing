import { APIGatewayProxyEventV2 } from "aws-lambda";
import { uploadHandler } from "../contexts/document-ingestion/infrastructure/http/upload-handler";
import { withMetrics } from "../shared/infrastructure/metrics/metrics";

export const handler = withMetrics("upload", uploadHandler, {
  getCorrelationId: (event: APIGatewayProxyEventV2) =>
    event.headers["x-idempotency-key"] ||
    event.headers["X-Idempotency-Key"] ||
    event.requestContext.requestId
});

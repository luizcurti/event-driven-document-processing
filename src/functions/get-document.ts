import { APIGatewayProxyEventV2 } from "aws-lambda";
import { getDocumentStatusHandler } from "../contexts/document-ingestion/infrastructure/http/get-document-status-handler";

export const handler = async (event: APIGatewayProxyEventV2) => {
  return getDocumentStatusHandler(event);
};

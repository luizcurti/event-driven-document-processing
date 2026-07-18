import { APIGatewayProxyEventV2 } from "aws-lambda";
import { uploadHandler } from "../contexts/document-ingestion/infrastructure/http/upload-handler";

export const handler = async (event: APIGatewayProxyEventV2) => {
  return uploadHandler(event);
};

import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetDocumentStatusUseCase } from "../../application/use-cases/get-document-status-use-case";
import { AwsDynamoMetadataRepository } from "../adapters/aws-dynamo-metadata-repository";

export async function getDocumentStatusHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const metadataTable = process.env.DOCUMENTS_METADATA_TABLE ?? "";
  const documentId = event.pathParameters?.documentId?.trim() ?? "";

  if (!metadataTable) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "DOCUMENTS_METADATA_TABLE not configured" })
    };
  }

  if (!documentId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "documentId is required" })
    };
  }

  const useCase = new GetDocumentStatusUseCase(
    new AwsDynamoMetadataRepository(metadataTable)
  );

  const status = await useCase.execute(documentId);

  if (!status) {
    return {
      statusCode: 404,
      body: JSON.stringify({ message: "Document not found" })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(status)
  };
}

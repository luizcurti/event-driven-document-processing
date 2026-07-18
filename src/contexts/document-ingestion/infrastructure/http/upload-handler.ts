import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { UploadDocumentUseCase } from "../../application/use-cases/upload-document-use-case";
import { AwsDynamoIdempotencyService } from "../adapters/aws-dynamo-idempotency-service";
import { AwsDynamoMetadataRepository } from "../adapters/aws-dynamo-metadata-repository";
import { AwsS3ObjectStorage } from "../adapters/aws-s3-object-storage";
import { ConsoleLogger } from "../../../../shared/infrastructure/logging/logger";

const logger = new ConsoleLogger();

export async function uploadHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const requestId = event.requestContext.requestId;
    const metadataTable = process.env.DOCUMENTS_METADATA_TABLE ?? "";
    const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
    const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
    const contentBase64 = typeof body.contentBase64 === "string" ? body.contentBase64 : "";

    if (!metadataTable) {
      throw new Error("DOCUMENTS_METADATA_TABLE not configured");
    }

    if (!documentId || !fileName || !contentBase64) {
      throw new Error("Invalid payload: documentId, fileName and contentBase64 are required");
    }

    const useCase = new UploadDocumentUseCase(
      new AwsDynamoMetadataRepository(metadataTable),
      new AwsS3ObjectStorage(),
      new AwsDynamoIdempotencyService(metadataTable)
    );

    const response = await useCase.execute({
      requestId,
      documentId,
      fileName,
      contentType: body.contentType ?? "application/pdf",
      contentBase64,
      bucket: process.env.DOCUMENTS_BUCKET ?? "documents-bucket"
    });

    return {
      statusCode: 202,
      body: JSON.stringify({
        message: "Upload aceito para processamento",
        documentKey: response.key
      })
    };
  } catch (error) {
    logger.error("Erro no upload", {
      error: error instanceof Error ? error.message : "unknown"
    });

    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Falha ao processar upload" })
    };
  }
}

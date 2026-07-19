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
    const requestId =
      event.requestContext.requestId ||
      event.headers["x-idempotency-key"] ||
      event.headers["X-Idempotency-Key"] ||
      `local-${Date.now()}`;
    const metadataTable = process.env.DOCUMENTS_METADATA_TABLE ?? "";
    const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
    const contentType =
      typeof body.contentType === "string" && body.contentType.trim().length > 0
        ? body.contentType
        : "application/pdf";
    const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";

    if (!metadataTable) {
      throw new Error("DOCUMENTS_METADATA_TABLE not configured");
    }

    if (!fileName) {
      throw new Error("Invalid payload: fileName is required");
    }

    const useCase = new UploadDocumentUseCase(
      new AwsDynamoMetadataRepository(metadataTable),
      new AwsS3ObjectStorage(),
      new AwsDynamoIdempotencyService(metadataTable)
    );

    const response = await useCase.execute({
      requestId,
      fileName,
      contentType,
      documentId: documentId || undefined,
      bucket: process.env.DOCUMENTS_BUCKET ?? "documents-bucket"
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        documentId: response.documentId,
        uploadUrl: response.uploadUrl,
        key: response.key
      })
    };
  } catch (error) {
    logger.error("Upload error", {
      error: error instanceof Error ? error.message : "unknown"
    });

    const statusCode =
      error instanceof Error && error.message.includes("already processed") ? 409 : 400;

    return {
      statusCode,
      body: JSON.stringify({
        message: error instanceof Error ? error.message : "Failed to process upload"
      })
    };
  }
}

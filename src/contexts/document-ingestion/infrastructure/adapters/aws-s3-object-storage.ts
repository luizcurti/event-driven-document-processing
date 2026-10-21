import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ObjectStorage } from "../../application/ports/object-storage";
import {
  getAwsClientConfig,
  isLocalAwsMode
} from "../../../../shared/infrastructure/aws/aws-client-config";

export class AwsS3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly s3Client = new S3Client({
      ...getAwsClientConfig("s3"),
      forcePathStyle: isLocalAwsMode(),
      requestChecksumCalculation: "WHEN_REQUIRED"
    })
  ) {}

  async generateUploadUrl(input: {
    bucket: string;
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  }): Promise<string> {
    return getSignedUrl(
      this.s3Client,
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ContentType: input.contentType
      }),
      { expiresIn: input.expiresInSeconds ?? 900 }
    );
  }
}

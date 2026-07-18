import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ObjectStorage } from "../../application/ports/object-storage";

export class AwsS3ObjectStorage implements ObjectStorage {
  constructor(private readonly s3Client = new S3Client({})) {}

  async putObject(input: {
    bucket: string;
    key: string;
    contentBase64: string;
    contentType: string;
  }): Promise<void> {
    const body = Buffer.from(input.contentBase64, "base64");

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: body,
        ContentType: input.contentType
      })
    );
  }
}

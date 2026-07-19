import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ValidatorProvider } from "../../application/ports/validator-provider";
import {
  getAwsClientConfig,
  isLocalAwsMode
} from "../../../../shared/infrastructure/aws/aws-client-config";

export class AwsValidatorProvider implements ValidatorProvider {
  constructor(
    private readonly s3Client = new S3Client({
      ...getAwsClientConfig("s3"),
      forcePathStyle: isLocalAwsMode()
    })
  ) {}

  async validate(
    _documentId: string,
    bucket: string,
    key: string
  ): Promise<{ valid: boolean; reasons: string[] }> {
    const head = await this.s3Client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );

    const reasons: string[] = [];

    if ((head.ContentLength ?? 0) <= 0) {
      reasons.push("Empty file");
    }

    if (head.ContentType !== "application/pdf") {
      reasons.push("Invalid Content-Type; expected application/pdf");
    }

    return {
      valid: reasons.length === 0,
      reasons
    };
  }
}

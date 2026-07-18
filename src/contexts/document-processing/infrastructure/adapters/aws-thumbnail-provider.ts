import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { ThumbnailProvider } from "../../application/ports/thumbnail-provider";

export class AwsThumbnailProvider implements ThumbnailProvider {
  constructor(private readonly s3Client = new S3Client({})) {}

  async generate(
    documentId: string,
    bucket: string,
    key: string
  ): Promise<{ thumbnailKey: string; width: number; height: number }> {
    await this.s3Client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );

    const thumbnailKey = `thumbnails/${documentId}.json`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: thumbnailKey,
        ContentType: "application/json",
        Body: JSON.stringify({
          generatedFrom: key,
          generatedAt: new Date().toISOString(),
          note: "Placeholder de thumbnail. Substituir por pipeline de imagem real."
        })
      })
    );

    return {
      thumbnailKey,
      width: 320,
      height: 200
    };
  }
}

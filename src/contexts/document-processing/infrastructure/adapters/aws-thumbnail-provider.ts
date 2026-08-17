import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { ThumbnailProvider } from "../../application/ports/thumbnail-provider";
import { ThumbnailResult } from "../../../../shared/contracts/events";
import {
  getAwsClientConfig,
  isLocalAwsMode
} from "../../../../shared/infrastructure/aws/aws-client-config";
import { createPlaceholderPng } from "./png-placeholder";

const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 200;

export class AwsThumbnailProvider implements ThumbnailProvider {
  constructor(
    private readonly s3Client = new S3Client({
      ...getAwsClientConfig("s3"),
      forcePathStyle: isLocalAwsMode()
    })
  ) {}

  async generate(documentId: string, bucket: string, key: string): Promise<ThumbnailResult> {
    await this.s3Client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );

    const prefix = `thumbnails/${documentId}`;
    const pageKeys = [`${prefix}/page-1.png`, `${prefix}/page-2.png`];
    const thumbnailKey = `${prefix}/preview.png`;

    await Promise.all(
      [...pageKeys, thumbnailKey].map((imageKey) =>
        this.s3Client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: imageKey,
            ContentType: "image/png",
            Body: createPlaceholderPng(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)
          })
        )
      )
    );

    return {
      thumbnailKey,
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      pageKeys
    };
  }
}

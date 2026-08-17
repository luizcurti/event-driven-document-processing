import {
  Block,
  DetectDocumentTextCommand,
  StartDocumentTextDetectionCommand,
  TextractClient
} from "@aws-sdk/client-textract";
import { OcrExtractionInput, OcrProvider } from "../../application/ports/ocr-provider";
import { OcrResult } from "../../../../shared/contracts/events";
import {
  getAwsClientConfig,
  isLocalAwsMode,
  requireEnv
} from "../../../../shared/infrastructure/aws/aws-client-config";
import { TextractTaskTokenStore } from "./textract-task-token-store";

/**
 * Reduces raw Textract LINE blocks to the platform's OcrResult shape. Shared between
 * the synchronous path here and the async ocr-callback Lambda (which gets its Blocks
 * from GetDocumentTextDetection once the job completes).
 */
export function summarizeTextractBlocks(blocks: Block[]): OcrResult {
  const lines = blocks
    .filter((block) => block.BlockType === "LINE" && !!block.Text)
    .map((block) => ({
      text: block.Text as string,
      confidence: block.Confidence ?? 0
    }));

  const preview = lines
    .slice(0, 3)
    .map((line) => line.text)
    .join(" ")
    .slice(0, 500);

  const avgConfidence =
    lines.length === 0
      ? 0
      : lines.reduce((acc, curr) => acc + curr.confidence, 0) / lines.length / 100;

  return {
    textPreview: preview,
    confidence: Number(avgConfidence.toFixed(4))
  };
}

export class AwsOcrProvider implements OcrProvider {
  constructor(
    private readonly textractClient = new TextractClient(getAwsClientConfig("textract")),
    private readonly taskTokenStore?: TextractTaskTokenStore
  ) {}

  async startExtraction(input: OcrExtractionInput): Promise<OcrResult | null> {
    if (isLocalAwsMode()) {
      // LocalStack Community has no Textract support: resolve synchronously with a
      // mock result instead of starting a real (unsupported) async job.
      return {
        textPreview: `OCR local mock for ${input.bucket}/${input.key}`,
        confidence: 0.99
      };
    }

    if (!input.taskToken) {
      // No Step Functions task token to resume later (e.g. a direct/manual
      // invocation outside the pipeline): fall back to the synchronous Textract API.
      return this.extractTextSync(input.bucket, input.key);
    }

    const jobId = await this.startAsyncJob(input.bucket, input.key);

    const taskTokenStore =
      this.taskTokenStore ??
      new TextractTaskTokenStore(
        requireEnv(process.env.DOCUMENTS_METADATA_TABLE, "Lambda missing DOCUMENTS_METADATA_TABLE")
      );

    await taskTokenStore.save(jobId, {
      documentId: input.documentId,
      taskToken: input.taskToken
    });

    return null;
  }

  private async startAsyncJob(bucket: string, key: string): Promise<string> {
    const result = await this.textractClient.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: bucket,
            Name: key
          }
        },
        NotificationChannel: {
          RoleArn: requireEnv(process.env.TEXTRACT_ROLE_ARN, "Lambda missing TEXTRACT_ROLE_ARN"),
          SNSTopicArn: requireEnv(
            process.env.TEXTRACT_TOPIC_ARN,
            "Lambda missing TEXTRACT_TOPIC_ARN"
          )
        }
      })
    );

    if (!result.JobId) {
      throw new Error("Textract did not return a JobId for StartDocumentTextDetection");
    }

    return result.JobId;
  }

  private async extractTextSync(bucket: string, key: string): Promise<OcrResult> {
    const result = await this.textractClient.send(
      new DetectDocumentTextCommand({
        Document: {
          S3Object: {
            Bucket: bucket,
            Name: key
          }
        }
      })
    );

    return summarizeTextractBlocks(result.Blocks ?? []);
  }
}

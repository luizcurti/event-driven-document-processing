import {
  Block,
  DetectDocumentTextCommand,
  TextractClient
} from "@aws-sdk/client-textract";
import { OcrProvider } from "../../application/ports/ocr-provider";

export class AwsOcrProvider implements OcrProvider {
  constructor(private readonly textractClient = new TextractClient({})) {}

  async extractText(
    _documentId: string,
    bucket: string,
    key: string
  ): Promise<{ textPreview: string; confidence: number }> {
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

    const lines = (result.Blocks ?? [])
      .filter((block: Block) => block.BlockType === "LINE" && !!block.Text)
      .map((block: Block) => ({
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
}

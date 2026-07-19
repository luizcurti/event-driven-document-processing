import { Handler } from "aws-lambda";
import { StartExecutionCommand, SFNClient } from "@aws-sdk/client-sfn";
import { getAwsClientConfig } from "../shared/infrastructure/aws/aws-client-config";

type UploadEvent = {
  bucket: string;
  key: string;
  documentId?: string;
  stateMachineArn?: string;
};

const sfnClient = new SFNClient(getAwsClientConfig("sfn"));

function normalizeExecutionName(documentId: string): string {
  return documentId.replace(/[^0-9A-Za-z-_]/g, "-").slice(0, 80);
}

function resolveDocumentId(event: UploadEvent): string {
  if (event.documentId?.trim()) {
    return event.documentId.trim();
  }

  return event.key.split("/")[0] ?? "unknown-document";
}

export const handler: Handler<UploadEvent> = async (event) => {
  const stateMachineArn = event.stateMachineArn ?? process.env.STEP_FUNCTIONS_ARN ?? "";

  if (!stateMachineArn) {
    throw new Error("Lambda missing STEP_FUNCTIONS_ARN");
  }

  const documentId = resolveDocumentId(event);

  try {
    await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn,
        name: normalizeExecutionName(documentId),
        input: JSON.stringify({
          bucket: event.bucket,
          key: event.key,
          documentId
        })
      })
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ExecutionAlreadyExists") {
      return { ok: true, deduplicated: true, documentId };
    }
    throw error;
  }

  return { ok: true, documentId };
};

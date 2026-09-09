import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

const markProcessingMock = vi.fn(async () => undefined);

vi.mock("../../src/contexts/document-ingestion/infrastructure/adapters/aws-dynamo-metadata-repository", () => ({
  AwsDynamoMetadataRepository: vi.fn().mockImplementation(() => ({
    markProcessing: markProcessingMock
  }))
}));

describe("startWorkflowHandler", () => {
  const originalEnv = { ...process.env };
  let sendSpy: MockInstance<typeof SFNClient.prototype.send>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.STEP_FUNCTIONS_ARN = "arn:aws:states:us-east-1:000:stateMachine:doc-processing";
    process.env.DOCUMENTS_METADATA_TABLE = "documents-metadata";
    sendSpy = vi.spyOn(SFNClient.prototype, "send");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    sendSpy.mockRestore();
  });

  async function invoke(event: Record<string, unknown>) {
    const { handler } = await import("../../src/functions/start-workflow");
    return handler(event as never);
  }

  it("starts a Step Functions execution named after the documentId and marks the document PROCESSING", async () => {
    sendSpy.mockResolvedValueOnce({} as never);

    const result = await invoke({ bucket: "documents", key: "doc-1/contract.pdf", documentId: "doc-1" });

    expect(result).toEqual({ ok: true, documentId: "doc-1" });
    const command = sendSpy.mock.calls[0]![0] as StartExecutionCommand;
    expect(command).toBeInstanceOf(StartExecutionCommand);
    expect(command.input.name).toBe("doc-1");
    expect(JSON.parse(command.input.input as string)).toEqual({
      bucket: "documents",
      key: "doc-1/contract.pdf",
      documentId: "doc-1"
    });
    expect(markProcessingMock).toHaveBeenCalledWith("doc-1");
  });

  it("derives the documentId from the S3 key when the event omits it", async () => {
    sendSpy.mockResolvedValueOnce({} as never);

    await invoke({ bucket: "documents", key: "doc-2/contract.pdf" });

    const command = sendSpy.mock.calls[0]![0] as StartExecutionCommand;
    expect(command.input.name).toBe("doc-2");
    expect(markProcessingMock).toHaveBeenCalledWith("doc-2");
  });

  it("sanitizes characters not allowed in a Step Functions execution name", async () => {
    sendSpy.mockResolvedValueOnce({} as never);

    await invoke({ bucket: "documents", key: "raw/contract.pdf", documentId: "doc#3/weird name" });

    const command = sendSpy.mock.calls[0]![0] as StartExecutionCommand;
    expect(command.input.name).toBe("doc-3-weird-name");
  });

  it("treats a duplicate S3 event (ExecutionAlreadyExists) as a safe no-op, still (re-)marking PROCESSING", async () => {
    const duplicateError = new Error("Execution already exists");
    duplicateError.name = "ExecutionAlreadyExists";
    sendSpy.mockRejectedValueOnce(duplicateError);

    const result = await invoke({ bucket: "documents", key: "doc-4/contract.pdf", documentId: "doc-4" });

    expect(result).toEqual({ ok: true, deduplicated: true, documentId: "doc-4" });
    // Covers the case where the original attempt started the execution but crashed
    // before marking PROCESSING: the async retry hits ExecutionAlreadyExists here and
    // must still mark the document PROCESSING instead of leaving it stuck.
    expect(markProcessingMock).toHaveBeenCalledWith("doc-4");
  });

  it("propagates any other Step Functions error instead of swallowing it", async () => {
    sendSpy.mockRejectedValueOnce(new Error("service unavailable"));

    await expect(invoke({ bucket: "documents", key: "doc-5/contract.pdf", documentId: "doc-5" })).rejects.toThrow(
      "service unavailable"
    );
    expect(markProcessingMock).not.toHaveBeenCalled();
  });

  it("throws a ConfigurationError when STEP_FUNCTIONS_ARN is missing and the event has no stateMachineArn", async () => {
    delete process.env.STEP_FUNCTIONS_ARN;

    await expect(invoke({ bucket: "documents", key: "doc-6/contract.pdf" })).rejects.toThrow(
      "STEP_FUNCTIONS_ARN"
    );
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

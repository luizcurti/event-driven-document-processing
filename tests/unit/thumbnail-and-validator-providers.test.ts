import { describe, expect, it, vi } from "vitest";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { AwsThumbnailProvider } from "../../src/contexts/document-processing/infrastructure/adapters/aws-thumbnail-provider";
import { AwsValidatorProvider } from "../../src/contexts/document-processing/infrastructure/adapters/aws-validator-provider";

describe("AwsThumbnailProvider", () => {
  it("checks the source object exists, then writes page-1/page-2/preview PNGs and returns their keys", async () => {
    const fakeClient = { send: vi.fn(async (command: unknown) => (command instanceof HeadObjectCommand ? {} : {})) };
    const provider = new AwsThumbnailProvider(fakeClient as never);

    const result = await provider.generate("doc-1", "bucket-a", "doc-1/file.pdf");

    expect(result).toEqual({
      thumbnailKey: "thumbnails/doc-1/preview.png",
      width: 320,
      height: 200,
      pageKeys: ["thumbnails/doc-1/page-1.png", "thumbnails/doc-1/page-2.png"]
    });

    const putCommands = fakeClient.send.mock.calls
      .map(([command]) => command)
      .filter((command): command is PutObjectCommand => command instanceof PutObjectCommand);
    expect(putCommands).toHaveLength(3);
    const putKeys = putCommands.map((command) => command.input.Key).sort();
    expect(putKeys).toEqual(
      ["thumbnails/doc-1/page-1.png", "thumbnails/doc-1/page-2.png", "thumbnails/doc-1/preview.png"].sort()
    );
    for (const command of putCommands) {
      expect(command.input.ContentType).toBe("image/png");
      expect(command.input.Bucket).toBe("bucket-a");
    }
  });

  it("propagates a NotFound error from HeadObject without writing any thumbnails", async () => {
    const notFound = Object.assign(new Error("NotFound"), { name: "NotFound" });
    const fakeClient = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadObjectCommand) {
          throw notFound;
        }
        return {};
      })
    };
    const provider = new AwsThumbnailProvider(fakeClient as never);

    await expect(provider.generate("doc-2", "bucket-a", "doc-2/missing.pdf")).rejects.toThrow("NotFound");
    expect(fakeClient.send).toHaveBeenCalledTimes(1);
  });
});

describe("AwsValidatorProvider", () => {
  it("marks a normal PDF as valid with no reasons", async () => {
    const fakeClient = {
      send: vi.fn(async () => ({ ContentLength: 1024, ContentType: "application/pdf" }))
    };
    const provider = new AwsValidatorProvider(fakeClient as never);

    const result = await provider.validate("doc-1", "bucket-a", "doc-1/file.pdf");

    expect(result).toEqual({ valid: true, reasons: [] });
  });

  it("flags an empty file as invalid", async () => {
    const fakeClient = {
      send: vi.fn(async () => ({ ContentLength: 0, ContentType: "application/pdf" }))
    };
    const provider = new AwsValidatorProvider(fakeClient as never);

    const result = await provider.validate("doc-2", "bucket-a", "doc-2/empty.pdf");

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("Empty file");
  });

  it("flags a non-PDF content type as invalid", async () => {
    const fakeClient = {
      send: vi.fn(async () => ({ ContentLength: 100, ContentType: "text/plain" }))
    };
    const provider = new AwsValidatorProvider(fakeClient as never);

    const result = await provider.validate("doc-3", "bucket-a", "doc-3/notes.txt");

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("Invalid Content-Type; expected application/pdf");
  });

  it("accumulates both reasons for an empty non-PDF file", async () => {
    const fakeClient = {
      send: vi.fn(async () => ({ ContentLength: 0, ContentType: "text/plain" }))
    };
    const provider = new AwsValidatorProvider(fakeClient as never);

    const result = await provider.validate("doc-4", "bucket-a", "doc-4/bad.txt");

    expect(result.reasons).toHaveLength(2);
  });

  it("propagates a NotFound error from HeadObject for a missing object", async () => {
    const notFound = Object.assign(new Error("NotFound"), { name: "NotFound" });
    const fakeClient = { send: vi.fn(async () => { throw notFound; }) };
    const provider = new AwsValidatorProvider(fakeClient as never);

    await expect(provider.validate("doc-5", "bucket-a", "doc-5/missing.pdf")).rejects.toThrow("NotFound");
  });
});

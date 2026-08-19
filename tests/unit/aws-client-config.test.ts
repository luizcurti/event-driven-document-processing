import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigurationError,
  getAwsClientConfig,
  isLocalAwsMode,
  requireEnv
} from "../../src/shared/infrastructure/aws/aws-client-config";

const ENV_KEYS = [
  "AWS_EXECUTION_MODE",
  "LOCALSTACK_ENABLED",
  "AWS_ENDPOINT_URL",
  "AWS_ENDPOINT_URL_S3",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY"
] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
});

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

describe("requireEnv", () => {
  it("returns the value when present", () => {
    expect(requireEnv("value", "should not throw")).toBe("value");
  });

  it("throws a ConfigurationError with the given message when missing", () => {
    expect(() => requireEnv(undefined, "MISSING_VAR")).toThrow(ConfigurationError);
    expect(() => requireEnv(undefined, "MISSING_VAR")).toThrow("MISSING_VAR");
  });

  it("throws a ConfigurationError when the value is an empty string", () => {
    expect(() => requireEnv("", "EMPTY_VAR")).toThrow(ConfigurationError);
  });
});

describe("isLocalAwsMode", () => {
  it("is true when AWS_EXECUTION_MODE=local", () => {
    clearEnv();
    process.env.AWS_EXECUTION_MODE = "local";
    expect(isLocalAwsMode()).toBe(true);
  });

  it("is true when LOCALSTACK_ENABLED=true", () => {
    clearEnv();
    process.env.LOCALSTACK_ENABLED = "true";
    expect(isLocalAwsMode()).toBe(true);
  });

  it("is true when AWS_ENDPOINT_URL is set", () => {
    clearEnv();
    process.env.AWS_ENDPOINT_URL = "http://127.0.0.1:4566";
    expect(isLocalAwsMode()).toBe(true);
  });

  it("is false in cloud mode with none of the local signals set", () => {
    clearEnv();
    expect(isLocalAwsMode()).toBe(false);
  });
});

describe("getAwsClientConfig", () => {
  it("returns only region in cloud mode", () => {
    clearEnv();
    process.env.AWS_REGION = "eu-west-1";
    expect(getAwsClientConfig("s3")).toEqual({ region: "eu-west-1" });
  });

  it("defaults region to us-east-1 when nothing is set", () => {
    clearEnv();
    expect(getAwsClientConfig("s3")).toEqual({ region: "us-east-1" });
  });

  it("falls back to AWS_DEFAULT_REGION when AWS_REGION is unset", () => {
    clearEnv();
    process.env.AWS_DEFAULT_REGION = "sa-east-1";
    expect(getAwsClientConfig("s3")).toEqual({ region: "sa-east-1" });
  });

  it("adds endpoint and test credentials in local mode with a generic endpoint", () => {
    clearEnv();
    process.env.AWS_EXECUTION_MODE = "local";
    process.env.AWS_ENDPOINT_URL = "http://127.0.0.1:4566";
    expect(getAwsClientConfig("dynamodb")).toEqual({
      region: "us-east-1",
      endpoint: "http://127.0.0.1:4566",
      credentials: { accessKeyId: "test", secretAccessKey: "test" }
    });
  });

  it("prefers a service-specific endpoint override over the generic one", () => {
    clearEnv();
    process.env.AWS_EXECUTION_MODE = "local";
    process.env.AWS_ENDPOINT_URL = "http://127.0.0.1:4566";
    process.env.AWS_ENDPOINT_URL_S3 = "http://127.0.0.1:4566/s3-override";
    expect(getAwsClientConfig("s3").endpoint).toBe("http://127.0.0.1:4566/s3-override");
  });

  it("uses explicit credentials when provided in local mode", () => {
    clearEnv();
    process.env.AWS_EXECUTION_MODE = "local";
    process.env.AWS_ENDPOINT_URL = "http://127.0.0.1:4566";
    process.env.AWS_ACCESS_KEY_ID = "custom-key";
    process.env.AWS_SECRET_ACCESS_KEY = "custom-secret";
    expect(getAwsClientConfig("s3").credentials).toEqual({
      accessKeyId: "custom-key",
      secretAccessKey: "custom-secret"
    });
  });

  it("returns only region when local mode is on but no endpoint is configured", () => {
    clearEnv();
    process.env.AWS_EXECUTION_MODE = "local";
    expect(getAwsClientConfig("s3")).toEqual({ region: "us-east-1" });
  });
});

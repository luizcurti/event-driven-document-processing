import { AwsCredentialIdentity } from "@aws-sdk/types";

function normalizeServiceName(serviceName: string): string {
  return serviceName.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

export function isLocalAwsMode(): boolean {
  return (
    process.env.AWS_EXECUTION_MODE === "local" ||
    process.env.LOCALSTACK_ENABLED === "true" ||
    !!process.env.AWS_ENDPOINT_URL
  );
}

function resolveEndpoint(serviceName: string): string | undefined {
  const normalizedService = normalizeServiceName(serviceName);
  const serviceEndpoint = process.env[`AWS_ENDPOINT_URL_${normalizedService}`];
  if (serviceEndpoint) {
    return serviceEndpoint;
  }

  return process.env.AWS_ENDPOINT_URL;
}

export function getAwsClientConfig(serviceName: string): {
  region?: string;
  endpoint?: string;
  credentials?: AwsCredentialIdentity;
} {
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  const endpoint = resolveEndpoint(serviceName);

  if (!isLocalAwsMode() || !endpoint) {
    return { region };
  }

  return {
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test"
    }
  };
}
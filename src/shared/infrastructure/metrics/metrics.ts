import { Counter, Histogram, Pushgateway, Registry } from "prom-client";
import { ConsoleLogger, Logger } from "../logging/logger";

const registry = new Registry();

const invocationsTotal = new Counter({
  name: "lambda_invocations_total",
  help: "Total number of Lambda invocations by function and outcome",
  labelNames: ["function_name", "status"] as const,
  registers: [registry]
});

const invocationDuration = new Histogram({
  name: "lambda_invocation_duration_seconds",
  help: "Lambda invocation duration in seconds",
  labelNames: ["function_name", "status"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry]
});

const pushgatewayUrl = process.env.PROMETHEUS_PUSHGATEWAY_URL;
const gateway = pushgatewayUrl ? new Pushgateway(pushgatewayUrl, [], registry) : null;

async function pushMetrics(functionName: string, logger: Logger): Promise<void> {
  if (!gateway) {
    return;
  }

  try {
    await gateway.pushAdd({ jobName: functionName });
  } catch (error) {
    // Metrics delivery must never fail the invocation it is observing.
    logger.error("metrics.push_failed", {
      functionName,
      error: error instanceof Error ? error.message : "unknown"
    });
  }
}

export function withMetrics<TEvent, TResult>(
  functionName: string,
  handler: (event: TEvent) => Promise<TResult>,
  logger: Logger = new ConsoleLogger()
): (event: TEvent) => Promise<TResult> {
  return async (event: TEvent): Promise<TResult> => {
    const start = process.hrtime.bigint();
    let status: "success" | "error" = "success";

    try {
      return await handler(event);
    } catch (error) {
      status = "error";
      throw error;
    } finally {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      invocationsTotal.inc({ function_name: functionName, status });
      invocationDuration.observe({ function_name: functionName, status }, durationSeconds);
      logger.info("lambda.invocation", {
        functionName,
        status,
        durationMs: Math.round(durationSeconds * 1000)
      });
      await pushMetrics(functionName, logger);
    }
  };
}

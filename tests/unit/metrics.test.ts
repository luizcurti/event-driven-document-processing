import { describe, expect, it, vi } from "vitest";
import { withMetrics } from "../../src/shared/infrastructure/metrics/metrics";

function fakeLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

describe("withMetrics", () => {
  it("logs a success invocation and returns the handler's result", async () => {
    const logger = fakeLogger();
    const wrapped = withMetrics("test-fn", async (event: { value: number }) => event.value * 2, logger);

    const result = await wrapped({ value: 21 });

    expect(result).toBe(42);
    expect(logger.info).toHaveBeenCalledWith(
      "lambda.invocation",
      expect.objectContaining({ functionName: "test-fn", status: "success" })
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs an error invocation and rethrows the original error", async () => {
    const logger = fakeLogger();
    const wrapped = withMetrics(
      "test-fn-failure",
      async () => {
        throw new Error("boom");
      },
      logger
    );

    await expect(wrapped({})).rejects.toThrow("boom");
    expect(logger.info).toHaveBeenCalledWith(
      "lambda.invocation",
      expect.objectContaining({ functionName: "test-fn-failure", status: "error" })
    );
  });

  it("does not push metrics when PROMETHEUS_PUSHGATEWAY_URL is unset (no-op path)", async () => {
    const originalUrl = process.env.PROMETHEUS_PUSHGATEWAY_URL;
    delete process.env.PROMETHEUS_PUSHGATEWAY_URL;
    const logger = fakeLogger();
    const wrapped = withMetrics("test-fn-nopush", async () => "ok", logger);

    await expect(wrapped({})).resolves.toBe("ok");
    expect(logger.error).not.toHaveBeenCalledWith("metrics.push_failed", expect.anything());

    if (originalUrl === undefined) {
      delete process.env.PROMETHEUS_PUSHGATEWAY_URL;
    } else {
      process.env.PROMETHEUS_PUSHGATEWAY_URL = originalUrl;
    }
  });
});

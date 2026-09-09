export interface IdempotencyService {
  /**
   * Runs `work` at most once per `key`, atomically. A concurrent/retried call with the
   * same key that arrives after `work` has already completed gets the cached result
   * back without re-running `work`. A retried call that arrives while the original
   * attempt is still in flight (or died before completing) re-runs `work` instead of
   * fabricating a result, so Step Functions/SQS retries after a real transient failure
   * actually retry the operation.
   */
  withIdempotency<T>(key: string, work: () => Promise<T>): Promise<T>;
}

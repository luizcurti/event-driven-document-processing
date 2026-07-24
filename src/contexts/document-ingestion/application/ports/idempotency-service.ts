export class AlreadyProcessedError extends Error {
  constructor(key: string) {
    super(`Event already processed: ${key}`);
    this.name = "AlreadyProcessedError";
  }
}

export interface IdempotencyService {
  markProcessed(key: string): Promise<void>;
}

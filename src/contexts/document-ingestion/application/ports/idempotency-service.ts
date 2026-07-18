export interface IdempotencyService {
  ensureNotProcessed(key: string): Promise<void>;
  markProcessed(key: string): Promise<void>;
}

export interface QueuePublisher {
  publish(message: Record<string, unknown>): Promise<void>;
}

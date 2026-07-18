export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export class ConsoleLogger implements Logger {
  info(message: string, context: Record<string, unknown> = {}): void {
    console.log(JSON.stringify({ level: "INFO", message, ...context }));
  }

  error(message: string, context: Record<string, unknown> = {}): void {
    console.error(JSON.stringify({ level: "ERROR", message, ...context }));
  }
}

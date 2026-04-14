import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';
/**
 * AppLoggerService — structured JSON logger for the application.
 *
 * Wraps NestJS ConsoleLogger and ensures every log entry contains:
 *   - timestamp  (ISO-8601)
 *   - level      (log | warn | error | debug | verbose)
 *   - module     (NestJS context / class name)
 *   - message
 *
 * Note: per-request requestId enrichment is handled at the transport layer
 * (TransformInterceptor / GlobalExceptionFilter). Full AsyncLocalStorage-based
 * correlation is planned for Phase 2.
 */

@Injectable()
export class AppLoggerService extends ConsoleLogger {
  protected formatMessage(
    logLevel: LogLevel,
    message: unknown,
    pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
  ): string {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level: logLevel,
      module: this.context ?? 'Application',
      message: this.serializeMessage(message),
      pid: process.pid,
      diff: timestampDiff,
    };

    return JSON.stringify(entry) + '\n';
  }

  private serializeMessage(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message instanceof Error) return message.message;
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }
}

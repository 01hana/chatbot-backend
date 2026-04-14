import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * GlobalExceptionFilter — catches all unhandled exceptions and normalises the
 * HTTP error response into the project-wide shape:
 *   { data: null, code: <status>, requestId: <id>, error: <message> }
 *
 * Rules:
 *  - ValidationError (from ValidationPipe)  → 400
 *  - HttpException (and sub-classes)        → use exception's own status code
 *  - Everything else (unknown/unexpected)   → 500 (stack is NOT leaked)
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId ?? (request.headers['x-request-id'] as string) ?? '';

    let status: number;
    let message: string | string[];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const body = exceptionResponse as Record<string, unknown>;
        // ValidationPipe returns { message: string[], error: string, statusCode: number }
        message = (body.message as string | string[]) ?? exception.message;
      } else {
        message = exception.message;
      }
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';

      // Log the full error internally but never expose it to the client
      this.logger.error(
        `Unexpected error: ${exception instanceof Error ? exception.message : String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      data: null,
      code: status,
      requestId,
      error: message,
    });
  }
}

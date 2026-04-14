import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * RequestIdMiddleware — injects a unique X-Request-ID into every HTTP
 * request/response pair.
 *
 * Precedence: incoming X-Request-ID header > auto-generated UUID v4.
 * The id is:
 *   1. Written back to the response header so it round-trips to the client.
 *   2. Stored on `req.requestId` for downstream middleware, filters, and
 *      interceptors to read without re-parsing headers.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string | undefined) || randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  }
}

import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request, Response } from 'express';

export interface StandardResponse<T> {
  data: T;
  code: number;
  requestId: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, StandardResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<StandardResponse<T>> {
    const req = context.switchToHttp().getRequest<Request & { requestId?: string }>();
    const res = context.switchToHttp().getResponse<Response>();
    const requestId = req.requestId ?? (req.headers['x-request-id'] as string) ?? '';

    return next.handle().pipe(
      map(data => ({
        data,
        code: res.statusCode,
        requestId,
      })),
    );
  }
}

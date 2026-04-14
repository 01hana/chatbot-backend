import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AppLoggerService } from './common/logger/app-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Use structured JSON logger for all NestJS internal logs
    logger: new AppLoggerService(),
    bufferLogs: true,
  });

  // All routes are prefixed with /api/v1
  app.setGlobalPrefix('api/v1');

  // Validate and strip unknown fields from all incoming request bodies
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Normalise all error responses — must be registered before the interceptor
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Wrap all successful responses in { data, code, requestId }
  app.useGlobalInterceptors(new TransformInterceptor());

  app.enableCors();

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
}

bootstrap();


import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { HealthModule } from './health/health.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { SafetyModule } from './safety/safety.module';
import { IntentModule } from './intent/intent.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { ConversationModule } from './conversation/conversation.module';
import { ChatModule } from './chat/chat.module';
import { WidgetConfigModule } from './widget-config/widget-config.module';

@Module({
  imports: [
    // Config — must be first so that ConfigService is available to all modules
    ConfigModule.forRoot({ isGlobal: true }),

    // Rate limiting — reads RATE_LIMIT_PER_IP_PER_MIN from env (default 60/min).
    // TODO Phase 2: migrate to SystemConfigService.getNumberOrDefault() so the
    //               limit can be changed at runtime without restart.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: 60_000, // 1-minute window
          limit: configService.get<number>('RATE_LIMIT_PER_IP_PER_MIN') ?? 60,
        },
      ],
    }),

    PrismaModule,
    SystemConfigModule,
    HealthModule,
    SafetyModule,
    IntentModule,
    KnowledgeModule,
    AdminModule,
    AuditModule,
    ConversationModule,
    ChatModule,
    WidgetConfigModule,
  ],
  providers: [
    // Apply ThrottlerGuard globally to all routes
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  /** Apply RequestIdMiddleware to every incoming request. */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}

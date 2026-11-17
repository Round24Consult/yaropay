import { type DynamicModule, type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common"
import { APP_FILTER, APP_GUARD } from "@nestjs/core"
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler"
import { AnalyticsModule } from "./analytics/analytics.module.js"
import { AuditModule } from "./audit/audit.module.js"
import { AuthModule } from "./auth/auth.module.js"
import { PermissionsGuard, SessionGuard } from "./auth/guards.js"
import { EncryptionModule } from "./common/encryption.service.js"
import { ApiExceptionFilter } from "./common/exception.filter.js"
import { HttpModule } from "./common/http.js"
import { OriginMiddleware } from "./common/origin.middleware.js"
import type { AppConfig } from "./config/config.js"
import { ConfigModule } from "./config/config.module.js"
import { DatabaseModule } from "./database/database.module.js"
import { COMMUNITY } from "./extension/community.js"
import { ExtensionPointsModule } from "./extension/extension-points.module.js"
import type { Extension } from "./extension/extension.js"
import { FeatureGuard } from "./extension/features.js"
import { GatewaysModule } from "./gateways/gateways.module.js"
import { HealthController } from "./health/health.controller.js"
import { NotificationsModule } from "./notifications/notifications.module.js"
import { PaymentsModule } from "./payments/payments.module.js"
import { ProductsModule } from "./products/products.module.js"
import { OnboardingModule } from "./onboarding/onboarding.module.js"
import { SettingsModule } from "./settings/settings.module.js"
import { TeamModule } from "./team/team.module.js"
import { TransactionsModule } from "./transactions/transactions.module.js"
import { WebhooksModule } from "./webhooks/webhooks.module.js"
import { WorkspacesModule } from "./workspaces/workspaces.module.js"

@Module({})
export class AppModule implements NestModule {
  /** `ext` is the paid build's extension (see extension/load.ts); without it the app runs as Community. */
  static forRoot(config?: AppConfig, ext: Extension = COMMUNITY): DynamicModule {
    const rateLimit = config?.rateLimit ?? true
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        ThrottlerModule.forRoot({ throttlers: [{ name: "default", ttl: 60_000, limit: 600 }], skipIf: () => !rateLimit }),
        DatabaseModule,
        ExtensionPointsModule.forRoot(ext),
        HttpModule,
        EncryptionModule,
        WorkspacesModule,
        AuditModule,
        SettingsModule,
        OnboardingModule,
        NotificationsModule,
        AuthModule,
        TeamModule,
        GatewaysModule,
        WebhooksModule,
        ProductsModule,
        TransactionsModule,
        AnalyticsModule,
        PaymentsModule,
        ...ext.modules,
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_GUARD, useClass: FeatureGuard },
      ],
    }
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(OriginMiddleware).forRoutes("api/*path")
  }
}

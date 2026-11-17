import { Module } from "@nestjs/common"
import { ApiKeyGuard } from "./api-key.guard.js"
import { PaymentsService } from "./payments.service.js"
import { WorkspaceRateLimiter } from "./workspace-rate-limiter.js"
import { CallbackController, GatewayWebhookController, PaymentsController } from "./public.controller.js"

@Module({
  providers: [PaymentsService, ApiKeyGuard, WorkspaceRateLimiter],
  controllers: [PaymentsController, CallbackController, GatewayWebhookController],
  exports: [PaymentsService],
})
export class PaymentsModule {}

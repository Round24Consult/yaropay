import { Global, Module } from "@nestjs/common"
import { DeliveriesService } from "./deliveries.service.js"
import { EventsService } from "./events.service.js"
import { WebhooksController } from "./webhooks.controller.js"

@Global()
@Module({ providers: [DeliveriesService, EventsService], controllers: [WebhooksController], exports: [DeliveriesService, EventsService] })
export class WebhooksModule {}

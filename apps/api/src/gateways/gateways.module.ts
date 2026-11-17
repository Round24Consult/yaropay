import { Global, Module } from "@nestjs/common"
import { ConnectionsService } from "./connections.service.js"
import { GatewaysController } from "./gateways.controller.js"

@Global()
@Module({ providers: [ConnectionsService], controllers: [GatewaysController], exports: [ConnectionsService] })
export class GatewaysModule {}

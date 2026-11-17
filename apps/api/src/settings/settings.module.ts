import { Global, Module } from "@nestjs/common"
import { SettingsController } from "./settings.controller.js"
import { OperatorSettingsService } from "./operator-settings.service.js"
import { SettingsService } from "./settings.service.js"

@Global()
@Module({ providers: [SettingsService, OperatorSettingsService], controllers: [SettingsController], exports: [SettingsService, OperatorSettingsService] })
export class SettingsModule {}

import { Global, Module } from "@nestjs/common"
import { SettingsController } from "./settings.controller.js"
import { SettingsService } from "./settings.service.js"

@Global()
@Module({ providers: [SettingsService], controllers: [SettingsController], exports: [SettingsService] })
export class SettingsModule {}

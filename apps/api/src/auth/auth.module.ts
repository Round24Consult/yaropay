import { Global, Module } from "@nestjs/common"
import { AuthController } from "./auth.controller.js"
import { AuthService } from "./auth.service.js"
import { MfaService } from "./mfa.service.js"
import { TrustedBrowsersService } from "./trusted-browsers.js"

@Global()
@Module({ providers: [AuthService, MfaService, TrustedBrowsersService], controllers: [AuthController], exports: [AuthService, MfaService, TrustedBrowsersService] })
export class AuthModule {}

import { Global, Module } from "@nestjs/common"
import { AuthController } from "./auth.controller.js"
import { AuthService } from "./auth.service.js"
import { MfaService } from "./mfa.service.js"

@Global()
@Module({ providers: [AuthService, MfaService], controllers: [AuthController], exports: [AuthService, MfaService] })
export class AuthModule {}

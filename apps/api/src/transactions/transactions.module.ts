import { Global, Module } from "@nestjs/common"
import { TransactionsController } from "./transactions.controller.js"
import { TransactionsService } from "./transactions.service.js"

@Global()
@Module({ providers: [TransactionsService], controllers: [TransactionsController], exports: [TransactionsService] })
export class TransactionsModule {}

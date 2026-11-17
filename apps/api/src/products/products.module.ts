import { Global, Module } from "@nestjs/common"
import { ProductsController } from "./products.controller.js"
import { ProductsService } from "./products.service.js"

@Global()
@Module({ providers: [ProductsService], controllers: [ProductsController], exports: [ProductsService] })
export class ProductsModule {}

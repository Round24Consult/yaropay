import { Global, Module } from "@nestjs/common"
import { AlertsService } from "./alerts.service.js"
import { JobsService } from "./jobs.service.js"
import { MailerService } from "./mailer.service.js"
import { NotificationsController } from "./notifications.controller.js"
import { NotificationsService } from "./notifications.service.js"

@Global()
@Module({
  providers: [MailerService, JobsService, AlertsService, NotificationsService],
  controllers: [NotificationsController],
  exports: [MailerService, JobsService, AlertsService, NotificationsService],
})
export class NotificationsModule {}

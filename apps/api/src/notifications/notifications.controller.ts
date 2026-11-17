import { Controller, Get, HttpCode, Param, Post, Put, Query, Sse, type MessageEvent } from "@nestjs/common"
import { notificationPreferencesSchema, type NotificationPreference } from "@yaropay/core/notifications"
import { filter, interval, map, merge, type Observable } from "rxjs"
import { CurrentUser } from "../auth/decorators.js"
import type { Actor } from "../auth/types.js"
import { notFound } from "../common/errors.js"
import { int, type Query as Q, str } from "../common/query.js"
import { ZodBody } from "../common/zod.js"
import { NotificationsService } from "./notifications.service.js"

@Controller("api/notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: Actor, @Query() q: Q) {
    return this.notifications.list(user, {
      page: int(q, "page", 1),
      pageSize: int(q, "pageSize", 20, 100),
      unreadOnly: str(q, "unread") === "1" || str(q, "unread") === "true",
    })
  }

  /** Server-sent events: `notification` for each new item, `ping` every 25 s to keep proxies open. */
  @Sse("stream")
  stream(@CurrentUser() user: Actor): Observable<MessageEvent> {
    const own = this.notifications.stream$.pipe(
      filter((e) => e.userId === user.id && e.workspaceId === user.workspaceId),
      map((e): MessageEvent => ({ type: "notification", data: e.notification, id: e.notification.id })),
    )
    const ping = interval(25_000).pipe(map((): MessageEvent => ({ type: "ping", data: { at: new Date().toISOString() } })))
    return merge(own, ping)
  }

  @Get("preferences")
  preferences(@CurrentUser() user: Actor) {
    return this.notifications.preferences(user)
  }

  @Put("preferences")
  savePreferences(@CurrentUser() user: Actor, @ZodBody(notificationPreferencesSchema) body: NotificationPreference[]) {
    return this.notifications.savePreferences(user, body)
  }

  @Post("read-all")
  @HttpCode(200)
  async readAll(@CurrentUser() user: Actor) {
    return { updated: await this.notifications.markAllRead(user) }
  }

  @Post(":id/read")
  @HttpCode(200)
  async read(@CurrentUser() user: Actor, @Param("id") id: string) {
    const n = await this.notifications.markRead(user, id)
    if (!n) throw notFound("Notification")
    return n
  }
}

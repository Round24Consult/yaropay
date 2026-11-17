import { Inject, Injectable, Logger } from "@nestjs/common"
import { hasPermission, type Role } from "@yaropay/core/auth"
import {
  type AppNotification,
  NOTIFICATION_TYPES,
  type NotificationList,
  type NotificationPreference,
  type NotificationSeverity,
  type NotificationType,
  notificationType,
} from "@yaropay/core/notifications"
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm"
import { Subject } from "rxjs"
import type { Actor } from "../auth/types.js"
import { newId } from "../common/crypto.js"
import { pageMeta } from "../common/query.js"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { DB } from "../database/database.module.js"
import type { Db } from "../database/db.js"
import { type NotificationRow, notificationPreferences, notifications, users, workspaceMembers } from "../database/schema.js"
import { SettingsService } from "../settings/settings.service.js"
import { AlertsService } from "./alerts.service.js"
import { JobsService } from "./jobs.service.js"
import { MailerService, renderEmail } from "./mailer.service.js"

export interface NotifyInput {
  /** The workspace the event happened in: only its members hear about it. */
  workspaceId: string
  type: NotificationType
  title: string
  body: string
  link?: string | null
  severity?: NotificationSeverity
  productId?: string | null
  /** Personal notifications (security) go to this member only. */
  userId?: string
  /** The member the event is about, who doesn't need to hear about it (e.g. the person who just joined). */
  excludeUserId?: string
  /** Collapses bursts: at most one notification per key per window. */
  throttleKey?: string
  throttleMs?: number
}

export function toNotificationDto(r: NotificationRow): AppNotification {
  return {
    id: r.id,
    type: r.type as NotificationType,
    title: r.title,
    body: r.body,
    link: r.link,
    severity: r.severity as NotificationSeverity,
    productId: r.productId,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger("Notifications")
  /** Live feed for the SSE endpoint. */
  readonly stream$ = new Subject<{ userId: string; workspaceId: string; notification: AppNotification }>()
  private readonly lastSent = new Map<string, number>()

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly jobs: JobsService,
    private readonly mailer: MailerService,
    private readonly alerts: AlertsService,
    private readonly settings: SettingsService,
  ) {
    this.jobs.register("email", async (p) => {
      await this.mailer.send({ to: String(p.to), subject: String(p.subject), text: String(p.text), html: p.html ? String(p.html) : undefined })
    })
    this.jobs.register("alert", async (p) => {
      const url = await this.settings.alertsWebhookUrl(String(p.workspaceId))
      if (url) await this.alerts.post(String(p.text), url)
    })
  }

  /** Fans a notification out to everyone allowed to see it, per their channel preferences. Never throws. */
  async notify(input: NotifyInput): Promise<number> {
    try {
      return await this.deliver(input)
    } catch (e) {
      this.logger.error(`Could not send ${input.type}: ${(e as Error).message}`)
      return 0
    }
  }

  private async deliver(input: NotifyInput): Promise<number> {
    if (input.throttleKey) {
      const key = `${input.type}:${input.throttleKey}`
      const last = this.lastSent.get(key) ?? 0
      if (Date.now() - last < (input.throttleMs ?? 15 * 60_000)) return 0
      this.lastSent.set(key, Date.now())
    }
    const def = notificationType(input.type)
    const active = await this.db
      .select({ id: users.id, email: users.email, name: users.name, role: workspaceMembers.role, productIds: workspaceMembers.productIds })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          isNull(workspaceMembers.disabledAt),
          input.userId ? eq(users.id, input.userId) : undefined,
        ),
      )
    const recipients = active.filter((u) => {
      if (input.userId) return true
      if (input.excludeUserId === u.id) return false
      if (def.permission && !hasPermission({ role: u.role as Role }, def.permission)) return false
      if (input.productId && u.productIds && !u.productIds.includes(input.productId)) return false
      if (def.installWide && u.productIds) return false
      return true
    })
    if (!recipients.length && !def.alert) return 0

    const prefs = recipients.length
      ? await this.db
          .select()
          .from(notificationPreferences)
          .where(and(eq(notificationPreferences.type, input.type), inArray(notificationPreferences.userId, recipients.map((r) => r.id))))
      : []
    const prefOf = new Map(prefs.map((p) => [p.userId, p]))
    const severity = input.severity ?? "info"
    const settings = await this.settings.install()
    const alertsUrl = def.alert ? await this.settings.alertsWebhookUrl(input.workspaceId) : null
    const rows: NotificationRow[] = []

    for (const user of recipients) {
      const pref = prefOf.get(user.id)
      const inApp = pref ? pref.inApp : def.defaults.inApp
      const email = pref ? pref.email : def.defaults.email
      if (inApp) {
        const [row] = await this.db
          .insert(notifications)
          .values({
            id: newId("ntf"),
            workspaceId: input.workspaceId,
            userId: user.id,
            type: input.type,
            title: input.title,
            body: input.body,
            link: input.link ?? null,
            severity,
            productId: input.productId ?? null,
          })
          .returning()
        rows.push(row)
        this.stream$.next({ userId: user.id, workspaceId: input.workspaceId, notification: toNotificationDto(row) })
      }
      if (email) {
        const mail = renderEmail({
          platform: settings.platformName,
          heading: input.title,
          lines: [input.body, `You get this because of your notification settings in ${settings.platformName}.`],
          action: input.link ? { label: "Open dashboard", url: `${this.config.dashboardUrl}${input.link}` } : undefined,
        })
        await this.jobs.enqueue("email", { to: user.email, subject: `[${settings.platformName}] ${input.title}`, ...mail })
      }
    }

    if (def.alert && alertsUrl) {
      const icon = severity === "critical" ? ":rotating_light:" : severity === "warning" ? ":warning:" : ":information_source:"
      const link = input.link ? ` <${this.config.dashboardUrl}${input.link}|Open>` : ""
      await this.jobs.enqueue("alert", { workspaceId: input.workspaceId, text: `${icon} *${input.title}*\n${input.body}${link}` }, { maxAttempts: 3 })
    }
    return rows.length
  }

  async list(user: Actor, opts: { page: number; pageSize: number; unreadOnly: boolean }): Promise<NotificationList> {
    const mine = and(eq(notifications.userId, user.id), eq(notifications.workspaceId, user.workspaceId))
    const where = opts.unreadOnly ? and(mine, isNull(notifications.readAt)) : mine
    const [{ total }] = await this.db.select({ total: count() }).from(notifications).where(where)
    const [{ unread }] = await this.db
      .select({ unread: count() })
      .from(notifications)
      .where(and(mine, isNull(notifications.readAt)))
    const meta = pageMeta(total, opts.page, opts.pageSize)
    const rows = await this.db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(meta.pageSize)
      .offset(meta.offset)
    return { rows: rows.map(toNotificationDto), total, page: meta.page, pageSize: meta.pageSize, pages: meta.pages, unread }
  }

  async markRead(user: Actor, id: string): Promise<AppNotification | null> {
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id), eq(notifications.workspaceId, user.workspaceId)))
      .returning()
    return row ? toNotificationDto(row) : null
  }

  async markAllRead(user: Actor): Promise<number> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, user.id), eq(notifications.workspaceId, user.workspaceId), isNull(notifications.readAt)))
      .returning({ id: notifications.id })
    return rows.length
  }

  /** Types this member can receive, with their current channels. */
  async preferences(user: Actor): Promise<NotificationPreference[]> {
    const saved = await this.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, user.id))
    const byType = new Map(saved.map((p) => [p.type, p]))
    const receives = (d: (typeof NOTIFICATION_TYPES)[number]) => (!d.permission || hasPermission(user, d.permission)) && !(d.installWide && user.productIds)
    return NOTIFICATION_TYPES.filter(receives).map((d) => {
      const p = byType.get(d.type)
      return { type: d.type, inApp: p ? p.inApp : d.defaults.inApp, email: p ? p.email : d.defaults.email }
    })
  }

  async savePreferences(user: Actor, input: NotificationPreference[]): Promise<NotificationPreference[]> {
    const allowed = new Set((await this.preferences(user)).map((p) => p.type))
    for (const p of input) {
      if (!allowed.has(p.type)) continue
      await this.db
        .insert(notificationPreferences)
        .values({ userId: user.id, type: p.type, inApp: p.inApp, email: p.email })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.type],
          set: { inApp: p.inApp, email: p.email },
        })
    }
    return this.preferences(user)
  }
}

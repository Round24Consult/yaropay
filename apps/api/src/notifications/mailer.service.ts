import { Inject, Injectable, Logger } from "@nestjs/common"
import nodemailer, { type Transporter } from "nodemailer"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { OperatorSettingsService } from "../settings/operator-settings.service.js"

export interface Mail {
  to: string
  subject: string
  text: string
  html?: string
}

/**
 * Sends email over SMTP. The server is the one saved in the platform console, otherwise SMTP_URL; the
 * sender likewise comes from the console or MAIL_FROM. Without an SMTP server, emails are logged and
 * kept in `outbox` (useful in development and tests). A changed SMTP URL takes effect on the next email.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger("Mailer")
  private transport: Transporter | null = null
  private transportUrl: string | null = null
  readonly outbox: Mail[] = []
  /** Builds the SMTP transport for a URL. Tests swap it for a fake. */
  transportFactory: (url: string) => Transporter = (url) => nodemailer.createTransport(url)

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly operator: OperatorSettingsService,
  ) {}

  get enabled(): boolean {
    return (this.operator.current().smtpUrl ?? this.config.smtpUrl) !== null
  }

  async send(mail: Mail): Promise<void> {
    const saved = await this.operator.get()
    const transport = this.transportFor(saved.smtpUrl ?? this.config.smtpUrl)
    if (!transport) {
      this.outbox.push(mail)
      if (this.outbox.length > 100) this.outbox.shift()
      if (this.config.env !== "test") this.logger.log(`Email to ${mail.to}: ${mail.subject}\n${mail.text}`)
      return
    }
    await transport.sendMail({ from: saved.mailFrom ?? this.config.mailFrom, ...mail })
  }

  /** The transport for this URL, rebuilt when the URL changes. */
  private transportFor(url: string | null): Transporter | null {
    if (url !== this.transportUrl) {
      this.transport?.close()
      this.transport = url ? this.transportFactory(url) : null
      this.transportUrl = url
    }
    return this.transport
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Plain, client-safe HTML around a short message and one action button. */
export function renderEmail(opts: { platform: string; heading: string; lines: string[]; action?: { label: string; url: string } }) {
  const text = [opts.heading, "", ...opts.lines, ...(opts.action ? ["", `${opts.action.label}: ${opts.action.url}`] : [])].join("\n")
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f8;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border:1px solid #e4e4e7;border-radius:16px" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 28px 8px;font-size:13px;font-weight:600;color:#4f46e5">${esc(opts.platform)}</td></tr>
<tr><td style="padding:0 28px;font-size:20px;font-weight:600">${esc(opts.heading)}</td></tr>
<tr><td style="padding:12px 28px 4px;font-size:14px;line-height:22px;color:#3f3f46">${opts.lines.map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join("")}</td></tr>
${opts.action ? `<tr><td style="padding:8px 28px 28px"><a href="${esc(opts.action.url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:10px">${esc(opts.action.label)}</a></td></tr>` : `<tr><td style="padding:0 0 20px"></td></tr>`}
</table></td></tr></table></body></html>`
  return { text, html }
}

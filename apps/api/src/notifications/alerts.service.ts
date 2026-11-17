import { Inject, Injectable } from "@nestjs/common"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { FETCH, type FetchFn } from "../common/http.js"

/**
 * Posts operational alerts to an incoming-webhook URL. The body carries both
 * `text` (Slack, Teams, Mattermost, Google Chat) and `content` (Discord).
 */
@Injectable()
export class AlertsService {
  constructor(
    @Inject(FETCH) private readonly fetch: FetchFn,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async post(text: string, url: string): Promise<void> {
    const res = await this.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, content: text.replace(/<([^|>]+)\|([^>]+)>/g, "$2: $1") }),
      signal: AbortSignal.timeout(this.config.webhookTimeoutMs),
    })
    if (!res.ok) throw new Error(`Alert webhook answered ${res.status}`)
  }
}

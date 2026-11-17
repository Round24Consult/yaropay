"use client"

import { CopyField } from "@/components/shared/copy-field"
import type { GatewayDefinition } from "@yaropay/core/gateways/types"
import type { GatewayConnection } from "@yaropay/core/types"
import { gatewayCallbackUrl, gatewayWebhookUrl } from "@yaropay/core/urls"
import { useSettings } from "@/lib/api/hooks"

/** The URLs a user pastes into the gateway's dashboard, plus where to paste them. */
export function SetupGuide({ gateway, connection }: { gateway: GatewayDefinition; connection: GatewayConnection }) {
  const { data: settings } = useSettings()
  const base = settings?.baseUrl ?? ""
  const webhook = gatewayWebhookUrl(base, gateway.id, connection.id)
  const callback = gatewayCallbackUrl(base, gateway.id, connection.id)
  return (
    <div className="space-y-5">
      <div className="space-y-4 rounded-xl border p-4">
        <CopyField
          label="Webhook URL"
          value={webhook}
          testId="gateway-webhook-url"
          hint={`${gateway.name} sends every event for this account here. YaroPay verifies ${gateway.webhook.signatureHeader} and routes it to the right product.`}
        />
        <CopyField
          label="Fallback callback URL"
          value={callback}
          hint="Each product gets its own callback URL. This one is only used when a payment arrives without one."
        />
      </div>
      <ol className="space-y-2.5">
        {gateway.dashboardSetupSteps.map((step, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary font-mono text-[11px] font-semibold">
              {i + 1}
            </span>
            <span className="text-muted-foreground">{step}</span>
          </li>
        ))}
      </ol>
      {gateway.webhookIps && (
        <p className="text-xs text-muted-foreground">
          Optional: only accept webhooks from {gateway.name}&apos;s IPs{" "}
          {gateway.webhookIps.map((ip, i) => (
            <span key={ip}>
              <code className="rounded bg-muted px-1 font-mono">{ip}</code>
              {i < gateway.webhookIps!.length - 1 ? ", " : "."}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

"use client"

import { ArrowRight, Info, Route, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { CodeBlock } from "@/components/shared/code-block"
import { CopyField } from "@/components/shared/copy-field"
import { GatewayMark } from "@/components/shared/gateway-mark"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { requireGateway } from "@yaropay/core/gateways/registry"
import { PRODUCT_METADATA_KEY } from "@yaropay/core/routing"
import type { GatewayConnection, Product } from "@yaropay/core/types"
import {
  gatewayWebhookUrl,
  PLATFORM_SIGNATURE_HEADER,
  productCallbackUrl,
  productCancelUrl,
  productPaymentsEndpoint,
} from "@yaropay/core/urls"
import { useMode } from "@/lib/mode"
import { createPaymentSnippets, directModeSnippet, verifyWebhookSnippet } from "@/lib/snippets"

interface Props {
  product: Product
  baseUrl: string
  connections: GatewayConnection[]
  /** Full secrets, only right after creation or rotation. */
  secrets?: { apiKey?: string; testApiKey?: string; signingSecret?: string }
}

const shownOnce = <Badge className="bg-warning/15 text-warning-text">Shown once</Badge>

/** Every generated URL and key a product needs, derived from the base URL in Settings. */
export function IntegrationPanel({ product, baseUrl, connections, secrets }: Props) {
  const attached = product.gateways
    .map((g) => ({ ...g, connection: connections.find((c) => c.id === g.connectionId) }))
    .filter((g): g is typeof g & { connection: GatewayConnection } => !!g.connection)
  const gatewayIds = [...new Set(attached.map((a) => a.connection.gatewayId))]
  const { mode } = useMode()
  const modeSecret = mode === "live" ? secrets?.apiKey : secrets?.testApiKey
  const keys =
    secrets?.apiKey && secrets?.testApiKey
      ? [
          { mode: "live" as const, value: secrets.apiKey, once: true },
          { mode: "test" as const, value: secrets.testApiKey, once: true },
        ]
      : [{ mode, value: modeSecret ?? (mode === "live" ? product.apiKeyPreview : product.testApiKeyPreview), once: !!modeSecret }]
  const snippets = createPaymentSnippets({
    baseUrl,
    productId: product.id,
    apiKey: modeSecret,
    prefix: product.referencePrefix,
    mode,
  })
  const firstPaystack = gatewayIds.includes("paystack") ? productCallbackUrl(baseUrl, product.id, "paystack") : null

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <div className="min-w-0 space-y-6 xl:col-span-3">
        <Panel>
          <PanelHeader
            title="Callback URLs"
            description={`One per gateway. The gateway returns the customer here; YaroPay verifies the payment, then sends them to ${product.name}'s success, failure or cancel page.`}
          />
          <div className="space-y-5 p-5">
            {gatewayIds.length === 0 && (
              <p className="text-sm text-muted-foreground">Attach a gateway to generate callback URLs.</p>
            )}
            {gatewayIds.map((gid) => {
              const g = requireGateway(gid)
              return (
                <div key={gid} className="space-y-3 rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <GatewayMark gatewayId={gid} size="sm" />
                    <span className="text-sm font-medium">{g.name}</span>
                    <code className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {g.redirects.callbackField}
                    </code>
                  </div>
                  <CopyField
                    label="Callback URL"
                    value={productCallbackUrl(baseUrl, product.id, gid)}
                    testId={`callback-url-${gid}`}
                    hint={
                      g.redirects.statusParam
                        ? `${g.name} appends ${g.redirects.statusParam}=successful|cancelled|failed. YaroPay verifies it, then redirects.`
                        : `YaroPay verifies the reference with ${g.name} before redirecting.`
                    }
                  />
                  {g.redirects.cancel && (
                    <CopyField
                      label="Cancel URL"
                      value={productCancelUrl(baseUrl, product.id, gid)}
                      hint={`Sent as ${g.redirects.cancelField}. Customers who close the checkout land on ${product.cancelUrl ? "your cancel page" : "your failure page"}.`}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Start a payment" description="Your server calls YaroPay with this product's API key. YaroPay picks the gateway, stamps the reference and returns a checkout link." />
          <div className="space-y-4 p-5">
            <CopyField label="Payments endpoint" value={productPaymentsEndpoint(baseUrl, product.id)} />
            <CodeBlock
              tabs={[
                { label: "cURL", code: snippets.curl },
                { label: "Node.js", code: snippets.node },
                ...(firstPaystack
                  ? [{ label: "Direct mode", code: directModeSnippet({ callbackUrl: firstPaystack, productId: product.id, prefix: product.referencePrefix }) }]
                  : []),
              ]}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Receive payment events"
            description={`YaroPay forwards events only for ${product.name}, signed with this product's secret.`}
          />
          <div className="space-y-4 p-5">
            <CopyField label="Your webhook endpoint" value={product.webhookUrl} hint="Change it under Settings on this product." />
            <CodeBlock tabs={[{ label: "Verify signature (Node.js)", code: verifyWebhookSnippet() }]} />
          </div>
        </Panel>
      </div>

      <div className="min-w-0 space-y-6 xl:col-span-2">
        <Panel>
          <PanelHeader title="Keys" description="Use them on your server only." />
          <div className="space-y-4 p-5">
            <CopyField label="Product ID" value={product.id} />
            {keys.map((k) => (
              <CopyField
                key={k.mode}
                label={k.mode === "live" ? "Live API key" : "Test API key"}
                value={k.value}
                badge={k.once ? shownOnce : null}
                testId={keys.length === 1 || k.mode === "live" ? "api-key" : "test-api-key"}
                hint={
                  keys.length === 1
                    ? `Payments made with this key use your ${k.mode} gateway accounts. Switch to ${k.mode === "live" ? "Test" : "Live"} mode to see the other key.`
                    : `Payments made with this key use your ${k.mode} gateway accounts.`
                }
              />
            ))}
            <CopyField
              label="Webhook signing secret"
              value={secrets?.signingSecret ?? product.signingSecretPreview}
              badge={secrets?.signingSecret ? shownOnce : null}
              hint={
                <>
                  Verifies the <code className="font-mono">{PLATFORM_SIGNATURE_HEADER}</code> header: HMAC-SHA256 of the timestamp and the raw body.
                </>
              }
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="How YaroPay knows it's yours" />
          <div className="space-y-4 p-5 text-sm">
            <div className="flex gap-3">
              <Route className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">
                Every payment {product.name} starts gets the reference prefix{" "}
                <code className="rounded bg-muted px-1 font-mono text-foreground">{product.referencePrefix}_</code> and{" "}
                <code className="rounded bg-muted px-1 font-mono text-foreground">
                  metadata.{PRODUCT_METADATA_KEY}
                </code>
                . When the gateway&apos;s webhook arrives, YaroPay matches it and forwards it to {product.name} only.
              </p>
            </div>
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">
                Gateway webhooks are shared by every product on the same account. You set them once per account:
              </p>
            </div>
            <ul className="space-y-2">
              {attached.map(({ connection, isDefault }) => (
                <li key={connection.id} className="rounded-lg border p-2.5">
                  <div className="mb-1.5 flex items-center gap-2 text-xs">
                    <GatewayMark gatewayId={connection.gatewayId} size="sm" />
                    <span className="font-medium">{requireGateway(connection.gatewayId).name}</span>
                    <span className="text-muted-foreground">· {connection.label}</span>
                    {isDefault && <Badge variant="secondary" className="ml-auto">Default</Badge>}
                  </div>
                  <code className="block truncate font-mono text-[11px] text-muted-foreground" title={gatewayWebhookUrl(baseUrl, connection.gatewayId, connection.id)}>
                    {gatewayWebhookUrl(baseUrl, connection.gatewayId, connection.id)}
                  </code>
                  <Link href={`/apps/${connection.id}`} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    Setup guide <ArrowRight className="size-3" />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Payments made outside YaroPay (for example a gateway payment page) have no prefix. They show up as Unrouted under Webhooks and are never forwarded.
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}

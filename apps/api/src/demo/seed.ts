import { maskCredentials } from "@yaropay/core/gateways/credentials"
import { requireGateway } from "@yaropay/core/gateways/registry"
import { API_KEY_PREFIX, SIGNING_SECRET_PREFIX } from "@yaropay/core/payments"
import { asc, count, inArray, sql } from "drizzle-orm"
import { hashPassword } from "../auth/password.js"
import { encrypt, newId, randomSecret, secretPreview, sha256 } from "../common/crypto.js"
import type { AppConfig } from "../config/config.js"
import type { Db, DbOrTx } from "../database/db.js"
import {
  auditLog,
  connections,
  productGateways,
  products,
  settings,
  transactions,
  users,
  webhookDeliveries,
  webhookEvents,
  workspaceMembers,
  workspaces,
} from "../database/schema.js"
import { generateDemo } from "./generate.js"

export interface SeedOptions {
  /** Replace existing products, payments and gateway accounts. Team members are kept. */
  force?: boolean
  /** Send demo deliveries to `<webhookBase>/<product-slug>` instead of example.com. */
  webhookBase?: string
  /** Creates this owner when the install has no users yet. */
  owner?: { name: string; email: string; password: string }
  /** The sample company's name (default "Company A"). */
  companyName?: string
  log?: (line: string) => void
}

async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>, size = 400) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size))
}

export type SampleKeys = Record<string, { live: string; test: string; signingSecret: string }>

/**
 * Inserts the sample company: gateway accounts with fake keys, three products,
 * about a year of payments, gateway events and deliveries. Every product,
 * gateway account and audit row is flagged `sample`, so it can be removed
 * later without touching real data. Returns the product keys (shown once).
 */
export async function insertSampleData(
  db: DbOrTx,
  config: Pick<AppConfig, "encryptionKey">,
  opts: { workspaceId: string; webhookBase?: string; now?: number; ownerName?: string },
) {
  const demo = generateDemo(opts.now ?? Date.now(), { webhookBase: opts.webhookBase, ownerName: opts.ownerName })
  const workspaceId = opts.workspaceId
  // The sample company uses readable fixed IDs (prd_shopwise, con_ps_main). When another workspace on
  // the install already has them, this one's copies get a suffix so IDs stay unique.
  const [clash] = await db.select({ id: products.id }).from(products).where(inArray(products.id, demo.products.map((p) => p.id)))
  const suffix = clash ? `_${workspaceId.slice(-6)}` : ""
  const cid = (id: string) => `${id}${suffix}`
  const pid = (id: string) => `${id}${suffix}`
  const pidOrNull = (id: string | null) => (id ? pid(id) : null)

  await db.insert(connections).values(
    demo.connections.map((c) => ({
      id: cid(c.id),
      workspaceId,
      gatewayId: c.gatewayId,
      label: c.label,
      mode: c.mode,
      credentialsEnc: encrypt(config.encryptionKey, JSON.stringify(c.credentials)),
      credentialsMasked: maskCredentials(requireGateway(c.gatewayId), c.credentials),
      sample: true,
      createdAt: c.createdAt,
      lastEventAt: demo.lastEvent.get(c.id) ?? null,
    })),
  )

  const keys: SampleKeys = {}
  await db.insert(products).values(
    demo.products.map((p) => {
      const live = randomSecret(API_KEY_PREFIX.live)
      const test = randomSecret(API_KEY_PREFIX.test)
      const signing = randomSecret(SIGNING_SECRET_PREFIX)
      keys[p.name] = { live, test, signingSecret: signing }
      return {
        id: pid(p.id),
        workspaceId,
        name: p.name,
        slug: p.slug,
        kind: p.kind,
        websiteUrl: p.websiteUrl,
        colorSlot: p.colorSlot,
        referencePrefix: p.referencePrefix,
        webhookUrl: p.webhookUrl,
        successUrl: p.successUrl,
        failureUrl: p.failureUrl,
        cancelUrl: p.cancelUrl,
        liveKeyHash: sha256(live),
        liveKeyPreview: secretPreview(live, API_KEY_PREFIX.live),
        testKeyHash: sha256(test),
        testKeyPreview: secretPreview(test, API_KEY_PREFIX.test),
        signingSecretEnc: encrypt(config.encryptionKey, signing),
        signingSecretPreview: secretPreview(signing, SIGNING_SECRET_PREFIX),
        sample: true,
        createdAt: p.createdAt,
        updatedAt: p.createdAt,
      }
    }),
  )
  await db.insert(productGateways).values(
    demo.products.flatMap((p) =>
      p.gateways.map((g, i) => ({ workspaceId, productId: pid(p.id), connectionId: cid(g.connectionId), isDefault: g.isDefault, position: i })),
    ),
  )

  await insertChunked(demo.transactions, (chunk) =>
    db.insert(transactions).values(
      chunk.map((t) => ({ ...t, workspaceId, productId: pid(t.productId), connectionId: cid(t.connectionId), updatedAt: t.paidAt ?? t.createdAt })),
    ),
  )
  await insertChunked(demo.events, (chunk) =>
    db.insert(webhookEvents).values(
      chunk.map((e) => ({ ...e, workspaceId, connectionId: cid(e.connectionId), productId: pidOrNull(e.productId), processedAt: e.receivedAt })),
    ),
  )
  await insertChunked(demo.deliveries, (chunk) => db.insert(webhookDeliveries).values(chunk.map((d) => ({ ...d, workspaceId, productId: pid(d.productId) }))))
  await db.insert(auditLog).values(demo.audit.map((a) => ({ id: newId("aud"), workspaceId, actorId: null, ip: null, sample: true, ...a })))

  return {
    keys,
    counts: {
      products: demo.products.length,
      connections: demo.connections.length,
      transactions: demo.transactions.length,
      events: demo.events.length,
      deliveries: demo.deliveries.length,
    },
  }
}

/** CLI seed: loads the sample company into an empty install. Returns the generated product keys. */
export async function seedDemo(db: Db, config: Pick<AppConfig, "encryptionKey" | "passwordCost" | "defaultBaseUrl">, opts: SeedOptions = {}) {
  const log = opts.log ?? (() => undefined)
  const [{ n }] = await db.select({ n: count() }).from(products)
  if (n > 0 && !opts.force) {
    log("Products already exist; nothing to do. Use --force to replace them with sample data.")
    return null
  }
  if (opts.force) {
    await db.execute(sql`truncate webhook_deliveries, webhook_events, transactions, product_gateways, products, connections, audit_log, notifications cascade`)
  }

  const companyName = opts.companyName ?? "Company A"
  await db
    .insert(settings)
    .values({ id: 1, companyName, baseUrl: config.defaultBaseUrl })
    .onConflictDoNothing()
  // The install's first workspace; a fresh install gets one named after the sample company.
  let [workspace] = await db.select().from(workspaces).orderBy(asc(workspaces.createdAt)).limit(1)
  if (!workspace) {
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company"
    ;[workspace] = await db.insert(workspaces).values({ id: newId("wsp"), name: companyName, slug }).returning()
  }

  const { keys, counts } = await insertSampleData(db, config, { workspaceId: workspace.id, webhookBase: opts.webhookBase, ownerName: opts.owner?.name })

  if (opts.owner) {
    const [{ u }] = await db.select({ u: count() }).from(users)
    if (u === 0) {
      const [owner] = await db
        .insert(users)
        .values({
          id: newId("usr"),
          email: opts.owner.email.toLowerCase(),
          name: opts.owner.name,
          passwordHash: await hashPassword(opts.owner.password, config.passwordCost),
        })
        .returning()
      await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: owner.id, role: "owner", productIds: null })
      log(`Created owner ${opts.owner.email}`)
    }
  }

  log(
    `Seeded ${counts.products} sample products, ${counts.connections} gateway accounts, ${counts.transactions} payments, ${counts.events} gateway events and ${counts.deliveries} deliveries.`,
  )
  return keys
}

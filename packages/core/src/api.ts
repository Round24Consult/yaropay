import type { GatewayDefinition } from "./gateways/types.ts"
import type {
  CurrencyCode,
  GatewayConnection,
  Product,
  Transaction,
  WebhookDelivery,
  WebhookEvent,
} from "./types.ts"

/** Response shapes of the REST API. The NestJS backend must keep these. */

export interface Paginated<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
  pages: number
}

export type TransactionRow = Omit<Transaction, "timeline">

export interface TransactionList extends Paginated<TransactionRow> {
  facets: {
    products: Record<string, number>
    statuses: Record<string, number>
    gateways: Record<string, number>
    channels: Record<string, number>
  }
  summary: { volume: number; currency: CurrencyCode | null }
}

export interface TransactionDetail extends Transaction {
  events: WebhookEvent[]
  deliveries: WebhookDelivery[]
}

export interface ProductStats {
  currency: CurrencyCode
  volume30d: number
  previousVolume30d: number
  count30d: number
  successRate30d: number
  deliveryHealth: number
  spark: number[]
}

export interface ProductWithStats extends Product {
  stats: ProductStats
}

export interface CreatedProduct {
  product: Product
  /** Live API key. Shown once. */
  apiKey: string
  /** Test API key. Shown once. */
  testApiKey: string
  /** Shown once. */
  signingSecret: string
}

export type RotateTarget = "apiKey" | "testApiKey" | "signingSecret"

export interface RotatedSecret {
  which: RotateTarget
  /** Shown once. */
  secret: string
  preview: string
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
  /** Business or account name reported by the gateway, when it shares one. */
  business?: string
}

export interface GatewayListItem {
  gateway: GatewayDefinition
  connections: GatewayConnection[]
}

export interface ConnectionDetail {
  connection: GatewayConnection
  gateway: GatewayDefinition
  products: Pick<Product, "id" | "name" | "colorSlot" | "referencePrefix">[]
}

export interface EventRow extends WebhookEvent {
  delivery: Pick<WebhookDelivery, "id" | "state" | "statusCode"> | null
}

export interface DeliveryList extends Paginated<WebhookDelivery> {
  counts: Record<string, number>
}

export interface ApiError {
  error: { message: string; code?: string; fields?: Record<string, string> }
}

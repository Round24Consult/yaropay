import type { DynamicModule, Type } from "@nestjs/common"
import type { Permission, Role } from "@yaropay/core/auth"
import type { Edition, Entitlements } from "@yaropay/core/editions"
import type { AppConfig } from "../config/config.js"

/**
 * How the paid build plugs into the open-source app. The paid build lives in apps/api/src/ee (the private
 * yaropay-ee repository); its index default-exports a `CreateExtension`. Without it the app runs as
 * Community with the defaults in community.ts. Core code never imports from ee/.
 */
export interface Extension {
  edition: Edition
  /** Extra Nest modules (controllers, services) to mount. */
  modules: (Type<unknown> | DynamicModule)[]
  /** Replacements for core defaults, by extension point. Each is a class Nest instantiates. */
  overrides: Partial<ExtensionOverrides>
}

export type CreateExtension = (config: AppConfig, edition: Exclude<Edition, "community">) => Extension | Promise<Extension>

/** The edition this process runs as. */
export const EDITION = "yaropay:edition"

/** What a workspace may use. */
export const ENTITLEMENTS = "yaropay:entitlements"
export interface EntitlementsSource {
  for(workspaceId: string): Promise<Entitlements>
}

/** A member's permissions in a workspace. Custom roles (a paid feature) replace the built-in mapping. */
export const PERMISSION_RESOLVER = "yaropay:permission-resolver"
export interface PermissionResolver {
  resolve(member: { workspaceId: string; userId: string; role: Role }): Promise<readonly Permission[]>
}

/**
 * Told about every live payment a product starts (or a gateway webhook brings in). Cloud starts a
 * company's trial with its first one. Payments never wait on it: failures are logged and ignored.
 */
export const USAGE_SINK = "yaropay:usage-sink"
export interface UsageSink {
  liveTransaction(event: { workspaceId: string; productId: string; at: Date }): Promise<void>
  /**
   * Asked before a product starts a live payment. A message refuses it (Cloud: a product that never took a
   * live payment can't start while the company's invoice is overdue); null lets it through. If this
   * throws, the payment goes ahead.
   */
  liveRefusal(event: { workspaceId: string; productId: string }): Promise<string | null>
}

export interface ExtensionOverrides {
  [ENTITLEMENTS]: Type<EntitlementsSource>
  [PERMISSION_RESOLVER]: Type<PermissionResolver>
  [USAGE_SINK]: Type<UsageSink>
}

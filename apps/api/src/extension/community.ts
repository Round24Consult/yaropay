import { Injectable } from "@nestjs/common"
import { type Permission, ROLE_PERMISSIONS, type Role } from "@yaropay/core/auth"
import { COMMUNITY_ENTITLEMENTS, type Entitlements } from "@yaropay/core/editions"
import type { EntitlementsSource, Extension, PermissionResolver, UsageSink } from "./extension.js"

/** Community: no paid features. */
@Injectable()
export class CommunityEntitlements implements EntitlementsSource {
  async for(): Promise<Entitlements> {
    return COMMUNITY_ENTITLEMENTS
  }
}

/** The five built-in roles. */
@Injectable()
export class RolePermissions implements PermissionResolver {
  async resolve(member: { role: Role }): Promise<readonly Permission[]> {
    return ROLE_PERMISSIONS[member.role]
  }
}

/** Self-hosted installs don't meter anything. */
@Injectable()
export class NoUsageSink implements UsageSink {
  async liveTransaction(): Promise<void> {}
  async liveRefusal(): Promise<string | null> {
    return null
  }
}

export const COMMUNITY: Extension = { edition: "community", modules: [], overrides: {} }

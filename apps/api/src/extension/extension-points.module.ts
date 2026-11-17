import { type DynamicModule, Module, type Provider, type Type } from "@nestjs/common"
import { CommunityEntitlements, NoUsageSink, RolePermissions } from "./community.js"
import { EntitlementsController } from "./entitlements.controller.js"
import { EDITION, ENTITLEMENTS, type Extension, type ExtensionOverrides, PERMISSION_RESOLVER, USAGE_SINK } from "./extension.js"

const DEFAULTS: { [K in keyof ExtensionOverrides]: Type<unknown> } = {
  [ENTITLEMENTS]: CommunityEntitlements,
  [PERMISSION_RESOLVER]: RolePermissions,
  [USAGE_SINK]: NoUsageSink,
}

/**
 * Provides every extension point globally: the core default, or the paid build's replacement. Overrides
 * are instantiated here, so they can use anything the paid build's own modules export.
 */
@Module({})
export class ExtensionPointsModule {
  static forRoot(ext: Extension): DynamicModule {
    const unknown = Object.keys(ext.overrides).filter((k) => !(k in DEFAULTS))
    if (unknown.length) throw new Error(`Unknown extension point(s): ${unknown.join(", ")}`)
    const points: Provider[] = (Object.keys(DEFAULTS) as (keyof ExtensionOverrides)[]).map((token) => ({
      provide: token,
      useClass: ext.overrides[token] ?? DEFAULTS[token],
    }))
    return {
      module: ExtensionPointsModule,
      global: true,
      imports: ext.modules,
      controllers: [EntitlementsController],
      providers: [...points, { provide: EDITION, useValue: ext.edition }],
      exports: [...Object.keys(DEFAULTS), EDITION],
    }
  }
}

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { Controller, Get, Injectable, Module } from "@nestjs/common"
import { type Permission, ROLE_PERMISSIONS, type Role } from "@yaropay/core/auth"
import { COMMUNITY_ENTITLEMENTS, type Entitlements } from "@yaropay/core/editions"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { RequirePermissions } from "../src/auth/decorators.js"
import { loadConfig } from "../src/config/config.js"
import { COMMUNITY } from "../src/extension/community.js"
import { ExtensionPointsModule } from "../src/extension/extension-points.module.js"
import { ENTITLEMENTS, type EntitlementsSource, type Extension, PERMISSION_RESOLVER, type PermissionResolver } from "../src/extension/extension.js"
import { RequireFeature } from "../src/extension/features.js"
import { loadExtension } from "../src/extension/load.js"
import { createTestApp, setupOwner, type TestApp } from "./helpers.js"

describe("Community edition", () => {
  let t: TestApp
  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  it("has no paid features, and members get their role's permissions", async () => {
    await t.http().get("/api/entitlements").expect(401)
    const { agent: owner } = await setupOwner(t)
    expect((await owner.get("/api/entitlements").expect(200)).body).toEqual(COMMUNITY_ENTITLEMENTS)
    const me = await owner.get("/api/auth/me").expect(200)
    expect([...me.body.user.permissions].sort()).toEqual([...ROLE_PERMISSIONS.owner].sort())
  })
})

describe("loading the paid build", () => {
  const dirs: string[] = []
  const eeDir = (index?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "yaropay-ee-"))
    dirs.push(dir)
    if (index !== undefined) writeFileSync(join(dir, "index.js"), index)
    return pathToFileURL(`${dir}/`)
  }
  const config = (env: Record<string, string> = {}) => loadConfig({ NODE_ENV: "test", ...env })
  const FACTORY = "export default (config, edition) => ({ edition, modules: [], overrides: {} })"
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

  it("runs as Community without it, and refuses to run as Cloud", async () => {
    expect(await loadExtension(config(), eeDir())).toBe(COMMUNITY)
    await expect(loadExtension(config({ YAROPAY_CLOUD: "true" }), eeDir())).rejects.toThrow(/needs the paid build/)
  })

  it("runs a paid build as Enterprise, or as Cloud with YAROPAY_CLOUD", async () => {
    const dir = eeDir(FACTORY)
    expect((await loadExtension(config(), dir)).edition).toBe("enterprise")
    expect((await loadExtension(config({ YAROPAY_CLOUD: "true" }), dir)).edition).toBe("cloud")
  })

  it("YAROPAY_DISABLE_EE runs a paid build as Community, but never as Cloud", async () => {
    const dir = eeDir(FACTORY)
    expect(await loadExtension(config({ YAROPAY_DISABLE_EE: "true" }), dir)).toBe(COMMUNITY)
    await expect(loadExtension(config({ YAROPAY_DISABLE_EE: "true", YAROPAY_CLOUD: "true" }), dir)).rejects.toThrow(/can't be combined/)
  })

  it("stops on a broken paid build instead of quietly running as Community", async () => {
    await expect(loadExtension(config(), eeDir("export const nothing = 1"))).rejects.toThrow(/default-export/)
    await expect(loadExtension(config(), eeDir("throw new Error('ee failed to start')"))).rejects.toThrow(/ee failed to start/)
  })
})

describe("extension points", () => {
  @Injectable()
  class OneFeature implements EntitlementsSource {
    async for(): Promise<Entitlements> {
      return { ...COMMUNITY_ENTITLEMENTS, edition: "enterprise", features: ["audit_export"], acceptsLicence: true }
    }
  }

  /** Stands in for custom roles: owners lose settings access. */
  @Injectable()
  class NoSettings implements PermissionResolver {
    async resolve(member: { role: Role }): Promise<readonly Permission[]> {
      return ROLE_PERMISSIONS[member.role].filter((p) => p !== "settings:read")
    }
  }

  @Controller("api/paid-test")
  class PaidController {
    @Get("audit-export")
    @RequireFeature("audit_export")
    auditExport() {
      return { ok: true }
    }

    @Get("sso")
    @RequireFeature("sso")
    sso() {
      return { ok: true }
    }

    @Get("sso-settings")
    @RequirePermissions("settings:read")
    @RequireFeature("sso")
    ssoSettings() {
      return { ok: true }
    }
  }

  @Module({ controllers: [PaidController] })
  class PaidModule {}

  const ext: Extension = { edition: "enterprise", modules: [PaidModule], overrides: { [ENTITLEMENTS]: OneFeature, [PERMISSION_RESOLVER]: NoSettings } }
  let t: TestApp
  let owner: Awaited<ReturnType<typeof setupOwner>>["agent"]
  beforeAll(async () => {
    t = await createTestApp({}, { extension: ext })
    owner = (await setupOwner(t)).agent
  })
  afterAll(() => t.close())

  it("mounts the paid build's routes and allows only entitled features", async () => {
    await owner.get("/api/paid-test/audit-export").expect(200)
    const refused = await owner.get("/api/paid-test/sso").expect(402)
    expect(refused.body.error).toMatchObject({ code: "feature_not_entitled", message: expect.stringMatching(/Single sign-on .*Enterprise/) })
    await t.http().get("/api/paid-test/sso").expect(401)
  })

  it("serves the paid build's entitlements", async () => {
    expect((await owner.get("/api/entitlements").expect(200)).body).toMatchObject({ edition: "enterprise", features: ["audit_export"] })
  })

  it("resolves permissions through the paid build, checked before the feature", async () => {
    await owner.get("/api/settings").expect(403)
    await owner.get("/api/paid-test/sso-settings").expect(403)
    expect((await owner.get("/api/auth/me").expect(200)).body.user.permissions).not.toContain("settings:read")
  })

  it("refuses an override for an extension point that doesn't exist", () => {
    expect(() => ExtensionPointsModule.forRoot({ ...COMMUNITY, overrides: { "yaropay:nope": OneFeature } as never })).toThrow(/Unknown extension point/)
  })
})

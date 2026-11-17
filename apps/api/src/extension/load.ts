import { existsSync } from "node:fs"
import type { AppConfig } from "../config/config.js"
import { COMMUNITY } from "./community.js"
import type { CreateExtension, Extension } from "./extension.js"

/**
 * Finds the paid build next to this folder (dist/ee in images, src/ee under the test runner) and asks
 * it for the extension. No paid build: Community. A paid build that fails to load stops the app instead
 * of quietly running as Community.
 */
export async function loadExtension(config: AppConfig, eeDir: URL = new URL("../ee/", import.meta.url)): Promise<Extension> {
  const entry = config.disableEe ? undefined : ["index.js", "index.ts"].map((f) => new URL(f, eeDir)).find((u) => existsSync(u))
  if (!entry) {
    if (config.cloud) {
      throw new Error(
        config.disableEe
          ? "YAROPAY_CLOUD=true can't be combined with YAROPAY_DISABLE_EE=true."
          : "YAROPAY_CLOUD=true needs the paid build (apps/api/src/ee), which this build doesn't include.",
      )
    }
    return COMMUNITY
  }
  const mod = (await import(entry.href)) as { default?: CreateExtension }
  if (typeof mod.default !== "function") throw new Error(`${entry.pathname} must default-export createExtension`)
  return mod.default(config, config.cloud ? "cloud" : "enterprise")
}

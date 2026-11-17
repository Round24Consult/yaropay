import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { request } from "@playwright/test"
import { AUTH_FILE, E2E_OWNER, E2E_PORTS } from "./test-users"

/** Signs the seeded owner in once and saves the session cookie for every test. */
export default async function globalSetup() {
  const ctx = await request.newContext({ baseURL: `http://localhost:${E2E_PORTS.web}` })
  const res = await ctx.post("/api/auth/login", { data: { email: E2E_OWNER.email, password: E2E_OWNER.password } })
  if (!res.ok()) throw new Error(`e2e login failed: ${res.status()} ${await res.text()}`)
  mkdirSync(dirname(AUTH_FILE), { recursive: true })
  await ctx.storageState({ path: AUTH_FILE })
  await ctx.dispose()
}

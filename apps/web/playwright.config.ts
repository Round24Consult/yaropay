import { defineConfig, devices } from "@playwright/test"
import { AUTH_FILE, E2E_COMPANY, E2E_OWNER, E2E_PORTS } from "./e2e/test-users"

const { api, web, hooks } = E2E_PORTS
const DESKTOP = { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } }

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${web}`,
    trace: "retain-on-failure",
    storageState: AUTH_FILE,
    // Uses the locally installed Google Chrome, so no browser download is needed.
    channel: "chrome",
  },
  projects: [
    { name: "desktop", testIgnore: /sample-removal\.spec\.ts/, use: DESKTOP },
    // Deletes the sample company every other spec uses, so it waits for them all.
    { name: "sample-removal", testMatch: /sample-removal\.spec\.ts/, dependencies: ["desktop"], use: DESKTOP },
  ],
  webServer: [
    {
      command: `node e2e/receiver.mjs ${hooks}`,
      port: hooks,
      reuseExistingServer: false,
    },
    {
      // Real API on a throwaway embedded database, seeded with the demo company.
      command: "npm run e2e:serve",
      cwd: "../api",
      url: `http://127.0.0.1:${api}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        PORT: String(api),
        PGLITE_DIR: ".data/e2e",
        DASHBOARD_URL: `http://localhost:${web}`,
        YAROPAY_BASE_URL: "https://payments.company-a.com",
        // Screenshots keep the sample products' own webhook URLs instead of the local test receiver.
        DEMO_WEBHOOK_BASE: process.env.SITE_SCREENSHOTS ? "" : `http://127.0.0.1:${hooks}/hooks`,
        SEED_COMPANY_NAME: E2E_COMPANY,
        SEED_OWNER_EMAIL: E2E_OWNER.email,
        SEED_OWNER_PASSWORD: E2E_OWNER.password,
        SEED_OWNER_NAME: E2E_OWNER.name,
        PASSWORD_HASH_COST: "fast",
        WEBHOOK_ALLOW_PRIVATE: "true",
        RATE_LIMIT: "off",
        LOG_LEVEL: "warn",
        // Community by default, the same locally (where the paid build may be checked out) and in public
        // CI. E2E_EDITION=enterprise or cloud runs the paid build, when it is checked out; cloud also makes
        // the seeded owner a super admin for the platform console spec.
        YAROPAY_DISABLE_EE: process.env.E2E_EDITION === "enterprise" || process.env.E2E_EDITION === "cloud" ? "false" : "true",
        YAROPAY_CLOUD: process.env.E2E_EDITION === "cloud" ? "true" : "false",
        E2E_SUPER_ADMIN: process.env.E2E_EDITION === "cloud" ? E2E_OWNER.email : "",
      },
    },
    {
      // Production build: no file watching, so test artifacts cannot trigger reloads.
      command: `npm run build && npx next start -p ${web}`,
      url: `http://localhost:${web}/login`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { YAROPAY_API_URL: `http://127.0.0.1:${api}` },
    },
  ],
})

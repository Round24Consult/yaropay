import { defineConfig } from "drizzle-kit"

// Generates SQL migrations from src/database/schema.ts. No database connection is needed.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema.ts",
  out: "./drizzle",
})

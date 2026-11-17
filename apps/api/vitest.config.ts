import { fileURLToPath } from "node:url"
import swc from "unplugin-swc"
import { defineConfig } from "vitest/config"

// SWC emits decorator metadata, which NestJS dependency injection needs (esbuild does not).
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  resolve: {
    alias: [
      {
        find: /^@yaropay\/core\/(.*)$/,
        replacement: fileURLToPath(new URL("../../packages/core/src/$1.ts", import.meta.url)),
      },
    ],
  },
  test: {
    // test/: the open-source app. src/ee/: the paid build's own tests, when it is checked out.
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    env: { NODE_ENV: "test" },
  },
})

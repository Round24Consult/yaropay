import { resolve } from "node:path"
import type { NextConfig } from "next"

/**
 * The dashboard talks to the NestJS API through these rewrites, so the browser
 * only ever sees one origin and the session cookie stays first-party.
 * Point YAROPAY_API_URL at the API (default: the local dev API on :4000).
 * Rewrites are compiled into the build, so set it before `next build`
 * (for Docker images, pass it as a build argument).
 */
const apiUrl = (process.env.YAROPAY_API_URL ?? "http://localhost:4000").replace(/\/+$/, "")

const nextConfig: NextConfig = {
  // Docker builds ship the self-contained server (see apps/web/Dockerfile).
  ...(process.env.YAROPAY_STANDALONE ? { output: "standalone" as const, outputFileTracingRoot: resolve(process.cwd(), "../..") } : {}),
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Every dashboard page waits for the signed-in member and loads its data in the browser
    // (ClientGate + TanStack Query), so the server renders no page content for instant-navigation
    // validation to inspect, and checking each page only produces "dropped segment" insights.
    // Validate just the segments that opt in with `export const instant = true`.
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
      // Public endpoints (gateway webhooks, callbacks, product payments API), so the
      // dashboard origin can also serve as the install's base URL in development.
      { source: "/v1/:path*", destination: `${apiUrl}/v1/:path*` },
    ]
  },
}

export default nextConfig

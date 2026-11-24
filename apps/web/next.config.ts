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
      // AI apps (MCP) and their sign-in (OAuth), for installs without a reverse proxy in front.
      { source: "/mcp", destination: `${apiUrl}/mcp` },
      { source: "/mcp/:path*", destination: `${apiUrl}/mcp/:path*` },
      { source: "/oauth/:path*", destination: `${apiUrl}/oauth/:path*` },
      { source: "/.well-known/oauth-protected-resource", destination: `${apiUrl}/.well-known/oauth-protected-resource` },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: `${apiUrl}/.well-known/oauth-protected-resource/:path*` },
      { source: "/.well-known/oauth-authorization-server", destination: `${apiUrl}/.well-known/oauth-authorization-server` },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: `${apiUrl}/.well-known/oauth-authorization-server/:path*` },
    ]
  },
  async headers() {
    // The pages where someone approves an AI app or one of its actions must never load inside
    // another site's frame, or a click there could be tricked into an approval.
    return [
      {
        source: "/connect/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ]
  },
}

export default nextConfig

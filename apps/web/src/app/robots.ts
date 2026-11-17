import type { MetadataRoute } from "next"

/**
 * /robots.txt for the dashboard. Pages may be fetched (so crawlers see each page's noindex and drop it)
 * but the API is off limits. The public site and its sitemaps are on yaropay.com.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/v1/"] }] }
}

import { type NextRequest, NextResponse } from "next/server"

/** Name of the httpOnly session cookie set by the API. */
const SESSION_COOKIE = "yaropay_session"

/**
 * Cheap first check: no session cookie means no session, so send the visitor to
 * the sign-in page before rendering anything. The dashboard still verifies the
 * session with the API (an expired cookie is caught by the client AuthGate).
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next()
  // Only redirect full page loads. Router prefetches and RSC requests made
  // while signed out would otherwise cache a redirect to /login that the
  // client replays after sign-in; the client-side AuthGate covers them.
  if (request.headers.has("rsc") || request.headers.has("next-router-prefetch") || request.nextUrl.searchParams.has("_rsc")) {
    return NextResponse.next()
  }
  const { pathname, search } = request.nextUrl
  const url = request.nextUrl.clone()
  url.pathname = "/login"
  url.search = ""
  if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    "/((?!api|v1|_next/static|_next/image|login|setup|signup|verify-email|forgot-password|reset-password|invite|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
}

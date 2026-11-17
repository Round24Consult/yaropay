import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  joinInviteSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaSetupSchema,
  mfaVerifySchema,
  profileSchema,
  reauthSchema,
  recoveryCodesSchema,
  resetPasswordSchema,
  setupSchema,
  switchWorkspaceSchema,
  type SessionUser,
} from "@yaropay/core/auth"
import type { Request, Response } from "express"
import type { z } from "zod"
import { ZodBody } from "../common/zod.js"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { Inject } from "@nestjs/common"
import { AuthService, type ClientMeta, PENDING_SESSION_MS, SESSION_COOKIE } from "./auth.service.js"
import { AllowInSupport, AllowPending, CurrentSession, CurrentUser, Public } from "./decorators.js"
import { MfaService } from "./mfa.service.js"
import { TRUSTED_BROWSER_MS, TRUSTED_COOKIE, TRUSTED_COOKIE_PATH, TrustedBrowsersService } from "./trusted-browsers.js"
import type { Actor, SessionContext } from "./types.js"

const meta = (req: Request): ClientMeta => ({ ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null })
const trustedToken = (req: Request): string | undefined => (req.cookies as Record<string, string | undefined> | undefined)?.[TRUSTED_COOKIE]

@Controller("api/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly trusted: TrustedBrowsersService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** `pending`: the session only lasts long enough to enter the authenticator code. */
  private setCookie(res: Response, token: string, pending = false) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.cookieSecure,
      path: "/",
      maxAge: pending ? PENDING_SESSION_MS : this.config.sessionDays * 86_400_000,
    })
  }

  /** Remembers a trusted browser. httpOnly, and only sent to /api/auth (sign-in and its settings). */
  private setTrustedCookie(res: Response, token: string) {
    res.cookie(TRUSTED_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: this.config.cookieSecure, path: TRUSTED_COOKIE_PATH, maxAge: TRUSTED_BROWSER_MS })
  }

  private clearTrustedCookie(res: Response) {
    res.clearCookie(TRUSTED_COOKIE, { httpOnly: true, sameSite: "lax", secure: this.config.cookieSecure, path: TRUSTED_COOKIE_PATH })
  }

  /** Sets the cookie for a finished sign-in, or for one still waiting for its authenticator code. */
  private finish(
    res: Response,
    result: ({ user: SessionUser; token: string } | { mfaRequired: true; token: string }) & { clearTrusted?: boolean },
  ) {
    if (result.clearTrusted) this.clearTrustedCookie(res)
    if ("mfaRequired" in result) {
      this.setCookie(res, result.token, true)
      return { mfaRequired: true as const }
    }
    this.setCookie(res, result.token)
    return { user: result.user }
  }

  @Public()
  @Get("state")
  state() {
    return this.auth.state()
  }

  @Public()
  @Post("setup")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async setup(@Req() req: Request, @Res({ passthrough: true }) res: Response, @ZodBody(setupSchema) body: z.infer<typeof setupSchema>) {
    const { user, token } = await this.auth.setup(body, meta(req))
    this.setCookie(res, token)
    return { user }
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @ZodBody(loginSchema) body: z.infer<typeof loginSchema>) {
    return this.finish(res, await this.auth.login(body.email, body.password, meta(req), trustedToken(req)))
  }

  /** The second step of signing in: an authenticator code or a recovery code. */
  @AllowPending()
  @Post("mfa/verify")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyMfa(
    @CurrentUser() user: Actor,
    @CurrentSession() session: SessionContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ZodBody(mfaVerifySchema) body: z.infer<typeof mfaVerifySchema>,
  ) {
    const signedIn = await this.mfa.verify(user, session, body.code, meta(req), { trustBrowser: body.trustBrowser })
    // The cookie now lasts as long as a normal session.
    const token = (req.cookies as Record<string, string>)[SESSION_COOKIE]
    this.setCookie(res, token)
    if (signedIn.trusted) this.setTrustedCookie(res, signedIn.trusted.token)
    return { user: signedIn.user }
  }

  /** Browsers that skip the authenticator code at sign-in. */
  @Get("trusted-browsers")
  trustedBrowsers(@CurrentUser() user: Actor, @Req() req: Request) {
    return this.trusted.list(user.id, trustedToken(req))
  }

  @Delete("trusted-browsers/:id")
  async removeTrustedBrowser(@CurrentUser() user: Actor, @Param("id") id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const removed = await this.trusted.remove(user.id, id, trustedToken(req))
    if (removed.current) this.clearTrustedCookie(res)
    await this.auth.recordForAccount(user, "Removed a trusted browser", removed.label, meta(req))
    return { id }
  }

  @Delete("trusted-browsers")
  async removeAllTrustedBrowsers(@CurrentUser() user: Actor, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const removed = await this.trusted.removeAll(user.id)
    this.clearTrustedCookie(res)
    if (removed > 0) await this.auth.recordForAccount(user, "Removed all trusted browsers", `${removed}`, meta(req))
    return { removed }
  }

  @Get("mfa")
  mfaStatus(@CurrentUser() user: Actor) {
    return this.mfa.status(user)
  }

  @Post("mfa/setup")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  mfaSetup(@CurrentUser() user: Actor, @ZodBody(mfaSetupSchema) body: z.infer<typeof mfaSetupSchema>) {
    return this.mfa.startSetup(user, body.password)
  }

  @Post("mfa/enable")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  mfaEnable(
    @CurrentUser() user: Actor,
    @CurrentSession() session: SessionContext,
    @Req() req: Request,
    @ZodBody(mfaEnableSchema) body: z.infer<typeof mfaEnableSchema>,
  ) {
    return this.mfa.enable(user, session, body.code, meta(req))
  }

  @Post("mfa/disable")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async mfaDisable(@CurrentUser() user: Actor, @Req() req: Request, @ZodBody(mfaDisableSchema) body: z.infer<typeof mfaDisableSchema>) {
    await this.mfa.disable(user, body.password, body.code, meta(req))
    return { ok: true }
  }

  @Post("mfa/recovery-codes")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  mfaRecoveryCodes(@CurrentUser() user: Actor, @Req() req: Request, @ZodBody(recoveryCodesSchema) body: z.infer<typeof recoveryCodesSchema>) {
    return this.mfa.regenerateRecoveryCodes(user, body.password, meta(req))
  }

  /** Enter the password (and code) again before a sensitive action. */
  @Post("reauth")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reauth(@CurrentUser() user: Actor, @CurrentSession() session: SessionContext, @ZodBody(reauthSchema) body: z.infer<typeof reauthSchema>) {
    return this.mfa.reauthenticate(user, session, body.password, body.code)
  }

  /** Leaves a support view and goes back to your own company. */
  @AllowInSupport()
  @Post("support/end")
  @HttpCode(200)
  async endSupport(@CurrentSession() session: SessionContext) {
    await this.auth.endSupport(session.id)
    return { ok: true }
  }

  @AllowPending()
  @AllowInSupport()
  @Post("logout")
  @HttpCode(200)
  async logout(@CurrentSession() session: { id: string }, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(session.id)
    res.clearCookie(SESSION_COOKIE, { path: "/" })
    return { ok: true }
  }

  @Get("me")
  async me(@CurrentUser() user: Actor) {
    return { user: await this.auth.sessionUser(user) }
  }

  @Patch("me")
  async updateMe(@CurrentUser() user: Actor, @ZodBody(profileSchema) body: z.infer<typeof profileSchema>) {
    return { user: await this.auth.updateProfile(user, body.name) }
  }

  @Post("password")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async changePassword(
    @CurrentUser() user: Actor,
    @CurrentSession() session: { id: string },
    @Req() req: Request,
    @ZodBody(changePasswordSchema) body: z.infer<typeof changePasswordSchema>,
  ) {
    await this.auth.changePassword(user, session.id, body.currentPassword, body.newPassword, meta(req))
    return { ok: true }
  }

  @Get("sessions")
  sessions(@CurrentUser() user: Actor, @CurrentSession() session: { id: string }) {
    return this.auth.listSessions(user, session.id)
  }

  @Delete("sessions/:id")
  async revokeSession(@CurrentUser() user: Actor, @Param("id") id: string) {
    await this.auth.revokeSession(user, id)
    return { id }
  }

  @Public()
  @Post("forgot")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgot(@ZodBody(forgotPasswordSchema) body: z.infer<typeof forgotPasswordSchema>) {
    await this.auth.forgotPassword(body.email)
    return { ok: true }
  }

  @Public()
  @Post("reset")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async reset(@Req() req: Request, @ZodBody(resetPasswordSchema) body: z.infer<typeof resetPasswordSchema>) {
    await this.auth.resetPassword(body.token, body.password, meta(req))
    return { ok: true }
  }

  @Public()
  @Get("invites/:token")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  invite(@Param("token") token: string) {
    return this.auth.invitePreview(token)
  }

  @Public()
  @Post("invites/:token/accept")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async accept(
    @Param("token") token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ZodBody(acceptInviteSchema) body: z.infer<typeof acceptInviteSchema>,
  ) {
    return this.finish(res, await this.auth.acceptInvite(token, body, meta(req)))
  }

  /** Accept with an account that already exists: it joins the inviting workspace. */
  @Public()
  @Post("invites/:token/join")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async join(
    @Param("token") token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ZodBody(joinInviteSchema) body: z.infer<typeof joinInviteSchema>,
  ) {
    return this.finish(res, await this.auth.joinInvite(token, body.password, meta(req)))
  }

  /** Moves this session to another workspace the member belongs to. */
  @Post("workspace")
  @HttpCode(200)
  async switchWorkspace(
    @CurrentUser() user: Actor,
    @CurrentSession() session: { id: string },
    @ZodBody(switchWorkspaceSchema) body: z.infer<typeof switchWorkspaceSchema>,
  ) {
    return { user: await this.auth.switchWorkspace(user, session.id, body.workspaceId) }
  }
}

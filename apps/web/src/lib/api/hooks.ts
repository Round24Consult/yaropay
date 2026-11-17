"use client"

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { OverviewResponse } from "@yaropay/core/analytics"
import type {
  ConnectionDetail,
  ConnectionTestResult,
  CreatedProduct,
  DeliveryList,
  EventRow,
  GatewayListItem,
  Paginated,
  ProductWithStats,
  RotatedSecret,
  RotateTarget,
  TransactionDetail,
  TransactionList,
} from "@yaropay/core/api"
import type {
  AuthState,
  CreatedInvite,
  Invite,
  InvitePreview,
  LoginResult,
  MfaSetup,
  MfaStatus,
  SessionInfo,
  TrustedBrowser,
  SessionUser,
  UpdateMemberInput,
} from "@yaropay/core/auth"
import type { AppNotification, NotificationList, NotificationPreference } from "@yaropay/core/notifications"
import type { OnboardingStatus, SampleDataRemoved } from "@yaropay/core/onboarding"
import type { ConnectionInput } from "@yaropay/core/gateways/credentials"
import type { ProductInput } from "@yaropay/core/schemas"
import type {
  AuditEntry,
  GatewayConnection,
  Mode,
  PlatformSettings,
  TeamMember,
  WebhookDelivery,
} from "@yaropay/core/types"
import { api, ApiRequestError, setActiveWorkspace } from "./client"
import { qk } from "./keys"
import { type Entitlements, type Feature, hasFeature, type LicenceSummary } from "@yaropay/core/editions"

type Params = Record<string, string | number | boolean | string[] | null | undefined>

// ---- Reads -----------------------------------------------------------------

export function useOverview(params: Params, opts: { live?: boolean } = {}) {
  return useQuery({
    queryKey: qk.overview(params),
    queryFn: () => api<OverviewResponse>("/analytics/overview", { params }),
    placeholderData: keepPreviousData,
    refetchInterval: opts.live ? 10_000 : false,
  })
}

export function useTransactions(params: Params, opts: { live?: boolean } = {}) {
  return useQuery({
    queryKey: qk.transactions(params),
    queryFn: () => api<TransactionList>("/transactions", { params }),
    placeholderData: keepPreviousData,
    refetchInterval: opts.live ? 10_000 : false,
  })
}

export function useTransaction(id: string | null) {
  return useQuery({
    queryKey: qk.transaction(id ?? ""),
    queryFn: () => api<TransactionDetail>(`/transactions/${id}`),
    enabled: !!id,
  })
}

export function useProducts() {
  return useQuery({ queryKey: qk.products, queryFn: () => api<ProductWithStats[]>("/products") })
}

export function useProduct(id: string) {
  return useQuery({ queryKey: qk.product(id), queryFn: () => api<ProductWithStats>(`/products/${id}`) })
}

export function useGateways() {
  return useQuery({ queryKey: qk.gateways, queryFn: () => api<GatewayListItem[]>("/gateways") })
}

export function useConnections() {
  return useQuery({ queryKey: qk.connections, queryFn: () => api<GatewayConnection[]>("/connections") })
}

export function useConnection(id: string) {
  return useQuery({ queryKey: qk.connection(id), queryFn: () => api<ConnectionDetail>(`/connections/${id}`) })
}

export function useEvents(params: Params) {
  return useQuery({
    queryKey: qk.events(params),
    queryFn: () => api<Paginated<EventRow>>("/webhooks/events", { params }),
    placeholderData: keepPreviousData,
  })
}

export function useDeliveries(params: Params, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.deliveries(params),
    queryFn: () => api<DeliveryList>("/webhooks/deliveries", { params }),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  })
}

export function useSettings(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.settings,
    queryFn: () => api<PlatformSettings>("/settings"),
    staleTime: 60_000,
    enabled: opts.enabled ?? true,
  })
}

export function useTeam(opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: qk.team, queryFn: () => api<TeamMember[]>("/team"), enabled: opts.enabled ?? true })
}

export function useInvites(opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: qk.invites, queryFn: () => api<Invite[]>("/team/invites"), enabled: opts.enabled ?? true })
}

export function useAudit(opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: qk.audit, queryFn: () => api<AuditEntry[]>("/audit"), enabled: opts.enabled ?? true })
}

// ---- Auth ------------------------------------------------------------------

export function useAuthState(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.authState,
    queryFn: () => api<AuthState>("/auth/state"),
    staleTime: 60_000,
    retry: 1,
    enabled: opts.enabled ?? true,
  })
}

/** The signed-in member. `error.status === 401` means signed out. */
export function useMeQuery() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      const { user } = await api<{ user: SessionUser }>("/auth/me")
      setActiveWorkspace(user.workspace.id)
      return user
    },
    staleTime: 60_000,
    retry: (count, err) => !(err instanceof ApiRequestError && err.status < 500) && count < 2,
  })
}

export function useSessions() {
  return useQuery({ queryKey: qk.sessions, queryFn: () => api<SessionInfo[]>("/auth/sessions") })
}

/** Browsers that skip the authenticator code at sign-in. */
export function useTrustedBrowsers(enabled = true) {
  return useQuery({ queryKey: qk.trustedBrowsers, queryFn: () => api<TrustedBrowser[]>("/auth/trusted-browsers"), enabled })
}

export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: qk.invitePreview(token),
    queryFn: () => api<InvitePreview>(`/auth/invites/${encodeURIComponent(token)}`),
    retry: false,
  })
}

function useSignedIn() {
  const qc = useQueryClient()
  return (user: SessionUser) => {
    qc.clear()
    setActiveWorkspace(user.workspace.id)
    qc.setQueryData(qk.me, user)
  }
}

/** Signing in either finishes, or returns `{ mfaRequired: true }` when the account owes an authenticator code. */
export function useLogin() {
  const signedIn = useSignedIn()
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api<LoginResult>("/auth/login", { method: "POST", json: input }),
    onSuccess: (result) => {
      if ("user" in result) signedIn(result.user)
    },
  })
}

/** The code step of signing in: an authenticator code or a recovery code. */
export function useVerifyMfa() {
  const signedIn = useSignedIn()
  return useMutation({
    mutationFn: (input: { code: string; trustBrowser?: boolean }) => api<{ user: SessionUser }>("/auth/mfa/verify", { method: "POST", json: input }),
    onSuccess: ({ user }) => signedIn(user),
  })
}

export function useMfaStatus() {
  return useQuery({ queryKey: qk.mfa, queryFn: () => api<MfaStatus>("/auth/mfa") })
}

export function useMfaSetup() {
  return useMutation({
    mutationFn: (input: { password: string }) => api<MfaSetup>("/auth/mfa/setup", { method: "POST", json: input }),
  })
}

/** Turning it on signs out the account's other sessions, and changes what /me says. */
function useMfaChanged() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: qk.mfa })
    qc.invalidateQueries({ queryKey: qk.me })
    qc.invalidateQueries({ queryKey: qk.sessions })
  }
}

export function useMfaEnable() {
  const changed = useMfaChanged()
  return useMutation({
    mutationFn: (input: { code: string }) => api<{ recoveryCodes: string[] }>("/auth/mfa/enable", { method: "POST", json: input }),
    onSuccess: changed,
  })
}

export function useMfaDisable() {
  const changed = useMfaChanged()
  return useMutation({
    mutationFn: (input: { password: string; code: string }) => api<{ ok: true }>("/auth/mfa/disable", { method: "POST", json: input }),
    onSuccess: changed,
  })
}

export function useRecoveryCodes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { password: string }) => api<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.mfa }),
  })
}

/** Confirms the password (and code) again before a sensitive action. */
export function useReauth() {
  return useMutation({
    mutationFn: (input: { password: string; code?: string }) => api<{ authenticatedAt: string }>("/auth/reauth", { method: "POST", json: input }),
  })
}

export function useSetup() {
  const signedIn = useSignedIn()
  return useMutation({
    mutationFn: (input: { name: string; email: string; password: string; companyName: string }) =>
      api<{ user: SessionUser }>("/auth/setup", { method: "POST", json: input }),
    onSuccess: ({ user }) => signedIn(user),
  })
}

/** Accepts an invite with an account that already exists (it joins this workspace). */
export function useJoinInvite(token: string) {
  const signedIn = useSignedIn()
  return useMutation({
    mutationFn: (input: { password: string }) =>
      api<LoginResult>(`/auth/invites/${encodeURIComponent(token)}/join`, { method: "POST", json: input }),
    onSuccess: (result) => {
      if ("user" in result) signedIn(result.user)
    },
  })
}

export function useAcceptInvite(token: string) {
  const signedIn = useSignedIn()
  return useMutation({
    mutationFn: (input: { name: string; password: string }) =>
      api<{ user: SessionUser }>(`/auth/invites/${encodeURIComponent(token)}/accept`, { method: "POST", json: input }),
    onSuccess: ({ user }) => signedIn(user),
  })
}

/** Ends the session. The cache is cleared on the next sign-in (see useSignedIn), not here, so the dashboard can unmount first. */
export function useLogout() {
  return useMutation({
    mutationFn: () => api<{ ok: true }>("/auth/logout", { method: "POST" }),
  })
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: { email: string }) => api<{ ok: true }>("/auth/forgot", { method: "POST", json: input }),
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: { token: string; password: string }) =>
      api<{ ok: true }>("/auth/reset", { method: "POST", json: input }),
  })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string }) => api<{ user: SessionUser }>("/auth/me", { method: "PATCH", json: input }),
    onSuccess: ({ user }) => {
      qc.setQueryData(qk.me, user)
      qc.invalidateQueries({ queryKey: qk.team })
    },
  })
}

export function useChangePassword() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api<{ ok: true }>("/auth/password", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
  })
}

export function useRemoveTrustedBrowser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/auth/trusted-browsers/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.trustedBrowsers }),
  })
}

export function useRemoveAllTrustedBrowsers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ removed: number }>("/auth/trusted-browsers", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.trustedBrowsers }),
  })
}

export function useRevokeSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/auth/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
  })
}

// ---- Team ------------------------------------------------------------------

export function useCreateInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { email: string; role: string; productIds: string[] | null }) =>
      api<CreatedInvite>("/team/invites", { method: "POST", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.invites })
      qc.invalidateQueries({ queryKey: qk.audit })
    },
  })
}

export function useResendInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<CreatedInvite>(`/team/invites/${id}/resend`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invites }),
  })
}

export function useRevokeInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/team/invites/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.invites })
      qc.invalidateQueries({ queryKey: qk.audit })
    },
  })
}

export function useUpdateMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateMemberInput & { id: string }) =>
      api<TeamMember>(`/team/${id}`, { method: "PATCH", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.team })
      qc.invalidateQueries({ queryKey: qk.audit })
      qc.invalidateQueries({ queryKey: qk.me })
    },
  })
}

export function useRemoveMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/team/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.team })
      qc.invalidateQueries({ queryKey: qk.audit })
    },
  })
}

// ---- Notifications ---------------------------------------------------------

export function useNotifications(params: Params, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: qk.notifications(params),
    queryFn: () => api<NotificationList>("/notifications", { params }),
    placeholderData: keepPreviousData,
    // Polls every 30 s without the live stream, and every 2 minutes with it, so a missed event can't stick.
    refetchInterval: opts.poll ? 30_000 : 120_000,
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<AppNotification>(`/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ updated: number }>("/notifications/read-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  })
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: qk.notificationPrefs,
    queryFn: () => api<NotificationPreference[]>("/notifications/preferences"),
  })
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (prefs: NotificationPreference[]) =>
      api<NotificationPreference[]>("/notifications/preferences", { method: "PUT", json: prefs }),
    onSuccess: (data) => qc.setQueryData(qk.notificationPrefs, data),
  })
}

// ---- Writes ----------------------------------------------------------------

export function useInstallConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ConnectionInput) => api<GatewayConnection>("/connections", { method: "POST", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.gateways })
      qc.invalidateQueries({ queryKey: qk.connections })
      qc.invalidateQueries({ queryKey: qk.audit })
    },
  })
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (input: { gatewayId: string; mode: Mode; credentials: Record<string, string> }) =>
      api<ConnectionTestResult>("/connections/test", { method: "POST", json: input }),
  })
}

export function useUpdateConnection(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { label?: string; credentials?: Record<string, string> }) =>
      api<ConnectionDetail>(`/connections/${id}`, { method: "PATCH", json: input }),
    onSuccess: (data) => {
      qc.setQueryData(qk.connection(id), data)
      qc.invalidateQueries({ queryKey: qk.gateways })
      qc.invalidateQueries({ queryKey: qk.connections })
    },
  })
}

export function useDeleteConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      api<{ id: string }>(`/connections/${id}`, { method: "DELETE", params: { force: force ? 1 : undefined } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.gateways })
      qc.invalidateQueries({ queryKey: qk.connections })
      qc.invalidateQueries({ queryKey: qk.products })
    },
  })
}

export function useCreateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ProductInput) => api<CreatedProduct>("/products", { method: "POST", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.products })
      qc.invalidateQueries({ queryKey: qk.audit })
    },
  })
}

export function useUpdateProduct(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<ProductInput> & { status?: "active" | "paused" }) =>
      api<ProductWithStats>(`/products/${id}`, { method: "PATCH", json: input }),
    onSuccess: (data) => {
      qc.setQueryData(qk.product(id), data)
      qc.invalidateQueries({ queryKey: qk.products })
    },
  })
}

export function useDeleteProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/products/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.products }),
  })
}

export function useRotateProductSecret(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (which: RotateTarget) =>
      api<RotatedSecret>(`/products/${id}/rotate`, {
        method: "POST",
        json: { which },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.product(id) })
      qc.invalidateQueries({ queryKey: qk.products })
      qc.invalidateQueries({ queryKey: qk.audit })
    },
  })
}

/** Sends a signed test.ping to the product's webhook endpoint and returns the delivery. */
export function useSendTestWebhook(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<WebhookDelivery>(`/products/${id}/test-webhook`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["deliveries"] }),
  })
}

/** Optimistically marks the delivery as retrying, then settles on the server's answer. */
export function useReplayDelivery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<WebhookDelivery>(`/webhooks/deliveries/${id}/replay`, { method: "POST" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["deliveries"] })
      const snapshots = qc.getQueriesData<Paginated<WebhookDelivery>>({ queryKey: ["deliveries"] })
      for (const [key, data] of snapshots) {
        if (!data) continue
        qc.setQueryData(key, {
          ...data,
          rows: data.rows.map((r) => (r.id === id ? { ...r, state: "retrying" as const, nextRetryAt: null } : r)),
        })
      }
      return { snapshots }
    },
    onError: (_e, _id, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["deliveries"] })
      qc.invalidateQueries({ queryKey: ["events"] })
      qc.invalidateQueries({ queryKey: ["overview"] })
      qc.invalidateQueries({ queryKey: ["transaction"] })
    },
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<PlatformSettings>) => api<PlatformSettings>("/settings", { method: "PATCH", json: input }),
    onSuccess: (data) => {
      qc.setQueryData(qk.settings, data)
      qc.invalidateQueries({ queryKey: qk.audit })
    },
  })
}

export function useTestAlerts() {
  return useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>("/settings/alerts/test", { method: "POST" }),
  })
}

// ---- Onboarding and sample data ---------------------------------------------

export function useOnboarding(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.onboarding,
    queryFn: () => api<OnboardingStatus>("/onboarding"),
    enabled: opts.enabled ?? true,
    // Webhooks and payments arrive from outside: check again while setup is unfinished.
    refetchInterval: (q) => (q.state.data && q.state.data.completed < q.state.data.total && !q.state.data.dismissed ? 20_000 : false),
    refetchOnWindowFocus: true,
  })
}

export function useSetOnboardingDismissed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dismissed: boolean) => api<void>(dismissed ? "/onboarding/dismiss" : "/onboarding/restore", { method: "POST" }),
    onMutate: (dismissed) => {
      const prev = qc.getQueryData<OnboardingStatus>(qk.onboarding)
      if (prev) qc.setQueryData(qk.onboarding, { ...prev, dismissed })
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.onboarding, ctx.prev)
    },
  })
}

export function useLoadSampleData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<OnboardingStatus>("/sample-data", { method: "POST" }),
    // Products, payments, gateway accounts and charts all change at once.
    onSuccess: (status) => {
      qc.setQueryData(qk.onboarding, status)
      return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "auth" && q.queryKey[0] !== qk.onboarding[0] })
    },
  })
}

export function useRemoveSampleData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<SampleDataRemoved>("/sample-data", { method: "DELETE" }),
    onSuccess: () => {
      // Drop cached pages for products that no longer exist instead of refetching them into 404s.
      qc.removeQueries({ queryKey: ["product"] })
      qc.removeQueries({ queryKey: ["connection"] })
      qc.removeQueries({ queryKey: ["transaction"] })
      return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "auth" })
    },
  })
}

// ---- Workspaces -------------------------------------------------------------

/** Moves the session to another workspace, then reloads the dashboard there with nothing cached from the old one. */
export function useSwitchWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (workspaceId: string) => api<{ user: SessionUser }>("/auth/workspace", { method: "POST", json: { workspaceId } }),
    onSuccess: ({ user }) => {
      setActiveWorkspace(user.workspace.id)
      qc.clear()
      // A full load on purpose: nothing from the previous company may stay in memory.
      window.location.replace("/")
    },
  })
}

/** The edition, paid features and limits for the active workspace. */
export function useEntitlements() {
  return useQuery({ queryKey: qk.entitlements, queryFn: () => api<Entitlements>("/entitlements"), staleTime: 5 * 60_000 })
}

/** Whether the active workspace may use a paid feature. False while loading. */
export function useHasFeature(feature: Feature): boolean {
  return hasFeature(useEntitlements().data, feature)
}

export function useInstallLicence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => api<{ licence: LicenceSummary }>("/licence", { method: "PUT", json: { key } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.entitlements }),
  })
}

export function useRemoveLicence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ licence: null }>("/licence", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.entitlements }),
  })
}

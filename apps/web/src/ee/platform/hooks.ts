"use client"

// YaroPay Enterprise License: see LICENSE.md in the parent folder.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { BillingPlan, CreatePlanInput, Invoice, NewPriceInput, UpdatePlanInput } from "@yaropay/core/billing"
import type { Role } from "@yaropay/core/auth"
import type {
  CreatedWorkspace,
  CreateWorkspaceInput,
  PlatformAuditEntry,
  PlatformOverview,
  PlatformRates,
  PlatformSettings,
  PlatformUserList,
  PlatformWorkspaceDetail,
  PlatformWorkspaceList,
  WorkspaceBillingInput,
} from "@yaropay/core/platform"
import { api, ApiRequestError } from "@/lib/api/client"

export const pk = {
  all: ["platform"] as const,
  overview: ["platform", "overview"] as const,
  workspaces: (params: object) => ["platform", "workspaces", params] as const,
  workspace: (id: string) => ["platform", "workspace", id] as const,
  plans: ["platform", "plans"] as const,
  rates: ["platform", "rates"] as const,
  audit: ["platform", "audit"] as const,
  settings: ["platform", "settings"] as const,
  users: (params: object) => ["platform", "users", params] as const,
}

/** 404 and the two-step 403 are answers, not glitches: don't retry them. */
const retry = (count: number, err: Error) => !(err instanceof ApiRequestError && err.status < 500) && count < 2

export function usePlatformOverview() {
  return useQuery({ queryKey: pk.overview, queryFn: () => api<PlatformOverview>("/platform/overview"), retry })
}

export function usePlatformWorkspaces(params: { q?: string; status?: string; page?: number }) {
  return useQuery({
    queryKey: pk.workspaces(params),
    queryFn: () => api<PlatformWorkspaceList>("/platform/workspaces", { params }),
    placeholderData: keepPreviousData,
    retry,
  })
}

export function usePlatformWorkspace(id: string) {
  return useQuery({ queryKey: pk.workspace(id), queryFn: () => api<PlatformWorkspaceDetail>(`/platform/workspaces/${id}`), retry })
}

export function usePlans() {
  return useQuery({ queryKey: pk.plans, queryFn: () => api<BillingPlan[]>("/platform/plans"), retry })
}

export function useRates() {
  return useQuery({ queryKey: pk.rates, queryFn: () => api<PlatformRates>("/platform/exchange-rates"), retry })
}

export function usePlatformAudit() {
  return useQuery({ queryKey: pk.audit, queryFn: () => api<PlatformAuditEntry[]>("/platform/audit"), retry })
}

/** Every change refreshes the whole console: totals, lists and the audit log all move together. */
function useRefresh() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: pk.all })
}

export function useSuspendWorkspace(id: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: { reason: string }) => api<PlatformWorkspaceDetail>(`/platform/workspaces/${id}/suspend`, { method: "POST", json: input }),
    onSuccess: refresh,
  })
}

export function useResumeWorkspace(id: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: () => api<PlatformWorkspaceDetail>(`/platform/workspaces/${id}/resume`, { method: "POST" }),
    onSuccess: refresh,
  })
}

export function useUpdateWorkspaceBilling(id: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: WorkspaceBillingInput) => api<PlatformWorkspaceDetail>(`/platform/workspaces/${id}/billing`, { method: "PATCH", json: input }),
    onSuccess: refresh,
  })
}

export function useCreatePlan() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: CreatePlanInput) => api<BillingPlan>("/platform/plans", { method: "POST", json: input }),
    onSuccess: refresh,
  })
}

export function useUpdatePlan(id: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: UpdatePlanInput) => api<BillingPlan>(`/platform/plans/${id}`, { method: "PATCH", json: input }),
    onSuccess: refresh,
  })
}

export function useAddPrice(id: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: NewPriceInput) => api<BillingPlan>(`/platform/plans/${id}/prices`, { method: "POST", json: input }),
    onSuccess: refresh,
  })
}

export function useSetRates() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (rates: Record<string, string>) => api<PlatformRates>("/platform/exchange-rates", { method: "PUT", json: { rates } }),
    onSuccess: refresh,
  })
}

export function useMarkInvoicePaid() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: { id: string; note?: string }) => api<Invoice>(`/platform/invoices/${input.id}/mark-paid`, { method: "POST", json: { note: input.note } }),
    onSuccess: refresh,
  })
}

export function useVoidInvoice() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: { id: string; reason: string }) => api<Invoice>(`/platform/invoices/${input.id}/void`, { method: "POST", json: { reason: input.reason } }),
    onSuccess: refresh,
  })
}

export function useRunInvoicing() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: () => api<{ written: number }>("/platform/invoices/run", { method: "POST" }),
    onSuccess: refresh,
  })
}

/** Opens a read-only support view of a company in this session. */
export function useStartSupport(id: string) {
  return useMutation({
    mutationFn: (input: { reason: string }) => api<{ workspaceId: string; expiresAt: string }>(`/platform/workspaces/${id}/support`, { method: "POST", json: input }),
  })
}

export function usePlatformSettings() {
  return useQuery({ queryKey: pk.settings, queryFn: () => api<PlatformSettings>("/platform/settings"), retry })
}

export function useUpdatePlatformSettings() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: Partial<PlatformSettings>) => api<PlatformSettings>("/platform/settings", { method: "PATCH", json: input }),
    onSuccess: refresh,
  })
}

// ---- Companies, teams and people ----

export function useCreateWorkspace() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (input: CreateWorkspaceInput) => api<CreatedWorkspace>("/platform/workspaces", { method: "POST", json: input }), onSuccess: refresh })
}

export function useRenameWorkspace(id: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (name: string) => api<{ ok: true }>(`/platform/workspaces/${id}`, { method: "PATCH", json: { name } }), onSuccess: refresh })
}

export function useDeleteWorkspace(id: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (confirmName: string) => api<{ ok: true }>(`/platform/workspaces/${id}`, { method: "DELETE", json: { confirmName } }),
    onSuccess: refresh,
  })
}

export function usePlatformInvite(id: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: { email: string; role: Role }) => api<{ inviteUrl: string; emailed: boolean }>(`/platform/workspaces/${id}/invites`, { method: "POST", json: input }),
    onSuccess: refresh,
  })
}

export function useInviteAction(id: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: { inviteId: string; kind: "resend" | "revoke" }) =>
      input.kind === "resend"
        ? api<unknown>(`/platform/workspaces/${id}/invites/${input.inviteId}/resend`, { method: "POST" })
        : api<unknown>(`/platform/workspaces/${id}/invites/${input.inviteId}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
}

export function useMemberAction(id: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: { userId: string; role?: Role; remove?: boolean }) =>
      input.remove
        ? api<unknown>(`/platform/workspaces/${id}/members/${input.userId}`, { method: "DELETE" })
        : api<unknown>(`/platform/workspaces/${id}/members/${input.userId}`, { method: "PATCH", json: { role: input.role } }),
    onSuccess: refresh,
  })
}

export function usePlatformUsers(params: { q?: string; page?: number }) {
  return useQuery({ queryKey: pk.users(params), queryFn: () => api<PlatformUserList>("/platform/users", { params }), placeholderData: keepPreviousData, retry })
}

export type UserAction = "disable" | "enable" | "password-reset" | "reset-two-step"

export function useUserAction() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: { userId: string; action: UserAction }) => api<{ ok: true }>(`/platform/users/${input.userId}/${input.action}`, { method: "POST" }),
    onSuccess: refresh,
  })
}

"use client"

// YaroPay Enterprise License: see LICENSE.md in the ee folder.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  CreatedMcpToken,
  CreateMcpTokenInput,
  McpActivityEntry,
  McpApproval,
  McpConnection,
  McpConsentInput,
  McpConsentRequest,
  McpConsentResult,
  McpInfo,
  McpSettings,
  McpSettingsInput,
} from "@yaropay/core/mcp"
import { api } from "@/lib/api/client"

const qk = {
  info: ["mcp", "info"] as const,
  connections: ["mcp", "connections"] as const,
  activity: (page: number) => ["mcp", "activity", page] as const,
}

export function useMcpInfo(enabled = true) {
  return useQuery({ queryKey: qk.info, queryFn: () => api<McpInfo>("/mcp/info"), enabled })
}

export function useMcpConnections(enabled = true) {
  return useQuery({ queryKey: qk.connections, queryFn: () => api<McpConnection[]>("/mcp/connections"), enabled })
}

export function useMcpActivity(page: number, enabled = true) {
  return useQuery({
    queryKey: qk.activity(page),
    queryFn: () => api<{ rows: McpActivityEntry[]; page: number; more: boolean }>("/mcp/activity", { params: { page } }),
    enabled,
  })
}

export function useCreateMcpToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateMcpTokenInput) => api<CreatedMcpToken>("/mcp/tokens", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.connections }),
  })
}

export function useRevokeMcpConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/mcp/connections/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.connections }),
  })
}

export function useUpdateMcpSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: McpSettingsInput) => api<McpSettings>("/mcp/settings", { method: "PUT", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.info })
      qc.invalidateQueries({ queryKey: qk.connections })
    },
  })
}

export function useMcpConsent(id: string | null) {
  return useQuery({
    queryKey: ["mcp", "consent", id] as const,
    queryFn: () => api<McpConsentRequest>(`/mcp/authorize/${encodeURIComponent(id!)}`),
    enabled: !!id,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useApproveMcpConsent(id: string) {
  return useMutation({ mutationFn: (input: McpConsentInput) => api<McpConsentResult>(`/mcp/authorize/${encodeURIComponent(id)}`, { method: "POST", json: input }) })
}

export function useDenyMcpConsent(id: string) {
  return useMutation({ mutationFn: () => api<McpConsentResult>(`/mcp/authorize/${encodeURIComponent(id)}/deny`, { method: "POST" }) })
}

export function useMcpApproval(id: string) {
  return useQuery({ queryKey: ["mcp", "approval", id] as const, queryFn: () => api<McpApproval>(`/mcp/approvals/${encodeURIComponent(id)}`), retry: false })
}

export function useDecideMcpApproval(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (decision: "approve" | "deny") => api<McpApproval>(`/mcp/approvals/${encodeURIComponent(id)}/${decision}`, { method: "POST" }),
    onSuccess: (data) => qc.setQueryData(["mcp", "approval", id], data),
  })
}

"use client"

// YaroPay Enterprise License: see LICENSE.md in the ee folder.

import type { Role } from "@yaropay/core/auth"
import { type CreatedMcpToken, MCP_TOKEN_MAX_DAYS, type McpConnection, type McpInfo } from "@yaropay/core/mcp"
import { Bot, ExternalLink, KeyRound, Loader2, Lock, Plus, Sparkles } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { PasswordInput } from "@/components/auth/password-input"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { CopyField } from "@/components/shared/copy-field"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiRequestError } from "@/lib/api/client"
import { useEntitlements, useReauth } from "@/lib/api/hooks"
import { formatDate, formatDateTime, formatRelative } from "@/lib/format"
import { useCreateMcpToken, useMcpActivity, useMcpConnections, useMcpInfo, useRevokeMcpConnection, useUpdateMcpSettings } from "./hooks"

const DOCS_URL = "https://yaropay.com/docs/ai-assistants"
const ROLES: { value: Role; label: string }[] = [
  { value: "owner", label: "Owners" },
  { value: "admin", label: "Admins" },
  { value: "developer", label: "Developers" },
  { value: "finance", label: "Finance" },
  { value: "viewer", label: "Viewers" },
]

/** Settings → AI apps. In Community it only says what the paid editions add. */
export function AiAppsPanel() {
  const { data: entitlements } = useEntitlements()
  const community = entitlements?.edition === "community"
  const { data: info, isLoading } = useMcpInfo(!!entitlements && !community)
  if (!entitlements || (!community && isLoading)) return <Skeleton className="h-96 rounded-2xl" />
  if (community || !info) return <CommunityNote />
  return (
    <div className="space-y-6" data-testid="ai-apps-panel">
      <ConnectPanel info={info} />
      <ConnectionsPanel info={info} />
      {info.canManage && <ControlsPanel info={info} />}
      <ActivityPanel everyone={info.canManage} />
    </div>
  )
}

function CommunityNote() {
  return (
    <Panel>
      <PanelHeader title="AI apps (MCP)" description="Ask Claude, ChatGPT, Cursor or VS Code about your payments, products and webhooks." />
      <div className="p-5">
        <Alert>
          <Lock />
          <AlertTitle>Available with YaroPay Enterprise and Cloud</AlertTitle>
          <AlertDescription>
            AI apps connect to YaroPay through MCP and see what the member who connected them may see, in test mode unless live data is allowed.{" "}
            <a className="underline" href={DOCS_URL} target="_blank" rel="noreferrer">
              How it works
            </a>
          </AlertDescription>
        </Alert>
      </div>
    </Panel>
  )
}

function snippets(url: string, token: string) {
  return {
    claude: `claude mcp add --transport http yaropay ${url} --header "Authorization: Bearer ${token}"`,
    cursor: JSON.stringify({ mcpServers: { yaropay: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    vscode: JSON.stringify(
      {
        servers: { yaropay: { type: "http", url, headers: { Authorization: "Bearer ${input:yaropay-token}" } } },
        inputs: [{ type: "promptString", id: "yaropay-token", description: "YaroPay AI app token", password: true }],
      },
      null,
      2,
    ),
  }
}

function Snippets({ url, token }: { url: string; token: string }) {
  const s = snippets(url, token)
  return (
    <Tabs defaultValue="claude">
      <TabsList>
        <TabsTrigger value="claude">Claude Code</TabsTrigger>
        <TabsTrigger value="cursor">Cursor</TabsTrigger>
        <TabsTrigger value="vscode">VS Code</TabsTrigger>
      </TabsList>
      <TabsContent value="claude" className="mt-3">
        <CopyField label="Run in a terminal" value={s.claude} />
      </TabsContent>
      <TabsContent value="cursor" className="mt-3 space-y-1.5">
        <CopyField label="Add to ~/.cursor/mcp.json" value={s.cursor.replace(/\s+/g, " ")} />
      </TabsContent>
      <TabsContent value="vscode" className="mt-3 space-y-1.5">
        <CopyField label="Add to .vscode/mcp.json (VS Code asks for the token)" value={s.vscode.replace(/\s+/g, " ")} />
      </TabsContent>
    </Tabs>
  )
}

function ConnectPanel({ info }: { info: McpInfo }) {
  return (
    <Panel>
      <PanelHeader
        title="AI apps (MCP)"
        description="Connect Claude, Cursor, VS Code and other AI apps to this company. They see what you may see, in test mode unless you allow live data, with customer details masked unless an admin shares them."
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href={DOCS_URL} target="_blank" rel="noreferrer">
              Guide <ExternalLink />
            </a>
          </Button>
        }
      />
      <div className="space-y-5 p-5">
        {!info.available && (
          <Alert variant="destructive" data-testid="mcp-unavailable">
            <Lock />
            <AlertTitle>{"AI apps can't be used here right now"}</AlertTitle>
            <AlertDescription>{info.reason}</AlertDescription>
          </Alert>
        )}
        <CopyField label="MCP server URL" value={info.url} testId="mcp-url" hint="Create a token below, then add YaroPay to your AI app with it." />
        <Snippets url={info.url} token="<your token>" />
      </div>
    </Panel>
  )
}

function ConnectionsPanel({ info }: { info: McpInfo }) {
  const { data, isLoading } = useMcpConnections()
  const revoke = useRevokeMcpConnection()
  const [creating, setCreating] = React.useState(false)
  const [created, setCreated] = React.useState<CreatedMcpToken | null>(null)
  return (
    <Panel className="overflow-hidden" data-testid="mcp-connections">
      <PanelHeader
        title={info.canManage ? "Connected AI apps and tokens" : "Your AI app tokens"}
        description="Each token works for one member in this company. Revoke one and the app loses access at once. Changing your password or two-step sign-in revokes all of yours."
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={!info.available} data-testid="mcp-new-token">
            <Plus /> New token
          </Button>
        }
      />
      <ul className="mt-3 divide-y border-t">
        {isLoading && (
          <li className="px-5 py-3">
            <Skeleton className="h-9" />
          </li>
        )}
        {data?.length === 0 && <li className="px-5 py-4 text-sm text-muted-foreground">No AI apps connected yet.</li>}
        {data?.map((c) => (
          <ConnectionRow
            key={c.id}
            c={c}
            pending={revoke.isPending}
            onRevoke={() =>
              revoke.mutate(c.id, {
                onSuccess: () => toast.success(`${c.name} can't reach YaroPay any more`),
                onError: (e) => toast.error(e.message),
              })
            }
          />
        ))}
      </ul>
      <CreateTokenDialog info={info} open={creating} onOpenChange={setCreating} onCreated={setCreated} />
      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Token created</DialogTitle>
            <DialogDescription>{"Copy it now: YaroPay won't show it again. Treat it like a password."}</DialogDescription>
          </DialogHeader>
          {created && (
            <div className="min-w-0 space-y-4">
              <CopyField label="Token" value={created.token} testId="mcp-created-token" />
              <Snippets url={info.url} token={created.token} />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

function ConnectionRow({ c, pending, onRevoke }: { c: McpConnection; pending: boolean; onRevoke: () => void }) {
  return (
    <li className="flex items-center gap-3 px-5 py-3" data-testid="mcp-connection">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        {c.kind === "token" ? <KeyRound className="size-4" aria-hidden /> : <Bot className="size-4" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {c.name}
          <Badge variant={c.liveAllowed ? "default" : "secondary"} className="h-4 px-1.5 text-[10px]">
            {c.liveAllowed ? "Test + live" : "Test"}
          </Badge>
          {!c.mine && <span className="text-xs font-normal text-muted-foreground">{c.user.name}</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {c.tokenPreview ? `${c.tokenPreview} · ` : ""}created {formatRelative(c.createdAt)}
          {c.lastUsedAt ? ` · last used ${formatRelative(c.lastUsedAt)}` : " · not used yet"}
          {c.expiresAt ? ` · until ${formatDate(c.expiresAt)}` : ""}
        </p>
      </div>
      <Button variant="ghost" size="sm" disabled={pending} onClick={onRevoke}>
        Revoke
      </Button>
    </li>
  )
}

function CreateTokenDialog({ info, open, onOpenChange, onCreated }: { info: McpInfo; open: boolean; onOpenChange: (o: boolean) => void; onCreated: (t: CreatedMcpToken) => void }) {
  const create = useCreateMcpToken()
  const reauth = useReauth()
  const [name, setName] = React.useState("")
  const [days, setDays] = React.useState("30")
  const [live, setLive] = React.useState(false)
  const [needsReauth, setNeedsReauth] = React.useState(false)
  const [password, setPassword] = React.useState("")
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  // Closing clears the form, so the next token starts blank.
  function setOpen(o: boolean) {
    if (!o) {
      setName("")
      setDays("30")
      setLive(false)
      setNeedsReauth(false)
      setPassword("")
      setCode("")
      setError(null)
    }
    onOpenChange(o)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (needsReauth) await reauth.mutateAsync({ password, code })
      const created = await create.mutateAsync({ name: name.trim(), days: Number(days), live })
      setOpen(false)
      onCreated(created)
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "reauth_required") {
        setNeedsReauth(true)
        setError(err.message)
        return
      }
      setError((err as Error).message)
    }
  }

  const busy = create.isPending || reauth.isPending
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New AI app token</DialogTitle>
            <DialogDescription>For Claude Code, Cursor, VS Code or any app that takes an MCP server URL and a token.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="mcp-token-name">Name</FieldLabel>
            <Input id="mcp-token-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude Code on my laptop" maxLength={80} required />
          </Field>
          <Field>
            <FieldLabel>Lasts</FieldLabel>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[7, 30, 60, MCP_TOKEN_MAX_DAYS].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="mcp-token-live" checked={live} onCheckedChange={(v) => setLive(v === true)} disabled={!info.liveAvailable} />
            <div>
              <FieldLabel htmlFor="mcp-token-live">Live data too</FieldLabel>
              <FieldDescription>
                {info.liveAvailable
                  ? "Real payments as well as test ones. You'll confirm with your password and code."
                  : info.settings.liveAllowed
                    ? "Turn on two-step sign-in (Profile & security) to allow live data."
                    : "This company keeps AI apps to test data. An admin can change that below."}
              </FieldDescription>
            </div>
          </Field>
          {needsReauth && (
            <div className="space-y-3 rounded-lg border p-3">
              <Field>
                <FieldLabel htmlFor="mcp-reauth-password">Password</FieldLabel>
                <PasswordInput id="mcp-reauth-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-reauth-code">Authenticator code</FieldLabel>
                <Input id="mcp-reauth-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
              </Field>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()} data-testid="mcp-create-token">
              {busy && <Loader2 className="animate-spin" />} Create token
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ControlsPanel({ info }: { info: McpInfo }) {
  const update = useUpdateMcpSettings()
  const s = info.settings
  const set = (input: Parameters<typeof update.mutate>[0], done: string) =>
    update.mutate(input, { onSuccess: () => toast.success(done), onError: (e) => toast.error(e.message) })
  const rows: { key: "enabled" | "liveAllowed" | "shareCustomerDetails"; title: string; description: string; on: string; off: string }[] = [
    { key: "enabled", title: "AI apps", description: "Let members connect AI apps to this company.", on: "AI apps turned on", off: "AI apps turned off" },
    {
      key: "liveAllowed",
      title: "Live data",
      description: "Let members give an AI app live payments too (they need two-step sign-in). Turning this off takes live away from every connection.",
      on: "Live data allowed",
      off: "AI apps keep to test data",
    },
    {
      key: "shareCustomerDetails",
      title: "Customer details",
      description: "Share customers' full emails and names with AI apps. Off: emails are masked and names cut to initials.",
      on: "Customer details shared",
      off: "Customer details masked",
    },
  ]
  return (
    <Panel className="overflow-hidden" data-testid="mcp-controls">
      <PanelHeader title="Company controls" description="What AI apps may do in this company, for everyone." />
      <ul className="mt-3 divide-y border-t">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{r.title}</p>
              <p className="text-sm text-muted-foreground">{r.description}</p>
            </div>
            <Switch
              checked={s[r.key]}
              disabled={update.isPending}
              onCheckedChange={(checked) => set({ [r.key]: checked }, checked ? r.on : r.off)}
              aria-label={r.title}
              data-testid={`mcp-control-${r.key}`}
            />
          </li>
        ))}
        <li className="px-5 py-3.5">
          <p className="text-sm font-medium">Who may connect</p>
          <div className="mt-2 flex flex-wrap gap-4">
            {ROLES.map((role) => {
              const on = s.allowedRoles.includes(role.value)
              return (
                <label key={role.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={on}
                    disabled={update.isPending || (on && s.allowedRoles.length === 1)}
                    onCheckedChange={(v) =>
                      set({ allowedRoles: v === true ? [...s.allowedRoles, role.value] : s.allowedRoles.filter((x) => x !== role.value) }, "Roles updated")
                    }
                  />
                  {role.label}
                </label>
              )
            })}
          </div>
        </li>
      </ul>
    </Panel>
  )
}

const OUTCOME: Record<string, string> = {
  ok: "Answered",
  error: "Error",
  denied: "Refused",
  approval_required: "Waiting for approval",
  rate_limited: "Too many requests",
}

function ActivityPanel({ everyone }: { everyone: boolean }) {
  const [page, setPage] = React.useState(1)
  const { data, isLoading } = useMcpActivity(page)
  return (
    <Panel className="overflow-hidden" data-testid="mcp-activity">
      <PanelHeader
        title="Activity"
        description={everyone ? "What AI apps asked for in this company, newest first. Kept for 90 days." : "What your AI apps asked for, newest first. Kept for 90 days."}
      />
      <div className="mt-3 overflow-x-auto border-t">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>App</TableHead>
              {everyone && <TableHead>Member</TableHead>}
              <TableHead>Tool</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-8" />
                </TableCell>
              </TableRow>
            )}
            {data?.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  <Sparkles className="mx-auto mb-1 size-4" aria-hidden />
                  Nothing yet. Ask your AI app about your payments.
                </TableCell>
              </TableRow>
            )}
            {data?.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-xs">{formatDateTime(r.at)}</TableCell>
                <TableCell className="text-sm">{r.connectionName}</TableCell>
                {everyone && <TableCell className="text-sm">{r.userName ?? "Removed member"}</TableCell>}
                <TableCell className="font-mono text-xs">{r.tool}</TableCell>
                <TableCell className="text-xs">{r.mode ?? "–"}</TableCell>
                <TableCell>
                  <Badge variant={r.outcome === "ok" ? "secondary" : r.outcome === "error" ? "destructive" : "outline"}>{OUTCOME[r.outcome] ?? r.outcome}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {(page > 1 || data?.more) && (
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <Button variant="outline" size="sm" disabled={!data?.more} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </div>
      )}
    </Panel>
  )
}

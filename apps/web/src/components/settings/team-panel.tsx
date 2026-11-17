"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import {
  assignableRoles,
  canManageRole,
  type CreatedInvite,
  type Invite,
  inviteSchema,
  type Role,
  ROLES,
} from "@yaropay/core/auth"
import type { ColorSlot, TeamMember } from "@yaropay/core/types"
import { Link2, Loader2, MailCheck, MoreHorizontal, RotateCw, Trash2, UserPlus, X } from "lucide-react"
import * as React from "react"
import { Controller, type Resolver, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"
import { roleLabel, UserAvatar } from "@/components/layout/user-menu"
import { CopyField } from "@/components/shared/copy-field"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { ProductChip } from "@/components/shared/product-chip"
import { ProductScopeSelect } from "@/components/shared/product-scope-select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  useAuthState,
  useCreateInvite,
  useInvites,
  useProducts,
  useRemoveMember,
  useResendInvite,
  useRevokeInvite,
  useTeam,
  useUpdateMember,
} from "@/lib/api/hooks"
import { useCan, useMe } from "@/lib/auth"
import { applyApiErrors } from "@/lib/forms"
import { formatDate, formatRelative } from "@/lib/format"

type ProductOption = { id: string; name: string; colorSlot: ColorSlot }

export function TeamPanel() {
  const me = useMe()
  const canWrite = useCan("team:write")
  const { data: members, isLoading } = useTeam()
  const { data: invites } = useInvites({ enabled: canWrite })
  const { data: productsData = [] } = useProducts()
  const products: ProductOption[] = productsData.map((p) => ({ id: p.id, name: p.name, colorSlot: p.colorSlot }))
  const [inviting, setInviting] = React.useState(false)
  const [shared, setShared] = React.useState<CreatedInvite | null>(null)
  const ownerCount = members?.filter((m) => m.role === "owner").length ?? 0

  return (
    <div className="space-y-6">
      <Panel className="overflow-hidden">
        <PanelHeader
          title="Members"
          description="People who can sign in to this install. Roles decide what they can change; product access decides what they can see."
          actions={
            canWrite ? (
              <Button size="sm" onClick={() => setInviting(true)} data-testid="invite-member">
                <UserPlus /> Invite
              </Button>
            ) : null
          }
        />
        <div className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Product access</TableHead>
                <TableHead className="hidden md:table-cell">Last active</TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5} className="px-5">
                      <Skeleton className="h-8" />
                    </TableCell>
                  </TableRow>
                ))}
              {members?.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isMe={m.id === me.id}
                  myRole={me.role}
                  canWrite={canWrite}
                  lastOwner={m.role === "owner" && ownerCount <= 1}
                  products={products}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>

      {canWrite && <InvitesPanel invites={invites ?? []} products={products} onShare={setShared} />}

      {canWrite && (
        <InviteDialog
          open={inviting}
          onOpenChange={setInviting}
          products={products}
          onCreated={(res) => {
            setInviting(false)
            setShared(res)
          }}
        />
      )}
      <ShareInviteDialog value={shared} onClose={() => setShared(null)} />
    </div>
  )
}

function ScopeSummary({ productIds, products }: { productIds: string[] | null; products: ProductOption[] }) {
  if (productIds === null) return <span className="text-sm text-muted-foreground">All products</span>
  const chosen = products.filter((p) => productIds.includes(p.id))
  if (!chosen.length) return <span className="text-sm text-critical-text">No products</span>
  return (
    <span className="flex flex-wrap gap-1">
      {chosen.map((p) => (
        <ProductChip key={p.id} name={p.name} slot={p.colorSlot} size="sm" />
      ))}
    </span>
  )
}

function MemberRow({
  member: m,
  isMe,
  myRole,
  canWrite,
  lastOwner,
  products,
}: {
  member: TeamMember
  isMe: boolean
  myRole: Role
  canWrite: boolean
  lastOwner: boolean
  products: ProductOption[]
}) {
  const update = useUpdateMember()
  const remove = useRemoveMember()
  const [confirm, setConfirm] = React.useState(false)
  const manageable = canWrite && !isMe && canManageRole(myRole, m.role)
  const roles = assignableRoles(myRole)
  const lockReason = isMe
    ? "You can't change your own role or access."
    : lastOwner
      ? "Every install needs at least one owner."
      : !canManageRole(myRole, m.role)
        ? `Only owners can change ${roleLabel(m.role).toLowerCase()}s.`
        : null

  const save = async (input: { role?: Role; productIds?: string[] | null }) => {
    try {
      await update.mutateAsync({ id: m.id, ...input })
      toast.success(`${m.name} updated`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update")
    }
  }

  return (
    <TableRow data-testid={`member-${m.email}`}>
      <TableCell className="pl-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <UserAvatar name={m.name} className="size-8" />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium">
              {m.name}
              {isMe && <Badge variant="outline" className="h-4 px-1 text-[10px]">You</Badge>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{m.email}</p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        {manageable && !lastOwner ? (
          <Select value={m.role} onValueChange={(v) => save({ role: v as Role })} disabled={update.isPending}>
            <SelectTrigger size="sm" className="h-8 w-32" aria-label={`Role for ${m.name}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.filter((r) => roles.includes(r.value)).map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Badge variant={m.role === "owner" ? "default" : "secondary"}>{roleLabel(m.role)}</Badge>
              </span>
            </TooltipTrigger>
            {lockReason && canWrite && <TooltipContent>{lockReason}</TooltipContent>}
          </Tooltip>
        )}
      </TableCell>
      <TableCell>
        {manageable && m.role !== "owner" && m.role !== "admin" ? (
          <ProductScopeSelect
            value={m.productIds}
            onChange={(productIds) => save({ productIds })}
            products={products}
            disabled={update.isPending}
            className="w-44"
          />
        ) : (
          <ScopeSummary productIds={m.productIds} products={products} />
        )}
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{formatRelative(m.lastActiveAt)}</TableCell>
      <TableCell className="pr-5 text-right">
        {manageable && !lastOwner && (
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={() => setConfirm(true)} aria-label={`Remove ${m.name}`}>
            <Trash2 />
          </Button>
        )}
        <Dialog open={confirm} onOpenChange={setConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove {m.name}?</DialogTitle>
              <DialogDescription>
                They are signed out everywhere and lose access right away. Their past actions stay in the audit log.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={async () => {
                  try {
                    await remove.mutateAsync(m.id)
                    toast.success(`${m.name} removed`)
                    setConfirm(false)
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not remove")
                  }
                }}
              >
                {remove.isPending && <Loader2 className="animate-spin" />}
                Remove member
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  )
}

function InvitesPanel({ invites, products, onShare }: { invites: Invite[]; products: ProductOption[]; onShare: (i: CreatedInvite) => void }) {
  const resend = useResendInvite()
  const revoke = useRevokeInvite()
  const { data: state } = useAuthState()
  if (!invites.length) return null

  const doResend = async (invite: Invite, showLink: boolean) => {
    try {
      const res = await resend.mutateAsync(invite.id)
      if (showLink || !res.emailed) onShare(res)
      else toast.success(`Invite sent again to ${invite.email}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resend")
    }
  }

  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="Pending invites" description="Invites work once and expire after seven days." />
      <ul className="mt-3 divide-y border-t">
        {invites.map((i) => (
          <li key={i.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center" data-testid={`invite-${i.email}`}>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-sm font-medium">
                {i.email}
                {i.expired && (
                  <Badge variant="outline" className="border-warning/50 text-warning-text">
                    Expired
                  </Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {roleLabel(i.role)} · invited by {i.invitedBy} · {i.expired ? "expired" : `expires ${formatDate(i.expiresAt)}`}
              </p>
            </div>
            <ScopeSummary productIds={i.productIds} products={products} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="self-end text-muted-foreground sm:self-auto" aria-label={`Actions for ${i.email}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {state?.emailEnabled && (
                  <DropdownMenuItem onSelect={() => doResend(i, false)}>
                    <RotateCw /> Resend email
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => doResend(i, true)}>
                  <Link2 /> Get a new link
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={async () => {
                    try {
                      await revoke.mutateAsync(i.id)
                      toast.success(`Invite for ${i.email} revoked`)
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Could not revoke")
                    }
                  }}
                >
                  <X /> Revoke
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

type InviteValues = z.infer<typeof inviteSchema>

function InviteDialog({
  open,
  onOpenChange,
  products,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  products: ProductOption[]
  onCreated: (res: CreatedInvite) => void
}) {
  const me = useMe()
  const create = useCreateInvite()
  const roles = ROLES.filter((r) => assignableRoles(me.role).includes(r.value))
  const defaultRole: Role = roles.some((r) => r.value === "developer") ? "developer" : (roles.at(-1)?.value ?? "viewer")
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema) as Resolver<InviteValues>,
    defaultValues: { email: "", role: defaultRole, productIds: null },
  })
  const [formError, setFormError] = React.useState<string | null>(null)
  const role = useWatch({ control: form.control, name: "role" })
  const scopable = role !== "owner" && role !== "admin"
  const errors = form.formState.errors

  const submit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      const res = await create.mutateAsync({ ...values, productIds: scopable ? values.productIds : null })
      form.reset({ email: "", role: defaultRole, productIds: null })
      onCreated(res)
    } catch (e) {
      setFormError(applyApiErrors(form, e))
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>They get a link to set their name and password. It works once and expires in seven days.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="my-5 gap-4">
            {formError && <p className="text-sm text-critical-text">{formError}</p>}
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input id="invite-email" type="email" autoComplete="off" placeholder="name@company.com" {...form.register("email")} />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-role">Role</FieldLabel>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="invite-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>{ROLES.find((r) => r.value === role)?.description}</FieldDescription>
            </Field>
            {scopable && (
              <Field>
                <FieldLabel htmlFor="invite-scope">Product access</FieldLabel>
                <Controller
                  control={form.control}
                  name="productIds"
                  render={({ field }) => (
                    <ProductScopeSelect id="invite-scope" value={field.value ?? null} onChange={field.onChange} products={products} className="w-full" />
                  )}
                />
                <FieldDescription>Limit what they see to some products, for example an agency that builds one app.</FieldDescription>
              </Field>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending} data-testid="send-invite">
              {create.isPending && <Loader2 className="animate-spin" />}
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ShareInviteDialog({ value, onClose }: { value: CreatedInvite | null; onClose: () => void }) {
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <span className="mb-1 grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            {value?.emailed ? <MailCheck className="size-5" /> : <Link2 className="size-5" />}
          </span>
          <DialogTitle>{value?.emailed ? `Invite sent to ${value.invite.email}` : "Share this invite link"}</DialogTitle>
          <DialogDescription>
            {value?.emailed
              ? "You can also share the link yourself. It works once."
              : "This install can't send email, so copy the link and send it yourself. It works once and expires in seven days."}
          </DialogDescription>
        </DialogHeader>
        {value && <CopyField label="Invite link" value={value.inviteUrl} testId="invite-url" />}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

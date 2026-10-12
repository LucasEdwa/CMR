import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { ROLES, invitationSchema, inviteSchema, memberSchema, type InviteInput, type Member, type Role } from '@crm/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/Field'
import { NativeSelect } from '@/components/NativeSelect'
import { ME_KEY, useActiveWorkspace, useMe, useResetSession } from '@/hooks/useMe'
import { api, send } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { describedBy, fieldError } from '@/lib/form'

const MEMBERS_KEY = ['members'] as const
const INVITATIONS_KEY = ['invitations'] as const

function InviteForm() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { role: myRole } = useActiveWorkspace()
  const form = useForm<InviteInput>({ resolver: zodResolver(inviteSchema), defaultValues: { email: '', role: 'member' } })
  const { errors } = form.formState
  const invite = useMutation({
    mutationFn: (values: InviteInput) => send('POST', '/workspace/invitations', values),
    onSuccess: async (_, values) => {
      toast.success(t('settings.invited', { email: values.email }))
      form.reset({ email: '', role: values.role })
      await queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY })
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })
  const roles = ROLES.filter((r) => r !== 'owner' || myRole === 'owner')

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-medium">{t('settings.inviteTitle')}</h2>
      <form className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end" onSubmit={form.handleSubmit((v) => invite.mutate(v))} noValidate>
        <Field id="invite-email" label={t('common.email')} error={fieldError(t, errors.email, 'email')}>
          <Input id="invite-email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...describedBy('invite-email', !!errors.email)} {...form.register('email')} />
        </Field>
        <Field id="invite-role" label={t('common.role')}>
          <NativeSelect id="invite-role" {...form.register('role')}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button type="submit" disabled={invite.isPending}>
          {t('settings.inviteButton')}
        </Button>
      </form>
    </section>
  )
}

function PendingInvitations() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const invitations = useQuery({
    queryKey: INVITATIONS_KEY,
    queryFn: () => api('/workspace/invitations', z.array(invitationSchema)),
  })
  const withdraw = useMutation({
    mutationFn: (id: string) => send('DELETE', `/workspace/invitations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY }),
    onError: (err) => toast.error(errorMessage(t, err)),
  })
  if (!invitations.data?.length) return null

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-medium">{t('settings.pending')}</h2>
      <ul className="divide-y rounded-md border">
        {invitations.data.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="min-w-0 flex-1 truncate">{inv.email}</span>
            <Badge variant="secondary">{t(`roles.${inv.role}`)}</Badge>
            <span className="text-muted-foreground text-xs">
              {t('settings.expires', { date: formatDate(inv.expiresAt, i18n.language) })}
            </span>
            <Button variant="ghost" size="sm" onClick={() => withdraw.mutate(inv.id)}>
              {t('settings.withdraw')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MemberRow({ member, onRemove }: { member: Member; onRemove: (m: Member) => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const { role: myRole, canManage } = useActiveWorkspace()
  const isMe = member.userId === me?.user.id
  // Admins cannot change or remove owners, and nobody can make an owner except an owner.
  const canEdit = canManage && !isMe && (myRole === 'owner' || member.role !== 'owner')
  const changeRole = useMutation({
    mutationFn: (role: Role) => send('PATCH', `/workspace/members/${member.userId}`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MEMBERS_KEY }),
    onError: (err) => toast.error(errorMessage(t, err)),
  })

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {member.name} {isMe && <span className="text-muted-foreground font-normal">({t('settings.you')})</span>}
        </div>
        <div className="text-muted-foreground truncate text-sm">{member.email}</div>
      </div>
      {canEdit ? (
        <NativeSelect
          aria-label={t('common.role')}
          className="w-40"
          value={member.role}
          onChange={(e) => changeRole.mutate(e.target.value as Role)}
        >
          {ROLES.filter((r) => r !== 'owner' || myRole === 'owner').map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <Badge variant="secondary">{t(`roles.${member.role}`)}</Badge>
      )}
      {(canEdit || isMe) && (
        <Button variant="ghost" size="sm" onClick={() => onRemove(member)}>
          {isMe ? t('settings.leave') : t('common.remove')}
        </Button>
      )}
    </li>
  )
}

export function Members() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const reset = useResetSession()
  const { data: me } = useMe()
  const { workspace, canManage } = useActiveWorkspace()
  const [removing, setRemoving] = useState<Member | null>(null)
  const members = useQuery({ queryKey: MEMBERS_KEY, queryFn: () => api('/workspace/members', z.array(memberSchema)) })
  const remove = useMutation({
    mutationFn: (m: Member) => send('DELETE', `/workspace/members/${m.userId}`),
    onSuccess: async (_, m) => {
      setRemoving(null)
      if (m.userId === me?.user.id) {
        await reset()
        navigate('/')
      } else {
        await queryClient.invalidateQueries({ queryKey: MEMBERS_KEY })
        await queryClient.invalidateQueries({ queryKey: ME_KEY })
      }
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })
  const leaving = removing?.userId === me?.user.id

  return (
    <div className="grid gap-8">
      {canManage && <InviteForm />}
      {canManage && <PendingInvitations />}
      <section className="grid gap-3">
        <h2 className="text-lg font-medium">{t('settings.members')}</h2>
        {members.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : members.isError ? (
          <p className="text-destructive">{errorMessage(t, members.error)}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {members.data.map((m) => (
              <MemberRow key={m.userId} member={m} onRemove={setRemoving} />
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{leaving ? t('settings.leave') : t('common.remove')}</DialogTitle>
            <DialogDescription>
              {leaving
                ? t('settings.confirmLeave', { workspace: workspace?.name })
                : t('settings.confirmRemove', { name: removing?.name, workspace: workspace?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => removing && remove.mutate(removing)}>
              {leaving ? t('settings.leave') : t('common.remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

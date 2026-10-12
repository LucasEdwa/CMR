import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { passwordSchema, securityEventSchema, sessionInfoSchema } from '@crm/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/Field'
import { ME_KEY, useMe } from '@/hooks/useMe'
import { api, send } from '@/lib/api'
import { authApi } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { TwoFactorSetup } from './TwoFactorSetup'

const SESSIONS_KEY = ['me', 'sessions'] as const
const EVENTS_KEY = ['me', 'security-events'] as const

// "Chrome on macOS" from a user agent, for the session list. Rough on purpose.
function device(ua: string | null) {
  if (!ua) return '–'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null
  return [browser, os].filter(Boolean).join(' · ') || ua.slice(0, 40)
}

export function AccountSecurity() {
  return (
    <div className="grid gap-10">
      <ChangePassword />
      <TwoFactor />
      <Sessions />
      <SecurityLog />
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

function ChangePassword() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const tooShort = next.length > 0 && !passwordSchema.safeParse(next).success
  const change = useMutation({
    mutationFn: () => authApi.changePassword(current, next),
    onSuccess: () => {
      toast.success(t('security.passwordChanged'))
      setCurrent('')
      setNext('')
      void queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })
  return (
    <Section id="change-password" title={t('security.passwordTitle')}>
      <form
        className="grid max-w-md gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          change.mutate()
        }}
      >
        <Field id="current-password" label={t('security.currentPassword')}>
          <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field id="new-password" label={t('security.newPassword')} hint={t('auth.passwordHint')} error={tooShort ? t('errors.PASSWORD_TOO_SHORT') : undefined}>
          <Input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <p className="text-muted-foreground text-sm">{t('security.passwordOthersOut')}</p>
        <Button type="submit" className="justify-self-start" disabled={!current || !next || tooShort || change.isPending}>
          {t('security.changePassword')}
        </Button>
      </form>
    </Section>
  )
}

function TwoFactor() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const [setting, setSetting] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [password, setPassword] = useState('')
  const disable = useMutation({
    mutationFn: () => authApi.disableTwoFactor(password),
    onSuccess: async () => {
      toast.success(t('security.disabled'))
      setDisabling(false)
      setPassword('')
      await queryClient.invalidateQueries({ queryKey: ME_KEY })
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })
  const on = me?.user.twoFactorEnabled
  return (
    <Section id="two-factor" title={t('security.twoFactorTitle')}>
      <p className="flex items-center gap-2 text-sm">
        {t('security.status')} <Badge variant={on ? 'default' : 'secondary'}>{on ? t('security.on') : t('security.off')}</Badge>
      </p>
      {!on && !setting && (
        <Button className="justify-self-start" onClick={() => setSetting(true)}>
          {t('security.turnOn')}
        </Button>
      )}
      {/* Stays open after the code is confirmed (when "on" flips), so the backup codes are shown. */}
      {setting && (
        <div className="max-w-md">
          <TwoFactorSetup onDone={() => setSetting(false)} />
        </div>
      )}
      {on && !setting && !disabling && (
        <Button variant="outline" className="justify-self-start" onClick={() => setDisabling(true)}>
          {t('security.turnOff')}
        </Button>
      )}
      {on && disabling && (
        <form
          className="grid max-w-md gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            disable.mutate()
          }}
        >
          <Field id="disable-password" label={t('security.currentPassword')}>
            <Input id="disable-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={() => setDisabling(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" type="submit" disabled={!password || disable.isPending}>
              {t('security.turnOff')}
            </Button>
          </div>
        </form>
      )}
    </Section>
  )
}

function Sessions() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: () => api('/me/sessions', z.array(sessionInfoSchema)) })
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }), queryClient.invalidateQueries({ queryKey: EVENTS_KEY })])
  const end = useMutation({ mutationFn: (id: string) => send('DELETE', `/me/sessions/${id}`), onSuccess: refresh })
  const endOthers = useMutation({
    mutationFn: () => send('POST', '/me/sessions/revoke-others'),
    onSuccess: async () => {
      toast.success(t('security.othersEnded'))
      await refresh()
    },
  })
  const others = sessions.data?.filter((s) => !s.current).length ?? 0
  return (
    <Section id="sessions" title={t('security.sessionsTitle')}>
      <ul className="divide-y rounded-md border" aria-labelledby="sessions">
        {sessions.data?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="grid">
              <span className="font-medium">
                {device(s.userAgent)} {s.current && <Badge variant="secondary">{t('security.thisDevice')}</Badge>}
              </span>
              <span className="text-muted-foreground text-xs">
                {[s.ipAddress, t('security.lastActive', { date: formatDateTime(s.updatedAt, i18n.language) })].filter(Boolean).join(' · ')}
              </span>
            </span>
            {!s.current && (
              <Button variant="ghost" size="sm" onClick={() => end.mutate(s.id)} disabled={end.isPending}>
                {t('security.endSession')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {others > 0 && (
        <Button variant="outline" className="justify-self-start" onClick={() => endOthers.mutate()} disabled={endOthers.isPending}>
          {t('security.endOthers')}
        </Button>
      )}
    </Section>
  )
}

function SecurityLog() {
  const { t, i18n } = useTranslation()
  const events = useQuery({ queryKey: EVENTS_KEY, queryFn: () => api('/me/security-events', z.array(securityEventSchema)) })
  return (
    <Section id="security-log" title={t('security.logTitle')}>
      <p className="text-muted-foreground text-sm">{t('security.logHint')}</p>
      <ol className="divide-y rounded-md border text-sm" aria-labelledby="security-log">
        {events.data?.map((e) => (
          <li key={e.id} className="flex flex-wrap justify-between gap-x-4 px-3 py-2">
            <span className={e.type === 'login_failed' ? 'text-destructive' : undefined}>{t(`security.events.${e.type}`)}</span>
            <span className="text-muted-foreground text-xs">
              {[formatDateTime(e.createdAt, i18n.language), device(e.userAgent), e.ipAddress].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
      </ol>
    </Section>
  )
}

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import qrcode from 'qrcode-generator'
import { Download } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/Field'
import { ME_KEY } from '@/hooks/useMe'
import { authApi } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'

// Turning on two-factor login: password, then scan the QR code (or type the key), then one code
// from the app to prove it works. The backup codes are shown once, at the end.
export function TwoFactorSetup({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null)
  const [code, setCode] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(t, err))
    } finally {
      setBusy(false)
    }
  }

  if (done && setup) {
    const download = () => {
      const blob = new Blob([`${t('security.backupFileTitle')}\n\n${setup.backupCodes.join('\n')}\n`], { type: 'text/plain' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'crm-reservkoder.txt'
      a.click()
      URL.revokeObjectURL(a.href)
    }
    return (
      <div className="grid gap-3">
        <Alert>
          <AlertDescription>{t('security.backupIntro')}</AlertDescription>
        </Alert>
        <ul className="grid grid-cols-2 gap-1 rounded-md border p-3 font-mono text-sm" aria-label={t('security.backupCodes')}>
          {setup.backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={download}>
            <Download className="size-4" aria-hidden />
            {t('security.downloadCodes')}
          </Button>
          <Button onClick={onDone}>{t('security.savedCodes')}</Button>
        </div>
      </div>
    )
  }

  if (setup) {
    const qr = qrcode(0, 'M')
    qr.addData(setup.totpURI)
    qr.make()
    const secret = new URL(setup.totpURI).searchParams.get('secret') ?? ''
    return (
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            await authApi.verifyTotp(code.replace(/\s/g, ''))
            await queryClient.invalidateQueries({ queryKey: ME_KEY })
            toast.success(t('security.enabled'))
            setDone(true)
          })
        }}
      >
        <p className="text-sm">{t('security.scan')}</p>
        <img src={qr.createDataURL(5, 2)} alt={t('security.qrAlt')} className="size-48 rounded-md border bg-white" />
        <p className="text-muted-foreground text-sm">
          {t('security.manualKey')} <code className="bg-muted rounded px-1 break-all">{secret}</code>
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field id="totp-setup-code" label={t('security.codeLabel')}>
          <Input id="totp-setup-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Button type="submit" className="justify-self-start" disabled={busy || code.replace(/\s/g, '').length < 6}>
          {t('security.confirm')}
        </Button>
      </form>
    )
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void run(async () => setSetup(await authApi.enableTwoFactor(password)))
      }}
    >
      <p className="text-muted-foreground text-sm">{t('security.intro')}</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Field id="totp-password" label={t('security.currentPassword')}>
        <Input id="totp-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" className="justify-self-start" disabled={busy || !password}>
        {t('security.start')}
      </Button>
    </form>
  )
}

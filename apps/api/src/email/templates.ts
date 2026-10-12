import type { Locale, Role } from '@crm/shared'

export type EmailMessage = { to: string; subject: string; text: string; html: string }

type Template<P> = Record<Locale, (p: P) => { subject: string; lines: string[]; button: string; footer: string }>

const roleNames: Record<Locale, Record<Role, string>> = {
  sv: { owner: 'ägare', admin: 'administratör', member: 'medlem', viewer: 'läsare' },
  en: { owner: 'owner', admin: 'admin', member: 'member', viewer: 'viewer' },
}

const verifyEmail: Template<{ name: string }> = {
  sv: ({ name }) => ({
    subject: 'Bekräfta din e-postadress',
    lines: [`Hej ${name}!`, 'Klicka på knappen för att bekräfta din e-postadress och komma igång.'],
    button: 'Bekräfta e-postadress',
    footer: 'Länken gäller i 24 timmar. Om du inte skapade ett konto kan du ignorera det här mejlet.',
  }),
  en: ({ name }) => ({
    subject: 'Confirm your email address',
    lines: [`Hi ${name},`, 'Click the button to confirm your email address and get started.'],
    button: 'Confirm email address',
    footer: "The link is valid for 24 hours. If you didn't create an account, you can ignore this email.",
  }),
}

const resetPassword: Template<{ name: string }> = {
  sv: ({ name }) => ({
    subject: 'Återställ ditt lösenord',
    lines: [`Hej ${name}!`, 'Vi fick en begäran om att återställa ditt lösenord.'],
    button: 'Välj nytt lösenord',
    footer: 'Länken gäller i 1 timme. Om du inte bad om detta kan du ignorera det här mejlet.',
  }),
  en: ({ name }) => ({
    subject: 'Reset your password',
    lines: [`Hi ${name},`, 'We received a request to reset your password.'],
    button: 'Choose a new password',
    footer: "The link is valid for 1 hour. If you didn't ask for this, you can ignore this email.",
  }),
}

const invitation: Template<{ inviter: string; workspace: string; role: Role }> = {
  sv: ({ inviter, workspace, role }) => ({
    subject: `${inviter} bjuder in dig till ${workspace}`,
    lines: [`${inviter} har bjudit in dig att gå med i ${workspace} som ${roleNames.sv[role]}.`],
    button: 'Gå med',
    footer: 'Inbjudan gäller i 7 dagar och kan bara användas en gång.',
  }),
  en: ({ inviter, workspace, role }) => ({
    subject: `${inviter} invited you to ${workspace}`,
    lines: [`${inviter} invited you to join ${workspace} as ${roleNames.en[role]}.`],
    button: 'Join',
    footer: 'The invitation is valid for 7 days and can only be used once.',
  }),
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function render<P>(template: Template<P>, locale: Locale, params: P, to: string, url: string): EmailMessage {
  const { subject, lines, button, footer } = template[locale](params)
  const text = [...lines, '', `${button}: ${url}`, '', footer].join('\n')
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
${lines.map((l) => `<p>${escape(l)}</p>`).join('\n')}
<p><a href="${escape(url)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${escape(button)}</a></p>
<p style="color:#666;font-size:13px">${escape(footer)}</p>
</body></html>`
  return { to, subject, text, html }
}

export const emails = {
  verifyEmail: (to: string, locale: Locale, p: { name: string; url: string }) => render(verifyEmail, locale, p, to, p.url),
  resetPassword: (to: string, locale: Locale, p: { name: string; url: string }) =>
    render(resetPassword, locale, p, to, p.url),
  invitation: (to: string, locale: Locale, p: { inviter: string; workspace: string; role: Role; url: string }) =>
    render(invitation, locale, p, to, p.url),
}

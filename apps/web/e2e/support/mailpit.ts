import { expect } from '@playwright/test'

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'

type Summary = { ID: string; Created: string }

// Waits for the newest email to `to` and returns the first link in it that starts with `pathPrefix`.
export async function linkFromEmail(to: string, pathPrefix: string): Promise<string> {
  let link = ''
  await expect
    .poll(
      async () => {
        const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
        const { messages } = (await search.json()) as { messages: Summary[] }
        if (!messages?.length) return ''
        const newest = messages.sort((a, b) => b.Created.localeCompare(a.Created))[0]!
        const message = (await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json()) as { Text: string }
        const match = message.Text.match(new RegExp(`https?://[^\\s]+${pathPrefix.replace(/[/?]/g, '\\$&')}[^\\s]*`))
        link = match?.[0] ?? ''
        return link
      },
      { timeout: 15_000, message: `email with ${pathPrefix} to ${to}` },
    )
    .not.toBe('')
  // Links point at WEB_ORIGIN; keep only the path so tests follow them on baseURL.
  const url = new URL(link)
  return url.pathname + url.search
}

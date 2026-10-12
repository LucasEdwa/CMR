import nodemailer from 'nodemailer'
import type { PgBoss } from 'pg-boss'
import { env } from '../env.js'
import { QUEUES } from '../jobs/queues.js'
import type { EmailMessage } from './templates.js'

// Tests read sent mail from here (EMAIL_DELIVERY=memory).
export const outbox: EmailMessage[] = []

const transport = nodemailer.createTransport(env.SMTP_URL)

let boss: PgBoss | null = null
export function useEmailQueue(instance: PgBoss) {
  boss = instance
}

export async function deliver(message: EmailMessage) {
  await transport.sendMail({ from: env.EMAIL_FROM, ...message })
}

// Never log the message body: links in it are credentials.
export async function sendEmail(message: EmailMessage) {
  if (env.EMAIL_DELIVERY === 'memory') {
    outbox.push(message)
    return
  }
  if (env.EMAIL_DELIVERY === 'queue' && boss) {
    await boss.send(QUEUES.email, message, {
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      // The job holds the whole email, including login, reset and invitation links. Remove it soon
      // after sending (and drop it after a day if it never goes out), so the database never keeps
      // usable links around: invitation tokens are otherwise stored only as hashes.
      deleteAfterSeconds: 60,
      retentionSeconds: 24 * 60 * 60,
    })
    return
  }
  await deliver(message)
}

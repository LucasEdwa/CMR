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
    await boss.send(QUEUES.email, message, { retryLimit: 5, retryDelay: 30, retryBackoff: true })
    return
  }
  await deliver(message)
}

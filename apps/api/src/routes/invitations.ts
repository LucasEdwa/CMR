import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { fromNodeHeaders } from 'better-auth/node'
import {
  acceptInvitationSchema,
  inviteSchema,
  localeSchema,
  type Invitation,
  type InvitationPreview,
} from '@crm/shared'
import { z } from 'zod'
import { auth } from '../auth/auth.js'
import { MANAGERS, inWorkspace, requireTenant } from '../auth/context.js'
import { audit } from '../db/audit.js'
import { db, type Tx } from '../db/client.js'
import { invitations, memberships, sessions, tenants, users } from '../db/schema.js'
import { withTenant, withTenantOnly, type TenantContext } from '../db/tenant.js'
import { emails } from '../email/templates.js'
import { sendEmail } from '../email/send.js'
import { env } from '../env.js'
import { HttpError } from '../errors.js'
import { setActiveWorkspace } from './workspaces.js'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// The link token is "<tenantId>.<secret>". The tenant id lets us set RLS context without a
// privileged lookup; only sha256(secret) is stored, so a database leak exposes no usable links.
const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex')

function parseToken(token: string) {
  const [tenantId, secret] = token.split('.')
  if (!tenantId || !secret || !z.uuid().safeParse(tenantId).success) {
    throw new HttpError(404, 'invitation_invalid', 'This invitation link is not valid')
  }
  return { tenantId, tokenHash: hashSecret(secret) }
}

async function loadInvitation(tx: Tx, tokenHash: string) {
  const [row] = await tx
    .select({ invitation: invitations, workspaceName: tenants.name, inviterName: users.name })
    .from(invitations)
    .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
    .leftJoin(users, eq(users.id, invitations.invitedByUserId))
    .where(eq(invitations.tokenHash, tokenHash))
  if (!row) throw new HttpError(404, 'invitation_invalid', 'This invitation link is not valid')
  const { invitation } = row
  if (invitation.acceptedAt) throw new HttpError(410, 'invitation_used', 'This invitation has already been used')
  if (invitation.revokedAt) throw new HttpError(410, 'invitation_revoked', 'This invitation has been withdrawn')
  if (invitation.expiresAt < new Date()) throw new HttpError(410, 'invitation_expired', 'This invitation has expired')
  return row
}

const findUserByEmail = async (email: string) =>
  (await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`))[0]

export async function invitationRoutes(app: FastifyInstance) {
  app.get('/workspace/invitations', { preHandler: inWorkspace(MANAGERS) }, async (request): Promise<Invitation[]> => {
    const ctx = requireTenant(request, MANAGERS)
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select({
          id: invitations.id,
          email: invitations.email,
          role: invitations.role,
          expiresAt: invitations.expiresAt,
          invitedBy: users.name,
        })
        .from(invitations)
        .leftJoin(users, eq(users.id, invitations.invitedByUserId))
        .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
        .orderBy(invitations.createdAt),
    )
    return rows.map((r) => ({ ...r, expiresAt: r.expiresAt.toISOString() }))
  })

  app.post(
    '/workspace/invitations',
    {
      preHandler: inWorkspace(MANAGERS),
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 hour',
          keyGenerator: (request: FastifyRequest) => `invite:${request.tenant?.tenantId ?? request.ip}`,
        },
      },
    },
    async (request, reply) => {
      const ctx = requireTenant(request, MANAGERS)
      const input = inviteSchema.parse(request.body)
      if (input.role === 'owner' && ctx.role !== 'owner') {
        throw new HttpError(403, 'forbidden', 'Only owners can invite owners')
      }
      const secret = randomBytes(32).toString('base64url')
      const existingUser = await findUserByEmail(input.email)

      const { id, workspaceName } = await withTenant(ctx, async (tx) => {
        if (existingUser) {
          const [member] = await tx.select().from(memberships).where(eq(memberships.userId, existingUser.id))
          if (member) throw new HttpError(409, 'already_member', 'This person is already a member')
        }
        // A new invitation replaces any pending one for the same email.
        await tx
          .update(invitations)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              sql`lower(${invitations.email}) = ${input.email}`,
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
            ),
          )
        const [invitation] = await tx
          .insert(invitations)
          .values({
            tenantId: ctx.tenantId,
            email: input.email,
            role: input.role,
            tokenHash: hashSecret(secret),
            invitedByUserId: ctx.userId,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          })
          .returning()
        await audit(tx, ctx, {
          action: 'invite',
          entityType: 'invitation',
          entityId: invitation!.id,
          after: { email: input.email, role: input.role },
        })
        const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, ctx.tenantId))
        return { id: invitation!.id, workspaceName: tenant!.name }
      })

      const inviter = request.authSession!.user
      const url = `${env.WEB_ORIGIN}/invite/${ctx.tenantId}.${secret}`
      await sendEmail(
        emails.invitation(input.email, localeSchema.catch('sv').parse(inviter.locale), {
          inviter: inviter.name,
          workspace: workspaceName,
          role: input.role,
          url,
        }),
      )
      return reply.status(201).send({ id })
    },
  )

  app.delete('/workspace/invitations/:id', { preHandler: inWorkspace(MANAGERS) }, async (request) => {
    const ctx = requireTenant(request, MANAGERS)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    await withTenant(ctx, async (tx) => {
      const [revoked] = await tx
        .update(invitations)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .returning()
      if (!revoked) throw new HttpError(404, 'not_found', 'Invitation not found')
      await audit(tx, ctx, { action: 'revoke', entityType: 'invitation', entityId: id })
    })
    return { ok: true }
  })

  // Public: what the invite page shows before accepting.
  app.get('/invitations/:token', async (request): Promise<InvitationPreview> => {
    const { token } = z.object({ token: z.string() }).parse(request.params)
    const { tenantId, tokenHash } = parseToken(token)
    const row = await withTenantOnly(tenantId, (tx) => loadInvitation(tx, tokenHash))
    return {
      workspaceName: row.workspaceName,
      email: row.invitation.email,
      role: row.invitation.role,
      invitedBy: row.inviterName,
      accountExists: Boolean(await findUserByEmail(row.invitation.email)),
    }
  })

  app.post('/invitations/:token/accept', async (request, reply) => {
    const { token } = z.object({ token: z.string() }).parse(request.params)
    const input = acceptInvitationSchema.parse(request.body ?? {})
    const { tenantId, tokenHash } = parseToken(token)
    const { invitation } = await withTenantOnly(tenantId, (tx) => loadInvitation(tx, tokenHash))

    const session = request.authSession
    let userId: string
    let sessionId: string | undefined = session?.session.id

    if (session) {
      if (session.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
        throw new HttpError(403, 'email_mismatch', `This invitation is for ${invitation.email}`)
      }
      userId = session.user.id
    } else {
      if (await findUserByEmail(invitation.email)) {
        throw new HttpError(401, 'login_required', 'Log in to accept this invitation')
      }
      if (!input.name || !input.password) {
        throw new HttpError(400, 'validation_error', 'Name and password are required')
      }
      // Opening the emailed link proves the address, so the new account starts verified.
      const ctx = await auth.$context
      const user = await ctx.internalAdapter.createUser({
        email: invitation.email,
        name: input.name,
        emailVerified: true,
        locale: input.locale ?? 'sv',
      }, { method: 'email-password' })
      await ctx.internalAdapter.linkAccount({
        userId: user.id,
        providerId: 'credential',
        accountId: user.id,
        password: await ctx.password.hash(input.password),
      })
      const signIn = await auth.api.signInEmail({
        body: { email: invitation.email, password: input.password },
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      })
      reply.header('set-cookie', signIn.headers.getSetCookie())
      userId = user.id
      const [created] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.token, signIn.response.token))
      sessionId = created?.id
    }

    // The token was checked above, so the membership is created with the 'system' role.
    const ctx: TenantContext = { tenantId, userId, role: 'system' }
    await withTenant(ctx, async (tx) => {
      // Atomic single use: a second accept (or a race) finds nothing to update.
      const [accepted] = await tx
        .update(invitations)
        .set({ acceptedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(invitations.id, invitation.id),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, new Date()),
          ),
        )
        .returning()
      if (!accepted) throw new HttpError(410, 'invitation_used', 'This invitation has already been used')
      await tx
        .insert(memberships)
        .values({ tenantId, userId, role: invitation.role })
        .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] })
      await audit(tx, ctx, { action: 'accept', entityType: 'invitation', entityId: invitation.id })
    })
    if (sessionId) await setActiveWorkspace(sessionId, tenantId)
    return { workspaceId: tenantId }
  })
}

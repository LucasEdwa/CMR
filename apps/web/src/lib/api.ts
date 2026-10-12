import { apiErrorSchema } from '@crm/shared'
import type { z } from 'zod'

export class ApiRequestError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

// Our API answers { error: { code, message } }; Better Auth (/api/auth) answers { code, message }.
function toError(status: number, body: unknown): ApiRequestError {
  const ours = apiErrorSchema.safeParse(body)
  if (ours.success) {
    const { code, message, details } = ours.data.error
    return new ApiRequestError(status, code, message, details)
  }
  if (status === 429) return new ApiRequestError(status, 'rate_limited', 'Too many requests')
  const b = body as { code?: unknown; message?: unknown } | null
  if (b && typeof b.code === 'string') return new ApiRequestError(status, b.code, String(b.message ?? b.code))
  return new ApiRequestError(status, 'http_error', `Request failed (${status})`)
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'include',
      ...init,
      headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    })
  } catch {
    throw new ApiRequestError(0, 'network', 'Network error')
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) throw toError(res.status, body)
  return body
}

export async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  return schema.parse(await request(path, init))
}

export function send(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
  return request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
}

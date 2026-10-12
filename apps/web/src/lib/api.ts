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

export async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(body)
    if (parsed.success) {
      const { code, message, details } = parsed.data.error
      throw new ApiRequestError(res.status, code, message, details)
    }
    throw new ApiRequestError(res.status, 'http_error', res.statusText)
  }
  return schema.parse(body)
}

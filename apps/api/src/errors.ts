import type { FastifyError, FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import type { ApiError } from '@crm/shared'
import { isRlsViolation } from './db/errors.js'

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

const body = (code: string, message: string, details?: unknown): ApiError => ({
  error: { code, message, ...(details === undefined ? {} : { details }) },
})

export function registerErrorHandlers(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(body('not_found', `Route ${request.method} ${request.url} not found`))
  })

  app.setErrorHandler((err: FastifyError | Error, request, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send(body(err.code, err.message, err.details))
    }
    // RLS said no (role or "own records only"): the same answer as the API's own role checks.
    if (isRlsViolation(err)) {
      return reply.status(403).send(body('forbidden', 'You do not have access to this'))
    }
    if (err instanceof ZodError) {
      return reply.status(400).send(body('validation_error', 'Invalid request', err.issues))
    }
    const statusCode = 'statusCode' in err && err.statusCode ? err.statusCode : 500
    if (statusCode < 500) {
      return reply.status(statusCode).send(body('bad_request', err.message))
    }
    request.log.error(err)
    return reply.status(500).send(body('internal_error', 'Something went wrong'))
  })
}

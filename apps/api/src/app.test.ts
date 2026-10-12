import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { apiErrorSchema, healthSchema } from '@crm/shared'
import { buildApp } from './app.js'

let app: FastifyInstance
beforeAll(async () => {
  app = await buildApp()
})
afterAll(() => app.close())

describe('API', () => {
  it('GET /api/health reports the database as ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(healthSchema.parse(res.json())).toMatchObject({ status: 'ok', db: 'ok', env: 'test' })
  })

  it('GET / points to the health check and the web app', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ health: '/api/health' })
  })

  it('unknown routes return the standard error shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('not_found')
  })

  it('unhandled errors return 500 without leaking details', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/debug/error' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: 'internal_error', message: 'Something went wrong' } })
  })

  it('sends security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })
})

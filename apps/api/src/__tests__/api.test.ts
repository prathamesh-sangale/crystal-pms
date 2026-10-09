/**
 * What's left of the v1-era API suite, trimmed down to the one thing still
 * real: the auth seam. Everything else this file used to test (the pipeline
 * routes, stage advancement, permissions) was deleted along with v1 itself —
 * v2's own routes (workers/containers/drafts/ims-lookup/external) are
 * verified live against the real Supabase project as they're built, per this
 * project's established practice, rather than through this suite.
 *
 * Runs against the real, live Supabase `users` table — `npm run seed-users`
 * (in apps/api) must have been run at least once for these accounts to
 * exist.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('health and auth', () => {
  it('answers a health check without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('signs in a seeded account and returns a usable token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'sitaram@reeferready.example', password: 'readiness' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ email: 'sitaram@reeferready.example', role: 'manager' });
    expect(typeof body.token).toBe('string');

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('sitaram@reeferready.example');
  });

  it('refuses a bad password without saying whether the account exists', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'sitaram@reeferready.example', password: 'nope' },
    });
    const noSuchUser = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@reeferready.example', password: 'nope' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchUser.statusCode).toBe(401);
    expect(wrongPassword.json().message).toBe(noSuchUser.json().message);
  });

  it('rejects a malformed email with a field-level message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'not-an-email', password: 'readiness' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().fields.email).toBeTruthy();
  });

  it('turns away anonymous requests to a protected v2 route', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v2/workers' });
    expect(res.statusCode).toBe(401);
  });
});

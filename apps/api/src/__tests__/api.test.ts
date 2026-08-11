import { toISODate } from '@pms/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

let app: FastifyInstance;
const TODAY = toISODate(new Date());

/** Signs in and returns the Authorization header value. */
async function signIn(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'readiness' },
  });
  expect(res.statusCode, `login failed for ${email}: ${res.body}`).toBe(200);
  return `Bearer ${res.json().token}`;
}

const auth = { manager: '', technician: '', viewer: '' };

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  auth.manager = await signIn('sitaram@reeferready.example');
  auth.technician = await signIn('tech@reeferready.example');
  auth.viewer = await signIn('viewer@reeferready.example');
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('health and auth', () => {
  it('answers a health check without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
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

  it('turns away anonymous requests to the pipeline', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/containers' });
    expect(res.statusCode).toBe(401);
  });
});

describe('the seeded board', () => {
  it('has ten containers, three delayed and one ready', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/overview',
      headers: { authorization: auth.manager, 'x-today': TODAY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.containers).toHaveLength(10);
    expect(body.totals.late).toBe(3);
    expect(body.totals.ready).toBe(1);
    expect(body.homeDepot).toBe('JNPT Depot (Home)');
  });

  it('matches three orders and leaves two unmatched, one of them sourceable', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/overview',
      headers: { authorization: auth.manager, 'x-today': TODAY },
    });
    const { matches } = res.json();
    const unmatched = matches.filter((m: { containerId: string | null }) => !m.containerId);
    expect(matches).toHaveLength(5);
    expect(unmatched).toHaveLength(2);
    // ORD-503 wants 20ft standard units; the home depot has none but the
    // network does, so it must offer a transfer rather than say "impossible".
    const transferable = unmatched.find((m: { order: { id: string } }) => m.order.id === 'ORD-503');
    expect(transferable.elsewhereCount).toBeGreaterThan(0);
    expect(transferable.status.detail).toContain('transfer');
  });

  it('gives every status a tone, an icon and a word', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/overview',
      headers: { authorization: auth.manager, 'x-today': TODAY },
    });
    for (const m of res.json().matches) {
      expect(m.status.tone).toBeTruthy();
      expect(m.status.icon).toBeTruthy();
      expect(m.status.label).toBeTruthy();
    }
  });

  it('filters the fleet by search text and by derived status', async () => {
    const search = await app.inject({
      method: 'GET',
      url: '/api/containers?q=maersk',
      headers: { authorization: auth.viewer, 'x-today': TODAY },
    });
    expect(search.json().containers).toHaveLength(1);

    const late = await app.inject({
      method: 'GET',
      url: '/api/containers?status=late',
      headers: { authorization: auth.viewer, 'x-today': TODAY },
    });
    expect(late.json().containers).toHaveLength(3);
  });
});

describe('registering a container', () => {
  it('snapshots the right checklist for a double compressor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/containers',
      headers: { authorization: auth.manager, 'x-today': TODAY },
      payload: {
        id: 'TEST 100 000-1',
        size: '40ft HC Reefer',
        type: 'double',
        customer: 'Test Line',
        assignee: 'S. Menon',
        depot: 'JNPT Depot (Home)',
        priority: 'High',
      },
    });
    expect(res.statusCode).toBe(201);
    const { container } = res.json();
    expect(container.stage).toBe('gatein');
    const mech = container.checklist.filter((t: { stage: string }) => t.stage === 'mechanical');
    expect(mech).toHaveLength(10);
    // and none of the anteroom-only work
    expect(container.checklist.some((t: { label: string }) => t.label.includes('Mantrap'))).toBe(false);
  });

  it('refuses a duplicate unit number', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/containers',
      headers: { authorization: auth.manager },
      payload: {
        id: 'TEST 100 000-1',
        size: '40ft HC Reefer',
        type: 'standard',
        customer: 'Test Line',
        assignee: 'S. Menon',
        depot: 'JNPT Depot (Home)',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().fields.id).toBeTruthy();
  });

  it('requires the anteroom configuration, because the checklist depends on it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/containers',
      headers: { authorization: auth.manager },
      payload: {
        id: 'TEST 200 000-2',
        size: '40ft HC Reefer',
        type: 'anteroom',
        customer: 'Test Line',
        assignee: 'S. Menon',
        depot: 'JNPT Depot (Home)',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().fields.anteroomVariant).toContain('mantrap');
  });

  it('rejects a depot that is not in the network', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/containers',
      headers: { authorization: auth.manager },
      payload: {
        id: 'TEST 300 000-3',
        size: '20ft Reefer',
        type: 'standard',
        customer: 'Test Line',
        assignee: 'S. Menon',
        depot: 'Atlantis Depot',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().fields.depot).toBeTruthy();
  });
});

describe('working a container', () => {
  const id = encodeURIComponent('TEST 100 000-1');

  it('lets a technician tick a task and records who did it', async () => {
    const container = await app.inject({
      method: 'GET',
      url: `/api/containers/${id}`,
      headers: { authorization: auth.technician },
    });
    const firstTask = container.json().container.checklist[0];

    const res = await app.inject({
      method: 'POST',
      url: `/api/containers/${id}/tasks`,
      headers: { authorization: auth.technician },
      payload: { key: firstTask.key, done: true },
    });
    expect(res.statusCode).toBe(200);
    const ticked = res.json().container.checklist.find((t: { key: string }) => t.key === firstTask.key);
    expect(ticked.done).toBe(true);
    expect(ticked.doneBy).toBe('R. Fernandes');
  });

  it('will not advance a stage with open tasks unless told to', async () => {
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/containers/${id}/advance`,
      headers: { authorization: auth.manager },
      payload: {},
    });
    expect(blocked.statusCode).toBe(409);
    const body = blocked.json();
    // The UI needs the consequence in order to name it on the button.
    expect(body.openTasks.length).toBeGreaterThan(0);
    expect(body.nextStage).toBe('Structural & IICL Repair');

    const forced = await app.inject({
      method: 'POST',
      url: `/api/containers/${id}/advance`,
      headers: { authorization: auth.manager, 'x-today': TODAY },
      payload: { force: true },
    });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().container.stage).toBe('structural');
  });

  it('resets the stage clock on advance, so a fresh stage is never late', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/containers/${id}`,
      headers: { authorization: auth.manager, 'x-today': TODAY },
    });
    expect(res.json().container.stageEntered).toBe(TODAY);
  });

  it('writes an audit line for every change', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/containers/${id}`,
      headers: { authorization: auth.manager },
    });
    const kinds = res.json().events.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain('registered');
    expect(kinds).toContain('task-done');
    expect(kinds).toContain('stage-advanced');
  });

  it('reports the named backup for the assigned technician', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/containers/${id}`,
      headers: { authorization: auth.manager },
    });
    expect(res.json().backup).toBe('J. Alvares');
  });
});

describe('permissions', () => {
  const id = encodeURIComponent('TEST 100 000-1');

  it('stops a viewer changing anything', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/containers/${id}/tasks`,
      headers: { authorization: auth.viewer },
      payload: { key: 'gatein.00', done: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('stops a technician removing a container', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/containers/${id}`,
      headers: { authorization: auth.technician },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('depot manager');
  });

  it('lets a manager remove one, and takes its tasks and events with it', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/containers/${id}`,
      headers: { authorization: auth.manager },
    });
    expect(res.statusCode).toBe(204);

    const gone = await app.inject({
      method: 'GET',
      url: `/api/containers/${id}`,
      headers: { authorization: auth.manager },
    });
    expect(gone.statusCode).toBe(404);
    expect(await prisma.containerTask.count({ where: { containerId: 'TEST 100 000-1' } })).toBe(0);
    expect(await prisma.containerEvent.count({ where: { containerId: 'TEST 100 000-1' } })).toBe(0);
  });
});

describe('lateness is computed against the requested day', () => {
  it('reports nothing delayed if you ask about the past', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers?status=late',
      headers: { authorization: auth.viewer, 'x-today': '2020-01-01' },
    });
    expect(res.json().containers).toHaveLength(0);
  });
});

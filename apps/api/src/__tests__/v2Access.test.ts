/**
 * Covers the three systems the 2026-10-17 code review flagged as having zero
 * test coverage: the container-PATCH field-dependent permission branch, the
 * worker-deletion guards (completed-history loss, orphaned logins), and
 * users/access CRUD. Runs against the real, live Supabase project, same as
 * api.test.ts — every row this file creates is prefixed `test-access-` and
 * torn down directly via the Supabase client in `afterAll`, not through the
 * app's own routes, so a deletion guard under test can never block its own
 * test's cleanup.
 *
 * Deliberately NOT covered here: the power-status toggle's actual pause/
 * resume mutation. `POST /api/v2/power-status` touches a single real,
 * shared `yard_power_status` row and every real open task's TnT clock —
 * there's no disposable/test-only slice of that to exercise safely, so only
 * the new screen-permission gate (a 403 that never reaches the mutation) is
 * tested below, never a real toggle.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { supabase } from '../supabase.js';

let app: FastifyInstance;
let adminToken: string;

const RUN_ID = Date.now().toString(36);
const testId = (label: string): string => `test-access-${label}-${RUN_ID}`;

const createdUserIds: string[] = [];
const createdWorkerIds: string[] = [];
const createdContainerIds: string[] = [];

async function signIn(email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

async function createWorker(name: string): Promise<string> {
  const id = testId(name);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v2/workers',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { id, name: id, type: 'technician', active: true, notes: '' },
  });
  expect(res.statusCode, res.body).toBe(201);
  createdWorkerIds.push(id);
  return id;
}

async function createLoginFor(workerId: string, allowedScreens: string[]): Promise<{ id: string; token: string }> {
  const id = `u-${workerId}`;
  const email = `${workerId}@test.crystalpms.invalid`;
  const password = 'test-password-123';
  const res = await app.inject({
    method: 'POST',
    url: '/api/v2/users',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { id, email, password, name: workerId, role: 'technician', workerId, allowedScreens },
  });
  expect(res.statusCode, res.body).toBe(201);
  createdUserIds.push(id);
  const token = await signIn(email, password);
  return { id, token };
}

function minimalContainerPayload(id: string): Record<string, unknown> {
  return {
    id,
    typeCode: '20GP',
    size: '20',
    color: 'White',
    priority: false,
    registeredAt: new Date().toISOString(),
    currentSite: null,
    readyAt: null,
    departedAt: null,
    survey: null,
    gateIn: null,
    gateOut: null,
    sections: [],
  };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  adminToken = await signIn('admin@crystalpms.com', 'admin123');
});

afterAll(async () => {
  // Direct Supabase cleanup, not the app's own routes -- the guards this
  // file tests (worker deletion blocked by a login/completed task) would
  // otherwise block their own test fixtures from being torn down.
  if (createdUserIds.length > 0) await supabase().from('users').delete().in('id', createdUserIds);
  if (createdContainerIds.length > 0) await supabase().from('containers').delete().in('id', createdContainerIds);
  if (createdWorkerIds.length > 0) await supabase().from('workers').delete().in('id', createdWorkerIds);
  await app.close();
});

describe('container PATCH field-dependent permission', () => {
  it('requires yard for a yard-only field but not for a shared field', async () => {
    const containerId = testId('container-patch');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v2/containers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: minimalContainerPayload(containerId),
    });
    expect(create.statusCode, create.body).toBe(201);
    createdContainerIds.push(containerId);

    const liveWorker = await createWorker('live-only');
    const { token: liveToken } = await createLoginFor(liveWorker, ['live']);
    const yardWorker = await createWorker('yard-only');
    const { token: yardToken } = await createLoginFor(yardWorker, ['yard']);

    const liveEditsYardOnlyField = await app.inject({
      method: 'PATCH',
      url: `/api/v2/containers/${containerId}`,
      headers: { authorization: `Bearer ${liveToken}` },
      payload: { color: 'Red' },
    });
    expect(liveEditsYardOnlyField.statusCode).toBe(403);

    const yardEditsYardOnlyField = await app.inject({
      method: 'PATCH',
      url: `/api/v2/containers/${containerId}`,
      headers: { authorization: `Bearer ${yardToken}` },
      payload: { color: 'Red' },
    });
    expect(yardEditsYardOnlyField.statusCode, yardEditsYardOnlyField.body).toBe(200);

    const liveEditsSharedField = await app.inject({
      method: 'PATCH',
      url: `/api/v2/containers/${containerId}`,
      headers: { authorization: `Bearer ${liveToken}` },
      payload: { priority: true },
    });
    expect(liveEditsSharedField.statusCode, liveEditsSharedField.body).toBe(200);
  });

  it('rejects marking a container ready with no photo on record, accepts one with a photo', async () => {
    const containerId = testId('ready-photo');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v2/containers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: minimalContainerPayload(containerId),
    });
    expect(create.statusCode, create.body).toBe(201);
    createdContainerIds.push(containerId);

    const noPhoto = await app.inject({
      method: 'PATCH',
      url: `/api/v2/containers/${containerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { readyAt: new Date().toISOString() },
    });
    expect(noPhoto.statusCode, noPhoto.body).toBe(422);

    const withPhoto = await app.inject({
      method: 'PATCH',
      url: `/api/v2/containers/${containerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { readyAt: new Date().toISOString(), readyPhotoUrls: ['https://drive.example/photo.jpg'] },
    });
    expect(withPhoto.statusCode, withPhoto.body).toBe(200);
  });
});

describe('worker deletion guards', () => {
  it('blocks deleting a worker with a completed task on record', async () => {
    const workerId = await createWorker('done-history');
    const containerId = testId('done-history-container');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v2/containers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        ...minimalContainerPayload(containerId),
        sections: [
          {
            kind: 'cleaning',
            tasks: [
              {
                key: 'wash',
                label: 'Wash',
                workerId,
                state: 'done',
                startedAt: null,
                elapsedSec: 600,
                optional: false,
                estHrs: 1,
                site: null,
              },
            ],
          },
        ],
      },
    });
    expect(create.statusCode, create.body).toBe(201);
    createdContainerIds.push(containerId);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v2/workers/${workerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(del.statusCode, del.body).toBe(409);
  });

  it('blocks deleting a worker who has a login, and allows it once the login is gone', async () => {
    const workerId = await createWorker('has-login');
    const { id: userId } = await createLoginFor(workerId, []);

    const blocked = await app.inject({
      method: 'DELETE',
      url: `/api/v2/workers/${workerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(blocked.statusCode, blocked.body).toBe(409);

    const removeLogin = await app.inject({
      method: 'DELETE',
      url: `/api/v2/users/${userId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(removeLogin.statusCode).toBe(204);
    createdUserIds.splice(createdUserIds.indexOf(userId), 1);

    const nowAllowed = await app.inject({
      method: 'DELETE',
      url: `/api/v2/workers/${workerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(nowAllowed.statusCode, nowAllowed.body).toBe(204);
    createdWorkerIds.splice(createdWorkerIds.indexOf(workerId), 1);
  });

  it('allows deleting a worker with no login and no running/completed task', async () => {
    const workerId = await createWorker('clean');
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v2/workers/${workerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(del.statusCode, del.body).toBe(204);
    createdWorkerIds.splice(createdWorkerIds.indexOf(workerId), 1);
  });
});

describe('users/access CRUD', () => {
  it('is manager-only, end to end', async () => {
    const workerId = await createWorker('non-manager-probe');
    const { token: noScreenToken } = await createLoginFor(workerId, []);

    const list = await app.inject({ method: 'GET', url: '/api/v2/users', headers: { authorization: `Bearer ${noScreenToken}` } });
    expect(list.statusCode).toBe(403);

    const create = await app.inject({
      method: 'POST',
      url: '/api/v2/users',
      headers: { authorization: `Bearer ${noScreenToken}` },
      payload: { id: testId('should-not-exist'), email: 'nope@test.crystalpms.invalid', password: 'whatever123', name: 'x', workerId, allowedScreens: [] },
    });
    expect(create.statusCode).toBe(403);
  });

  it('refuses a second login for the same worker, and a password under 8 characters', async () => {
    const workerId = await createWorker('one-login-only');
    await createLoginFor(workerId, []);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v2/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { id: testId('second-login'), email: `${workerId}-second@test.crystalpms.invalid`, password: 'test-password-123', name: 'x', workerId, allowedScreens: [] },
    });
    expect(second.statusCode).toBe(409);

    const shortPassword = await app.inject({
      method: 'POST',
      url: '/api/v2/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { id: testId('short-password'), email: `${testId('short-password')}@test.crystalpms.invalid`, password: 'short1', name: 'x', workerId: null, allowedScreens: [] },
    });
    expect(shortPassword.statusCode).toBe(422);
  });
});

describe('power-status screen gate', () => {
  it('refuses to flip the yard-wide switch without dashboards access, before anything is mutated', async () => {
    const workerId = await createWorker('no-dashboards');
    const { token } = await createLoginFor(workerId, ['live']);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/power-status',
      headers: { authorization: `Bearer ${token}` },
      payload: { isDown: true },
    });
    expect(res.statusCode).toBe(403);
  });
});

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/* ------------------------------------------------------------------------- */
/* Passwords — scrypt from node:crypto, so there is no native module to build  */
/* ------------------------------------------------------------------------- */

const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length !== KEY_LEN) return false;
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), KEY_LEN);
  return timingSafeEqual(actual, expected);
}

/* ------------------------------------------------------------------------- */
/* Roles                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Carried over from v1's four-role model — v2 only has one real account
 * (Admin, displayed from `manager`; see `roleDisplayLabel` in auth.tsx) but
 * nothing has migrated the seeded accounts or dropped the other three roles,
 * so the type stays wide rather than silently narrowing what a JWT can
 * claim. v1's per-action permission table (`PERMISSIONS`/`can`/
 * `requirePermission`) was removed along with the rest of v1 — no v2 route
 * has ever used it.
 */
export const ROLES = ['manager', 'supervisor', 'technician', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** The six screens access management can grant/withhold, by direct request
 * — matches `nav.ts`'s own six real nav items one-to-one. Live Board and
 * Yard Board are two views over the same backend data (containers/tasks),
 * so there's no route-level way to tell them apart; `requireScreen` below
 * treats either one as unlocking that shared data, same as the plan this
 * was built from says plainly rather than pretending otherwise. */
export const SCREENS = ['live', 'yard', 'workers', 'dashboards', 'hydra', 'ims-stock'] as const;
export type Screen = (typeof SCREENS)[number];

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** The worker roster entry this login belongs to, if any — null for the
   * original admin account, which isn't a roster entry. */
  workerId: string | null;
  allowedScreens: Screen[];
}

/**
 * `@fastify/jwt` augments FastifyRequest with `user` for us — declaring it a
 * second time on `fastify` itself conflicts. This is the only declaration.
 */
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionUser;
    user: SessionUser;
  }
}

/** Rejects anonymous requests. Attaches the caller to `request.user`. */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    request.user = await request.jwtVerify<SessionUser>();
  } catch {
    await reply.code(401).send({
      error: 'unauthorized',
      message: 'Your session has expired. Sign in again to continue.',
    });
  }
}

/**
 * The first real, server-side permission check in this app — written once,
 * reused everywhere a screen needs gating, rather than each route rolling
 * its own. `manager` always passes: the admin can never lock themselves
 * out by misconfiguring their own access. Must run *after* `authenticate`
 * (reads `request.user`, which that hook attaches).
 *
 * Accepts one or more screens — pass more than one when a route's data is
 * genuinely shared by more than one screen (Live Board/Yard Board both
 * reading containers/tasks) and *either* should unlock it.
 */
export function requireScreen(...screens: Screen[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (user.role === 'manager') return;
    if (screens.some((s) => user.allowedScreens.includes(s))) return;
    await reply.code(403).send({
      error: 'forbidden',
      message: "You don't have access to this part of the system. Ask an admin to grant it.",
    });
  };
}

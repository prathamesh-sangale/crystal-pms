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

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
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

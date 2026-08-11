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

export const ROLES = ['manager', 'supervisor', 'technician', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | 'container:read'
  | 'container:create'
  | 'container:update'
  | 'container:advance'
  | 'container:task'
  | 'container:delete';

/**
 * The permission table.
 *
 * ── NEEDS SIGN-OFF ────────────────────────────────────────────────────────
 * Who may delete a container from the pipeline, and who may advance a stage
 * with tasks still open, are operational policy decisions rather than design
 * ones. This is the proposed mapping, kept in one place so changing it is a
 * one-line edit. Nothing else in the codebase hard-codes a role.
 * ──────────────────────────────────────────────────────────────────────────
 */
export const PERMISSIONS: Record<Role, readonly Permission[]> = {
  manager: [
    'container:read',
    'container:create',
    'container:update',
    'container:advance',
    'container:task',
    'container:delete',
  ],
  supervisor: [
    'container:read',
    'container:create',
    'container:update',
    'container:advance',
    'container:task',
  ],
  technician: ['container:read', 'container:task'],
  viewer: ['container:read'],
};

export function can(role: Role, permission: Permission): boolean {
  return PERMISSIONS[role]?.includes(permission) ?? false;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  depotId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

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

/** Use after `authenticate` to gate a route on a permission. */
export function requirePermission(permission: Permission) {
  return async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const role = request.user?.role;
    if (!role || !can(role, permission)) {
      await reply.code(403).send({
        error: 'forbidden',
        message: `Your role (${role ?? 'none'}) cannot do this. Ask a depot manager.`,
      });
    }
  };
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, hashPassword, ROLES, SCREENS } from '../auth.js';
import { conflict, notFound, parseOr422 } from '../http.js';
import { supabase } from '../supabase.js';

const createUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(ROLES).default('technician'),
  workerId: z.string().nullable(),
  allowedScreens: z.array(z.enum(SCREENS)).default([]),
});

const updateUserSchema = z
  .object({
    name: z.string().min(1).optional(),
    role: z.enum(ROLES).optional(),
    allowedScreens: z.array(z.enum(SCREENS)).optional(),
    // Omitted or blank means "leave the password unchanged" -- never
    // overwritten with a random/blank value by accident.
    password: z.string().min(8).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  worker_id: string | null;
  allowed_screens: string[];
}

function toUser(row: UserRow): Record<string, unknown> {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    workerId: row.worker_id,
    allowedScreens: row.allowed_screens,
  };
}

/** Managing who can log in, and what they can reach once they do, is itself
 * the single most sensitive action in the app — every route here is
 * manager-only, full stop, not screen-based like everything else. A real
 * preHandler (like every other gated route in this app), not a manually
 * called helper — a route added here later can't forget it without also
 * forgetting `authenticate`, which would be immediately obvious. */
async function requireManager(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.user.role === 'manager') return;
  await reply.code(403).send({ error: 'forbidden', message: 'Only an admin can manage access.' });
}

const USER_SELECT = 'id, email, name, role, worker_id, allowed_screens';

/**
 * The first real way to create a login other than running
 * scripts/seedUsers.ts by hand. Deliberately separate from `/api/v2/workers`
 * — a worker record and a login are two different things (a worker doesn't
 * need one; this table is what `/api/auth/login` actually checks), linked
 * by the optional `worker_id` the migration added.
 */
export async function v2UserRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireManager);

  app.get('/api/v2/users', async (_request, reply) => {
    const { data, error } = await supabase().from('users').select(USER_SELECT).order('name');
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.send({ users: (data as UserRow[]).map(toUser) });
  });

  app.post('/api/v2/users', async (request, reply) => {
    const body = await parseOr422(createUserSchema, request.body, reply);
    if (!body) return;

    const { data, error } = await supabase()
      .from('users')
      .insert({
        id: body.id,
        email: body.email.toLowerCase(),
        name: body.name,
        role: body.role,
        password_hash: hashPassword(body.password),
        worker_id: body.workerId,
        allowed_screens: body.allowedScreens,
      })
      .select(USER_SELECT)
      .single();
    if (error) {
      // unique_violation -- either the email or the one-login-per-worker
      // constraint already exists.
      if (error.code === '23505') return reply.code(409).send(conflict('That email or worker already has a login.'));
      throw app.httpErrors.internalServerError(error.message);
    }
    return reply.code(201).send({ user: toUser(data as UserRow) });
  });

  app.patch('/api/v2/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = await parseOr422(updateUserSchema, request.body, reply);
    if (!body) return;

    const { password, ...rest } = body;
    // Bumping this is what makes a role/screen change (or a password reset
    // -- might as well kill other sessions too) take effect immediately
    // instead of waiting up to 12h for the old token to expire on its own.
    // Set to the current timestamp, not incremented -- the only requirement
    // is "different from whatever's in any token issued before now", which
    // a timestamp guarantees without a read-then-write race.
    const revokesSessions = rest.role !== undefined || rest.allowedScreens !== undefined || password !== undefined;
    const patch: Record<string, unknown> = {
      ...(rest.name !== undefined && { name: rest.name }),
      ...(rest.role !== undefined && { role: rest.role }),
      ...(rest.allowedScreens !== undefined && { allowed_screens: rest.allowedScreens }),
      ...(password !== undefined && { password_hash: hashPassword(password) }),
      ...(revokesSessions && { token_version: Date.now() }),
    };

    const { data, error } = await supabase().from('users').update(patch).eq('id', id).select(USER_SELECT).maybeSingle();
    if (error) throw app.httpErrors.internalServerError(error.message);
    if (!data) return reply.code(404).send(notFound('Login'));
    return reply.send({ user: toUser(data as UserRow) });
  });

  app.delete('/api/v2/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { error } = await supabase().from('users').delete().eq('id', id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });
}

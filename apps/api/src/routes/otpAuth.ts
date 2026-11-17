import { otpRequestSchema, otpVerifySchema } from '@pms/shared';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { parseOr422 } from '../http.js';
import { supabase, supabaseAnon } from '../supabase.js';
import { toSession, type UserRow } from './auth.js';

/**
 * Sign-in with an emailed 6-digit code — an additional way to prove it's
 * you, alongside the existing password login (routes/auth.ts), never a
 * replacement for it. Supabase's own built-in Auth sends and checks the
 * code itself (its email-OTP flow); this app never generates, stores, or
 * compares a code directly. Once Supabase confirms the code was right, the
 * session issued here is identical in every way to a password login's --
 * same `toSession` mapping, same JWT shape, same 12h expiry, same
 * `token_version` revocation check on every later request.
 *
 * Gated on this app's own `users` table, not Supabase's `auth.users` list --
 * `/otp/request` only ever triggers Supabase's email for an address that
 * already has a real PMS login, same as the password route only works for
 * one. An unrecognized email still gets the same generic response, so this
 * endpoint can't be used to probe which emails have accounts.
 */
export async function otpAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/otp/request', {
    config: {
      // Lower than login's own budget -- each call here can send a real
      // email, which costs more to let someone spam than a password guess
      // does.
      rateLimit: { max: env.NODE_ENV === 'test' ? 1000 : 5, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const body = await parseOr422(otpRequestSchema, request.body, reply);
      if (!body) return;

      const email = body.email.toLowerCase();
      const { data: user } = (await supabase()
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle()) as { data: Pick<UserRow, 'id'> | null };

      // Same response whether or not the account exists -- this route must
      // never confirm which emails have a login, same reasoning as
      // /api/auth/login's own constant response shape.
      const sent = { ok: true, message: 'If that email has an account, a 6-digit code has been sent.' };
      if (!user) return reply.send(sent);

      if (!env.SUPABASE_ANON_KEY) {
        request.log.error('OTP requested but SUPABASE_ANON_KEY is not configured');
        return reply.send(sent);
      }

      try {
        // `shouldCreateUser: true` is safe here specifically because the
        // `users` lookup above already gated this to a real PMS account --
        // Supabase's own auth.users is otherwise unrelated to this app and
        // is only ever used as a vehicle for sending/checking this code.
        const { error } = await supabaseAnon().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
        if (error) request.log.error({ err: error }, 'Supabase signInWithOtp failed');
      } catch (err) {
        request.log.error({ err }, 'Supabase signInWithOtp threw');
      }
      return reply.send(sent);
    },
  });

  app.post('/api/auth/otp/verify', {
    config: {
      // Same budget as password login -- this is the brute-force-guarded
      // step (a 6-digit code is only ~1M possibilities).
      rateLimit: { max: env.NODE_ENV === 'test' ? 1000 : 10, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const body = await parseOr422(otpVerifySchema, request.body, reply);
      if (!body) return;

      if (!env.SUPABASE_ANON_KEY) {
        return reply.code(503).send({
          error: 'otp_unavailable',
          message: 'Email-code sign-in is not set up yet. Use your password instead.',
        });
      }

      const email = body.email.toLowerCase();
      const invalid = {
        error: 'invalid_otp',
        message: 'That code is incorrect or has expired.',
      };

      const { data: verified, error: verifyError } = await supabaseAnon().auth.verifyOtp({
        email,
        token: body.code,
        type: 'email',
      });
      if (verifyError || !verified?.user) {
        return reply.code(401).send(invalid);
      }

      const { data: user, error: fetchErr } = (await supabase()
        .from('users')
        .select('id, email, name, role, password_hash, worker_id, allowed_screens, token_version')
        .eq('email', email)
        .maybeSingle()) as { data: UserRow | null; error: unknown };
      if (fetchErr) throw app.httpErrors.internalServerError(String(fetchErr));
      // The account could in principle have been deleted between /request
      // and /verify -- the code checked out, but there's no PMS login left
      // to issue a session for.
      if (!user) return reply.code(401).send(invalid);

      const session = toSession(user);
      const token = app.jwt.sign(session, { expiresIn: '12h' });
      return reply.send({ token, user: session });
    },
  });
}
